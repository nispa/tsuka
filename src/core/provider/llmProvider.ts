import { OpenAI } from 'openai';
import chalk from 'chalk';
import { stripThinkBlocks, StreamChannel } from '../thinkParser';
import { ChatMessage, ToolCall } from '../types';
import { logSink } from '../logSink';
import {
  ChatOptions,
  ChatResponse,
  ChatStats,
  ChatToolDefinition,
  ILLMProvider,
} from './types';
import {
  getMaxRetries,
  getFirstTokenTimeoutMs,
  getMaxTokensCeiling,
  getGenerationTimeoutMs,
  requestTimeoutDecision,
} from './timeouts';
import {
  isLogprobsEnabled,
  isLogprobsRejectionError,
  noteLogprobsRejected,
} from './telemetry';
import {
  isExtendedSamplingRejectionError,
  isExtendedSamplingSupported,
  noteExtendedSamplingRejected,
} from './sampling';
import { buildChatCompletionParams } from './wireFormat';
import { StreamAccumulator, type ProviderStreamChunk } from './streamAccumulator';
import {
  isMalformedToolCallJsonError,
  isReasoningEffortRejectionError,
  createProviderError,
} from './errorClassification';
import { logProviderFailure } from './providerLogger';
import type { ProviderClass } from '../cloudProvider';
import { ProviderAttemptLifecycle } from './lifecycle';
import { TSUKA_PACKAGE } from '../packageInfo';
import { isRateLimitError, rateLimitDelayMs, rateLimitDescription, waitForRateLimit } from './rateLimit';

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

export class LLMProvider implements ILLMProvider {
  private client: OpenAI;
  private currentModel: string;
  private baseUrl: string;
  private apiKey: string;
  private providerClass: ProviderClass;

