import { OpenAI } from 'openai';
import chalk from 'chalk';
import { ThinkTagParser, stripThinkBlocks, StreamChannel } from '../thinkParser';
import { ChatMessage, ToolCall } from '../types';
import { logSink } from '../logSink';
import {
  ChatOptions,
  ChatResponse,
  ChatStats,
  ILLMProvider,
  InferenceCandidate,
} from './types';
import {
  getMaxRetries,
  getFirstTokenTimeoutMs,
  getMaxTokensCeiling,
  getGenerationTimeoutMs,
  requestTimeoutDecision,
} from './timeouts';
import {
  LOGPROBS_TOP_N,
  TELEMETRY_EMIT_INTERVAL_MS,
  emitInferenceTelemetry,
  isLogprobsEnabled,
  isLogprobsRejectionError,
  noteLogprobsRejected,
} from './telemetry';
import {
  isExtendedSamplingRejectionError,
  isExtendedSamplingSupported,
  noteExtendedSamplingRejected,
  samplingParamsForRequest,
} from './sampling';

/**
 * Identifies malformed tool call JSON syntax errors from model output (T9.8).
 */
function isMalformedToolCallJsonError(message: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('tool call') && (m.includes('json') || m.includes('parse'));
}

export class LLMProvider implements ILLMProvider {
  private client: OpenAI;
  private currentModel: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string, defaultModel: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey || 'ollama';
    this.currentModel = defaultModel;
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true
    });
  }

  /**
   * Reconfigures the provider instance (endpoint/key/model) by recreating the client.
   */
  reconfigure(baseUrl: string, apiKey: string, defaultModel: string): void {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey || 'ollama';
    this.currentModel = defaultModel;
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true
    });
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  setCurrentModel(model: string): void {
    this.currentModel = model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Lists available models from the provider.
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((m) => m.id).sort();
    } catch (error: any) {
      if (this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1')) {
        try {
          const directUrl = this.baseUrl.replace(/\/v1\/?$/, '/api/tags');
          const response = await fetch(directUrl);
          if (response.ok) {
            const data = await response.json() as { models?: Array<{ name: string }> };
            if (data.models && Array.isArray(data.models)) {
              return data.models.map((m) => m.name).sort();
            }
          }
        } catch (fetchError) {}
      }
      throw new Error(`Error fetching models from ${this.baseUrl}: ${error.message}`);
    }
  }

  /**
   * Performs chat completion request with Function Calling support and streaming accumulation.
   */
  async chatWithTools(
    messages: ChatMessage[],
    tools?: any[],
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    signal?: AbortSignal,
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const startTime = Date.now();
    let allReasoningText = '';
    const maxRetries = getMaxRetries();
    const firstTokenTimeout = getFirstTokenTimeoutMs();
    const maxTokensCeiling = getMaxTokensCeiling();
    let logprobsEnabled = isLogprobsEnabled();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) break;

      const attemptStartTime = Date.now();
      const attemptAbort = new AbortController();
      let timedOut = false;
      let generationTimedOut = false;
      let reasoningText = '';

      const onUserAbort = () => attemptAbort.abort();
      if (signal) {
        if (signal.aborted) break;
        signal.addEventListener('abort', onUserAbort, { once: true });
      }

      let firstTokenTimer: NodeJS.Timeout | undefined;
      let generationTimer: NodeJS.Timeout | undefined;
      let receivedFirstToken = false;

      const scheduleFirstTokenTimer = () => {
        if (firstTokenTimer) clearTimeout(firstTokenTimer);
        firstTokenTimer = setTimeout(async () => {
          if (receivedFirstToken || signal?.aborted) return;
          const action = await requestTimeoutDecision({
            type: 'first_token',
            elapsedMs: firstTokenTimeout,
            model: this.currentModel,
          });
          if (action === 'extend') {
            scheduleFirstTokenTimer();
            return;
          } else if (action === 'unlimited') {
            return;
          }
          timedOut = true;
          attemptAbort.abort();
        }, firstTokenTimeout);
      };

      const scheduleGenerationTimer = () => {
        if (generationTimer) clearTimeout(generationTimer);
        generationTimer = setTimeout(async () => {
          if (signal?.aborted) return;
          const action = await requestTimeoutDecision({
            type: 'generation_duration',
            elapsedMs: getGenerationTimeoutMs(),
            model: this.currentModel,
          });
          if (action === 'extend') {
            scheduleGenerationTimer();
            return;
          } else if (action === 'unlimited') {
            return;
          }
          generationTimedOut = true;
          attemptAbort.abort();
        }, getGenerationTimeoutMs());
      };

      scheduleFirstTokenTimer();
      scheduleGenerationTimer();

      try {
        const response = await this.client.chat.completions.create({
          model: this.currentModel,
          messages: messages as any,
          tools: tools,
          tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
          stream: !!onChunk,
          ...(onChunk ? { stream_options: { include_usage: true } } : {}),
          ...(onChunk && logprobsEnabled ? { logprobs: true, top_logprobs: LOGPROBS_TOP_N } : {}),
          max_tokens: maxTokensCeiling,
          ...(options?.reasoningEffort ? { reasoning_effort: options.reasoningEffort as any } : {}),
          ...samplingParamsForRequest(options, this.currentModel)
        }, { signal: attemptAbort.signal });

        const isStreaming = onChunk && (Symbol.asyncIterator in response || (response as any)[Symbol.asyncIterator]);
        if (!isStreaming) clearTimeout(firstTokenTimer);

        if (isStreaming) {
          let fullText = '';
          const toolCallsAccumulator: ToolCall[] = [];
          let chunkCount = 0;
          let usage: any = null;
          // Real telemetry of the decode phase (T14.9): measured, never estimated.
          let firstTokenAt = 0;
          let decodedTokens = 0;
          let lastTelemetryAt = 0;
          let lastConfidence: number | undefined;
          let lastCandidates: InferenceCandidate[] | undefined;

          const thinkParser = new ThinkTagParser((text, channel) => {
            if (channel === 'content') {
              fullText += text;
            } else {
              reasoningText += text;
            }
            onChunk(text, channel);
          });

          for await (const chunk of response as any) {
            if (!receivedFirstToken) {
              receivedFirstToken = true;
              clearTimeout(firstTokenTimer);
            }

            if (chunk?.usage) {
              usage = chunk.usage;
            }

            const choice = chunk.choices?.[0];
            const content = choice?.delta?.content || '';
            const reasoning = (choice?.delta as any)?.reasoning || (choice?.delta as any)?.reasoning_content || '';

            if (content || reasoning) {
              const logprobEntries = (choice as any)?.logprobs?.content as
                | Array<{ token: string; logprob: number; top_logprobs?: Array<{ token: string; logprob: number }> }>
                | undefined;

              if (logprobEntries && logprobEntries.length > 0) {
                // Exact count: the backend reports one entry per generated token.
                decodedTokens += logprobEntries.length;
                const last = logprobEntries[logprobEntries.length - 1];
                lastConfidence = Math.round(Math.exp(last.logprob) * 1000) / 10;
                lastCandidates = (last.top_logprobs || [])
                  .slice(0, LOGPROBS_TOP_N)
                  .map((c) => ({ token: c.token, prob: Math.exp(c.logprob) }));
              } else {
                // Fallback without logprobs: one delta counts as one token (approximation).
                decodedTokens++;
              }

              if (!firstTokenAt) {
                firstTokenAt = Date.now();
                emitInferenceTelemetry({ type: 'first_token', ttftMs: firstTokenAt - attemptStartTime });
              }

              const now = Date.now();
              if (now - lastTelemetryAt >= TELEMETRY_EMIT_INTERVAL_MS) {
                lastTelemetryAt = now;
                emitInferenceTelemetry({
                  type: 'decode',
                  tokens: decodedTokens,
                  decodeMs: now - firstTokenAt,
                  confidence: lastConfidence,
                  topCandidates: lastCandidates,
                });
              }
            }

            if (reasoning) {
              chunkCount++;
              reasoningText += reasoning;
              onChunk(reasoning, 'reasoning');
            }

            if (content) {
              chunkCount++;
              thinkParser.push(content);
            }

            if (choice?.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallsAccumulator[idx]) {
                  toolCallsAccumulator[idx] = {
                    id: '',
                    type: 'function',
                    function: { name: '', arguments: '' }
                  };
                }
                if (tc.id) toolCallsAccumulator[idx].id = tc.id;
                if (tc.function?.name) toolCallsAccumulator[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCallsAccumulator[idx].function.arguments += tc.function.arguments;
              }
            }
          }

          if (generationTimedOut || timedOut) {
            throw new Error('__generation_aborted_by_timeout__');
          }

          clearTimeout(firstTokenTimer);
          thinkParser.flush();

          const cleanToolCalls = toolCallsAccumulator.filter(
            (tc) => tc && tc.function && tc.function.name
          );

          const endTime = Date.now();
          const durationMs = endTime - startTime;
          const tokenCount = usage?.completion_tokens ?? (decodedTokens || chunkCount);
          const promptTokens = usage?.prompt_tokens ?? 0;
          const totalTokens = usage?.total_tokens ?? (promptTokens + tokenCount);

          // Decode speed measures generation only: including the prefill would
          // report a lower speed than the model actually sustains.
          const ttftMs = firstTokenAt ? firstTokenAt - attemptStartTime : undefined;
          const decodeMs = firstTokenAt ? endTime - firstTokenAt : 0;
          const decodeWindowMs = decodeMs > 0 ? decodeMs : durationMs;
          const tokensPerSecond = decodeWindowMs > 0 ? (tokenCount / (decodeWindowMs / 1000)) : 0;
          const prefillTokensPerSecond = ttftMs && ttftMs > 0 && promptTokens > 0
            ? parseFloat((promptTokens / (ttftMs / 1000)).toFixed(1))
            : undefined;

          const stats: ChatStats = {
            durationMs,
            tokenCount,
            tokensPerSecond: parseFloat(tokensPerSecond.toFixed(1)),
            promptTokens,
            totalTokens,
            ttftMs,
            decodeMs,
            prefillTokensPerSecond
          };

          emitInferenceTelemetry({ type: 'complete', stats });

          return {
            content: fullText,
            toolCalls: cleanToolCalls.length > 0 ? cleanToolCalls : undefined,
            reasoningText: reasoningText || undefined,
            stats
          };
        } else {
          const nonStreamResponse = response as any;
          const msg = nonStreamResponse.choices[0]?.message;
          const content = stripThinkBlocks(msg?.content || '');
          const durationMs = Date.now() - startTime;

          const charPerToken = 3.5;
          const tokenCount = nonStreamResponse.usage?.completion_tokens ?? Math.round(content.length / charPerToken);
          const promptTokens = nonStreamResponse.usage?.prompt_tokens ?? 0;
          const totalTokens = nonStreamResponse.usage?.total_tokens ?? (promptTokens + tokenCount);
          const tokensPerSecond = durationMs > 0 ? (tokenCount / (durationMs / 1000)) : 0;

          return {
            content: content,
            toolCalls: msg?.tool_calls || undefined,
            stats: {
              durationMs,
              tokenCount,
              tokensPerSecond: parseFloat(tokensPerSecond.toFixed(1)),
              promptTokens,
              totalTokens
            }
          };
        }
      } catch (error: any) {
        if (signal?.aborted) break;

        if (reasoningText) {
          allReasoningText += (allReasoningText ? '\n\n---\n\n' : '') + reasoningText;
        }

        if (generationTimedOut) {
          throw Object.assign(
            new Error(
              `[Generation timeout] Model '${this.currentModel}' exceeded generation time limit of ` +
              `${getGenerationTimeoutMs() / 1000}s and was aborted.`
            ),
            { partialReasoning: allReasoningText || undefined }
          );
        }

        if (timedOut) {
          if (attempt < maxRetries) {
            process.stdout.write('\n');
            logSink.log(
              chalk.yellow(`[Attempt ${attempt}/${maxRetries}] Model '${this.currentModel}' did not respond in time, retrying...`)
            );
            continue;
          }
          throw Object.assign(
            new Error(
              `[No response] Model '${this.currentModel}' produced no tokens after ${maxRetries} attempts ` +
              `(timeout: ${firstTokenTimeout / 1000}s per attempt).`
            ),
            { partialReasoning: allReasoningText || undefined }
          );
        }

        if (error.message?.includes('reasoning_effort') && options?.reasoningEffort) {
          options = { ...options, reasoningEffort: undefined };
          continue;
        }

        // Backend without extended sampling knobs: drop them and retry. They live outside
        // the OpenAI schema (llama.cpp and vLLM read them, other servers reject the request).
        if (isExtendedSamplingSupported() && isExtendedSamplingRejectionError(error.message)) {
          noteExtendedSamplingRejected();
          logSink.log(
            chalk.yellow(
              `[Sampling] Model '${this.currentModel}' rejected top_k/min_p/repetition_penalty: ` +
              `parameters dropped for this session, retrying without them.`
            )
          );
          // A rejected parameter is our fault, not the model's: the retry budget stays intact
          // (this branch can run only once per session, the flag is now set).
          attempt--;
          continue;
        }

        // Backend without logprobs support: degrade visibly, never silently (T14.9).
        if (logprobsEnabled && isLogprobsRejectionError(error.message)) {
          logprobsEnabled = false;
          noteLogprobsRejected();
          logSink.log(
            chalk.yellow(
              `[Telemetry] Model '${this.currentModel}' rejected 'logprobs': latent space inspection ` +
              `disabled for this session, retrying without it.`
            )
          );
          // A rejected parameter is our fault, not the model's: the retry budget stays intact
          // (this branch can run only once per session, the flag is now set).
          attempt--;
          continue;
        }

        if (isMalformedToolCallJsonError(error.message)) {
          if (attempt < maxRetries) {
            process.stdout.write('\n');
            logSink.log(
              chalk.yellow(`[Attempt ${attempt}/${maxRetries}] Server rejected malformed tool call JSON, retrying...`)
            );
            continue;
          }
          throw Object.assign(
            new Error(
              `[Malformed JSON] Model '${this.currentModel}' repeatedly generated malformed tool call JSON ` +
              `after ${maxRetries} attempts. Server error: ${error.message}`
            ),
            { partialReasoning: allReasoningText || undefined }
          );
        }

        throw Object.assign(
          new Error(`Communication error with model '${this.currentModel}': ${error.message}`),
          { partialReasoning: allReasoningText || undefined }
        );
      } finally {
        if (firstTokenTimer) clearTimeout(firstTokenTimer);
        if (generationTimer) clearTimeout(generationTimer);
        if (signal) signal.removeEventListener('abort', onUserAbort);
      }
    }

    throw new Error(
      `[No response] Model '${this.currentModel}' produced no tokens after ${maxRetries} attempts ` +
      `(timeout: ${firstTokenTimeout / 1000}s per attempt).`
    );
  }
}
