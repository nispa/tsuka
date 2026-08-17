import { OpenAI } from 'openai';
import chalk from 'chalk';
import { ThinkTagParser, stripThinkBlocks, StreamChannel } from './thinkParser';
import { ChatMessage, ChatRole, ToolCall } from './types';
import { logSink } from './logSink';

import { ConfigManager } from './config';

export const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 120_000; // 2 minutes wait time for the first token
export const DEFAULT_MAX_RETRIES = 3;                  // Attempts before raising non-responsive error
export const DEFAULT_MAX_TOKENS_CEILING = 8192;        // Generous token ceiling for completions

let MAX_GENERATION_MS = 120_000; // 2 minutes default generation timeout (llmTimeoutMs in config)

export function getFirstTokenTimeoutMs(): number {
  try {
    return new ConfigManager().getFirstTokenTimeoutMs();
  } catch {
    return DEFAULT_FIRST_TOKEN_TIMEOUT_MS;
  }
}

export function getMaxRetries(): number {
  try {
    return new ConfigManager().getLlmMaxRetries();
  } catch {
    return DEFAULT_MAX_RETRIES;
  }
}

export function getMaxTokensCeiling(): number {
  try {
    return new ConfigManager().getLlmMaxTokensCeiling();
  } catch {
    return DEFAULT_MAX_TOKENS_CEILING;
  }
}

/**
 * Configures the wall-clock timeout for the entire LLM generation process (T8.16).
 */
export function setLlmTimeoutMs(ms: number): void {
  if (ms > 0) {
    MAX_GENERATION_MS = ms;
  }
}

/**
 * Testing helper: lowers generation timeout without real waits.
 */
export function __setMaxGenerationMsForTest(ms: number): void {
  MAX_GENERATION_MS = ms;
}

export type TimeoutAction = 'extend' | 'unlimited' | 'abort';

export interface TimeoutPromptInfo {
  type: 'first_token' | 'generation_duration';
  elapsedMs: number;
  model: string;
}

export type TimeoutPromptHandler = (info: TimeoutPromptInfo) => Promise<TimeoutAction>;

let globalTimeoutPromptHandler: TimeoutPromptHandler | undefined;

export function setTimeoutPromptHandler(handler: TimeoutPromptHandler | undefined): void {
  globalTimeoutPromptHandler = handler;
}

/**
 * Identifies malformed tool call JSON syntax errors from model output (T9.8).
 */
function isMalformedToolCallJsonError(message: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('tool call') && (m.includes('json') || m.includes('parse'));
}

export type { ChatRole };
export type ChatMessageLike = ChatMessage;

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'xhigh';

export type CreativityLevel = 'precise' | 'balanced' | 'creative' | 'low' | 'medium' | 'high';

export interface SamplingParams {
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

/**
 * Non-message chat options (T8.10/T8.17).
 */
export interface ChatOptions extends SamplingParams {
  reasoningEffort?: ReasoningEffort;
  creativity?: CreativityLevel;
}

export function resolveSamplingParams(options?: ChatOptions): {
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
} {
  if (!options) return {};

  let temperature = options.temperature;
  let top_p = options.topP;
  let presence_penalty = options.presencePenalty;
  let frequency_penalty = options.frequencyPenalty;

  if (options.creativity) {
    switch (options.creativity) {
      case 'precise':
      case 'low':
        temperature = temperature ?? 0.2;
        top_p = top_p ?? 0.8;
        break;
      case 'creative':
      case 'high':
        temperature = temperature ?? 0.95;
        top_p = top_p ?? 0.95;
        presence_penalty = presence_penalty ?? 0.3;
        break;
      case 'balanced':
      case 'medium':
      default:
        temperature = temperature ?? 0.7;
        top_p = top_p ?? 0.9;
        break;
    }
  }

  const result: {
    temperature?: number;
    top_p?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
  } = {};
  if (temperature !== undefined) result.temperature = temperature;
  if (top_p !== undefined) result.top_p = top_p;
  if (presence_penalty !== undefined) result.presence_penalty = presence_penalty;
  if (frequency_penalty !== undefined) result.frequency_penalty = frequency_penalty;
  return result;
}

export interface ChatStats {
  durationMs: number;
  tokenCount: number;
  tokensPerSecond: number;
  promptTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  stats?: ChatStats;
  /** Full chain of thought from this round (if emitted by the model). */
  reasoningText?: string;
}

/**
 * Minimal contract used by Agent and CLI commands.
 */
export interface ILLMProvider {
  chatWithTools(
    messages: ChatMessage[],
    tools?: any[],
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    signal?: AbortSignal,
    options?: ChatOptions
  ): Promise<ChatResponse>;
  getCurrentModel(): string;
  setCurrentModel(model: string): void;
  getBaseUrl(): string;
  listModels(): Promise<string[]>;
  reconfigure(baseUrl: string, apiKey: string, defaultModel: string): void;
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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) break;

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
          if (globalTimeoutPromptHandler) {
            try {
              const action = await globalTimeoutPromptHandler({
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
            } catch {}
          }
          timedOut = true;
          attemptAbort.abort();
        }, firstTokenTimeout);
      };

      const scheduleGenerationTimer = () => {
        if (generationTimer) clearTimeout(generationTimer);
        generationTimer = setTimeout(async () => {
          if (signal?.aborted) return;
          if (globalTimeoutPromptHandler) {
            try {
              const action = await globalTimeoutPromptHandler({
                type: 'generation_duration',
                elapsedMs: MAX_GENERATION_MS,
                model: this.currentModel,
              });
              if (action === 'extend') {
                scheduleGenerationTimer();
                return;
              } else if (action === 'unlimited') {
                return;
              }
            } catch {}
          }
          generationTimedOut = true;
          attemptAbort.abort();
        }, MAX_GENERATION_MS);
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
          max_tokens: maxTokensCeiling,
          ...(options?.reasoningEffort ? { reasoning_effort: options.reasoningEffort as any } : {}),
          ...resolveSamplingParams(options)
        }, { signal: attemptAbort.signal });

        const isStreaming = onChunk && (Symbol.asyncIterator in response || (response as any)[Symbol.asyncIterator]);
        if (!isStreaming) clearTimeout(firstTokenTimer);

        if (isStreaming) {
          let fullText = '';
          const toolCallsAccumulator: ToolCall[] = [];
          let chunkCount = 0;
          let usage: any = null;

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

          const durationMs = Date.now() - startTime;
          const tokenCount = usage?.completion_tokens ?? chunkCount;
          const promptTokens = usage?.prompt_tokens ?? 0;
          const totalTokens = usage?.total_tokens ?? (promptTokens + tokenCount);
          const tokensPerSecond = durationMs > 0 ? (tokenCount / (durationMs / 1000)) : 0;

          return {
            content: fullText,
            toolCalls: cleanToolCalls.length > 0 ? cleanToolCalls : undefined,
            reasoningText: reasoningText || undefined,
            stats: {
              durationMs,
              tokenCount,
              tokensPerSecond: parseFloat(tokensPerSecond.toFixed(1)),
              promptTokens,
              totalTokens
            }
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
              `${MAX_GENERATION_MS / 1000}s and was aborted.`
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