  constructor(baseUrl: string, apiKey: string, defaultModel: string, providerClass: ProviderClass = 'LOCAL') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey || 'local';
    this.currentModel = defaultModel;
    this.providerClass = providerClass;
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      defaultHeaders: {
        'User-Agent': TSUKA_PACKAGE.userAgent,
      },
      dangerouslyAllowBrowser: true
    });
  }

  /**
   * Reconfigures the provider instance (endpoint/key/model) by recreating the client.
   */
  reconfigure(baseUrl: string, apiKey: string, defaultModel: string, providerClass?: ProviderClass): void {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey || 'local';
    this.currentModel = defaultModel;
    if (providerClass) {
      this.providerClass = providerClass;
    }
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      defaultHeaders: {
        'User-Agent': TSUKA_PACKAGE.userAgent,
      },
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

  getProviderClass(): ProviderClass {
    return this.providerClass;
  }

  /**
   * Lists available models from the provider.
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((m) => m.id).sort();
    } catch (error: any) {
      logProviderFailure({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        operation: 'models.list',
        status: error?.status,
        error,
        responseBody: error?.error ?? error?.response?.data,
      });
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
    tools?: ChatToolDefinition[],
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
      let attemptReasoningText = '';
      let streamAccumulator: StreamAccumulator | undefined;

      const onUserAbort = () => attemptAbort.abort();
      const lifecycle = new ProviderAttemptLifecycle(signal, onUserAbort);
      if (signal?.aborted) {
        lifecycle.cleanup();
        break;
      }
      let receivedFirstToken = false;

      const scheduleFirstTokenTimer = () => {
        lifecycle.scheduleFirstToken(firstTokenTimeout, async () => {
          if (!lifecycle.isActive() || receivedFirstToken || signal?.aborted || attemptAbort.signal.aborted) return;
          const action = await requestTimeoutDecision({
            type: 'first_token',
            elapsedMs: firstTokenTimeout,
            model: this.currentModel,
          });
          if (!lifecycle.isActive() || signal?.aborted || attemptAbort.signal.aborted || receivedFirstToken) return;
          if (action === 'extend') {
            scheduleFirstTokenTimer();
            return;
          } else if (action === 'unlimited') {
            return;
          }
          timedOut = true;
          attemptAbort.abort();
        });
      };

      const scheduleGenerationTimer = () => {
        lifecycle.scheduleGeneration(getGenerationTimeoutMs(), async () => {
          if (!lifecycle.isActive() || signal?.aborted || attemptAbort.signal.aborted) return;
          const action = await requestTimeoutDecision({
            type: 'generation_duration',
            elapsedMs: getGenerationTimeoutMs(),
            model: this.currentModel,
          });
          if (!lifecycle.isActive() || signal?.aborted || attemptAbort.signal.aborted) return;
          if (action === 'extend') {
            scheduleGenerationTimer();
            return;
          } else if (action === 'unlimited') {
            return;
          }
          generationTimedOut = true;
          attemptAbort.abort();
        });
      };

      scheduleFirstTokenTimer();
      scheduleGenerationTimer();

      let payload: unknown = undefined;
      try {
        payload = buildChatCompletionParams({
          model: this.currentModel,
          messages,
          tools,
          stream: !!onChunk,
          logprobsEnabled,
          maxTokensCeiling,
          options,
        });

        // Local OpenAI-compatible servers accept effort values newer than this SDK's type union.
        const response = await this.client.chat.completions.create(
          payload as OpenAI.Chat.ChatCompletionCreateParams,
          { signal: attemptAbort.signal, maxRetries: 0 }
        );

        const isStreaming = onChunk && isAsyncIterable<ProviderStreamChunk>(response);
        if (!isStreaming) lifecycle.clearFirstToken();

        if (isStreaming) {
          streamAccumulator = new StreamAccumulator({
            onChunk,
            startTime,
            attemptStartTime,
            onFirstToken: () => {
              receivedFirstToken = true;
              lifecycle.clearFirstToken();
            },
          });

          for await (const chunk of response) {
            streamAccumulator.processChunk(chunk);
          }

          if (generationTimedOut || timedOut) {
            throw new Error('__generation_aborted_by_timeout__');
          }

          lifecycle.clearFirstToken();
          attemptReasoningText = streamAccumulator.getReasoningText();
          return streamAccumulator.finalize();
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

          const stats: ChatStats = {
            durationMs,
            tokenCount,
            tokensPerSecond: parseFloat(tokensPerSecond.toFixed(1)),
            promptTokens,
            totalTokens,
          };

          return {
            content,
            toolCalls: msg?.tool_calls as ToolCall[] | undefined,
            stats,
          };
        }
      } catch (error: any) {
        if (signal?.aborted) break;

        logProviderFailure({
          baseUrl: this.baseUrl,
          model: this.currentModel,
          apiKey: this.apiKey,
          operation: 'chat.completions',
          status: error?.status,
          error,
          requestPayload: payload,
          responseBody: error?.error ?? error?.response?.data,
          attempt,
          maxRetries,
        });

        attemptReasoningText = streamAccumulator?.getReasoningText() ?? attemptReasoningText;
        if (attemptReasoningText) {
          allReasoningText += (allReasoningText ? '\n\n---\n\n' : '') + attemptReasoningText;
        }

        if (generationTimedOut) {
          throw createProviderError(
            `[Generation timeout] Model '${this.currentModel}' exceeded generation time limit of ` +
            `${getGenerationTimeoutMs() / 1000}s and was aborted.`,
            allReasoningText
          );
        }

        if (timedOut) {
          if (attempt < maxRetries) {
            logSink.log(
              chalk.yellow(`\n[Attempt ${attempt}/${maxRetries}] Model '${this.currentModel}' did not respond in time, retrying...`)
            );
            continue;
          }
          throw createProviderError(
            `[No response] Model '${this.currentModel}' produced no tokens after ${maxRetries} attempts ` +
            `(timeout: ${firstTokenTimeout / 1000}s per attempt).`,
            allReasoningText
          );
        }

        if (isRateLimitError(error)) {
          const description = rateLimitDescription(error);
          // A stream that already emitted text cannot be replayed without duplicating output.
          if (attempt < maxRetries && !receivedFirstToken) {
            const delayMs = rateLimitDelayMs(error, attempt);
            logSink.warn(`[Rate limit] ${description} Retrying model '${this.currentModel}' in ${delayMs / 1000}s (attempt ${attempt}/${maxRetries}).`);
            if (await waitForRateLimit(delayMs, signal)) continue;
            break;
          }
          throw createProviderError(
            `[Rate limit] ${description} Model '${this.currentModel}' remained unavailable after ${maxRetries} attempts. Try again later or select another model.`,
            allReasoningText
          );
        }

        if (isReasoningEffortRejectionError(error.message) && options?.reasoningEffort) {
          options = { ...options, reasoningEffort: undefined };
          continue;
        }

        // Backend without extended sampling knobs: drop them and retry.
        if (isExtendedSamplingSupported() && isExtendedSamplingRejectionError(error.message)) {
          noteExtendedSamplingRejected();
          logSink.log(
            chalk.yellow(
              `[Sampling] Model '${this.currentModel}' rejected top_k/min_p/repetition_penalty: ` +
              `parameters dropped for this session, retrying without them.`
            )
          );
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
          attempt--;
          continue;
        }

        if (isMalformedToolCallJsonError(error.message)) {
          if (attempt < maxRetries) {
            logSink.log(
              chalk.yellow(`\n[Attempt ${attempt}/${maxRetries}] Server rejected malformed tool call JSON, retrying...`)
            );
            continue;
          }
          throw createProviderError(
            `[Malformed JSON] Model '${this.currentModel}' repeatedly generated malformed tool call JSON ` +
            `after ${maxRetries} attempts. Server error: ${error.message}`,
            allReasoningText
          );
        }

        throw createProviderError(
          `Communication error with model '${this.currentModel}': ${error.message}`,
          allReasoningText
        );
      } finally {
        lifecycle.cleanup();
      }
    }

    throw new Error(
      `[No response] Model '${this.currentModel}' produced no tokens after ${maxRetries} attempts ` +
      `(timeout: ${firstTokenTimeout / 1000}s per attempt).`
    );
  }
}
