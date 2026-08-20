import { OpenAI } from 'openai';
import chalk from 'chalk';
import { ThinkTagParser, stripThinkBlocks, StreamChannel } from './thinkParser';
import { ChatMessage, ChatRole, ToolCall } from './types';
import { logSink } from './logSink';

import { ConfigManager, SamplingProfileParams } from './config';

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

/** Number of alternative tokens requested when logprobs inspection is enabled (T14.9). */
export const LOGPROBS_TOP_N = 3;

/** Minimum interval between two live decode telemetry events, to avoid one re-render per token. */
const TELEMETRY_EMIT_INTERVAL_MS = 100;

/** One alternative considered by the model for a single generated token. */
export interface InferenceCandidate {
  token: string;
  /** Linear probability in [0,1], derived from the backend logprob. */
  prob: number;
}

/**
 * Real inference telemetry emitted by the streaming loop (T14.9).
 * The core never renders: it only publishes measured values, the presentation
 * layer (TUI) decides what to display. Every field comes from the backend or
 * from a clock, never from an estimate presented as a measure.
 */
export type InferenceTelemetryEvent =
  | { type: 'first_token'; ttftMs: number }
  | { type: 'decode'; tokens: number; decodeMs: number; confidence?: number; topCandidates?: InferenceCandidate[] }
  | { type: 'complete'; stats: ChatStats };

export type InferenceTelemetrySink = (event: InferenceTelemetryEvent) => void;

let globalInferenceTelemetrySink: InferenceTelemetrySink | undefined;

export function setInferenceTelemetrySink(sink: InferenceTelemetrySink | undefined): void {
  globalInferenceTelemetrySink = sink;
}

function emitInferenceTelemetry(event: InferenceTelemetryEvent): void {
  if (!globalInferenceTelemetrySink) return;
  try {
    globalInferenceTelemetrySink(event);
  } catch {}
}

/** Set once a backend rejects the logprobs parameters: no point in retrying for the rest of the session. */
let logprobsUnsupported = false;
let logprobsEnabledForTest: boolean | undefined;

export function isLogprobsEnabled(): boolean {
  if (logprobsUnsupported) return false;
  if (logprobsEnabledForTest !== undefined) return logprobsEnabledForTest;
  try {
    return new ConfigManager().getInferenceLogprobsEnabled();
  } catch {
    return false;
  }
}

/** Identifies a backend rejecting logprobs / top_logprobs (unsupported parameter). */
function isLogprobsRejectionError(message: string): boolean {
  return /logprob/i.test(message || '');
}

/** Identifies a backend rejecting the sampling knobs outside the OpenAI schema. */
function isExtendedSamplingRejectionError(message: string): boolean {
  return /top_k|min_p|repetition_penalty|repeat_penalty/i.test(message || '');
}

/** Set once a backend has rejected those knobs: they stay off for the rest of the session. */
let extendedSamplingUnsupported = false;

/**
 * Testing helper: forces logprobs on/off without touching the user config and
 * clears any rejection recorded by a previous test.
 */
export function __setLogprobsEnabledForTest(enabled: boolean | undefined): void {
  logprobsEnabledForTest = enabled;
  logprobsUnsupported = false;
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
  /** Knobs outside the OpenAI schema: local backends (llama.cpp, vLLM) read them from the body. */
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
}

/**
 * Non-message chat options (T8.10/T8.17).
 */
export interface ChatOptions extends SamplingParams {
  reasoningEffort?: ReasoningEffort;
  creativity?: CreativityLevel;
}

/** Sampling parameters in wire format (snake_case), as they travel in the request body. */
export interface WireSamplingParams {
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  /** llama.cpp names the repetition penalty this way; vLLM/OpenRouter use repetition_penalty. */
  repeat_penalty?: number;
}

/**
 * Sampling defaults recommended by the authors of each model family (T8.17).
 * Data-driven on purpose: a new family means a new row, no branching added elsewhere.
 */
interface ModelSamplingProfile {
  /** Matched against the model id, provider prefix and quantization suffix included. */
  match: RegExp;
  /** Used when reasoning is active. */
  thinking: WireSamplingParams;
  /** Used when the effort is 'none', i.e. the model answers without a think block. */
  instruct: WireSamplingParams;
}

export const MODEL_SAMPLING_PROFILES: ModelSamplingProfile[] = [
  {
    // Qwen3.8 — values published on the model card.
    match: /qwen[\s._-]?3\.8/i,
    thinking: {
      temperature: 1.0,
      top_p: 0.95,
      top_k: 20,
      min_p: 0.0,
      presence_penalty: 0.0,
      repetition_penalty: 1.0
    },
    instruct: {
      temperature: 0.7,
      top_p: 0.80,
      top_k: 20,
      min_p: 0.0,
      // The card allows 0..2 to curb endless repetition; above 1.5 language mixing shows up.
      presence_penalty: 1.5,
      repetition_penalty: 1.0
    }
  }
];

/** Mode a call runs in: 'none' effort means an answer with no reasoning block. */
export function samplingModeFor(effort?: ReasoningEffort): 'thinking' | 'instruct' {
  // Any value other than 'none' — an unset effort included, since Qwen reasons by
  // default — is served by the thinking preset.
  return effort === 'none' ? 'instruct' : 'thinking';
}

/** Built-in defaults for `model`, or undefined when no family in the table matches it. */
export function resolveModelSamplingProfile(
  model?: string,
  effort?: ReasoningEffort
): WireSamplingParams | undefined {
  if (!model) return undefined;
  const profile = MODEL_SAMPLING_PROFILES.find((p) => p.match.test(model));
  if (!profile) return undefined;
  return profile[samplingModeFor(effort)];
}

/**
 * Reads samplingProfiles from tsuka.config.json. The lookup is built once per session:
 * the config file is not re-read on every call.
 */
let configuredSamplingLookup:
  | ((model: string, mode: 'thinking' | 'instruct') => SamplingProfileParams | undefined)
  | undefined;

function resolveConfiguredSamplingProfile(
  model?: string,
  effort?: ReasoningEffort
): SamplingProfileParams | undefined {
  if (!model) return undefined;
  if (!configuredSamplingLookup) {
    try {
      const configManager = new ConfigManager();
      configuredSamplingLookup = (m, mode) => configManager.getSamplingProfile(m, mode);
    } catch {
      // No readable config: only the built-in table remains.
      configuredSamplingLookup = () => undefined;
    }
  }
  return configuredSamplingLookup(model, samplingModeFor(effort));
}

/**
 * Testing helper: injects a sampling profile lookup, or clears the cached one so the
 * next call reads the config file again.
 */
export function __setSamplingProfileLookupForTest(
  lookup?: (model: string, mode: 'thinking' | 'instruct') => SamplingProfileParams | undefined
): void {
  configuredSamplingLookup = lookup;
}

/**
 * Defaults of the model family: the built-in table, with the JSON config on top —
 * so tsuka.config.json can tune (or fully replace) the shipped values.
 */
export function resolveFamilySamplingParams(
  model?: string,
  effort?: ReasoningEffort
): WireSamplingParams {
  return {
    ...(resolveModelSamplingProfile(model, effort) ?? {}),
    ...(resolveConfiguredSamplingProfile(model, effort) ?? {})
  };
}

/**
 * Merges, in decreasing priority: explicit per-call values, creativity preset,
 * defaults of the model family.
 */
export function resolveSamplingParams(options?: ChatOptions, model?: string): WireSamplingParams {
  const family = resolveFamilySamplingParams(model, options?.reasoningEffort);

  let temperature = options?.temperature;
  let top_p = options?.topP;
  let presence_penalty = options?.presencePenalty;
  let frequency_penalty = options?.frequencyPenalty;
  let top_k = options?.topK;
  let min_p = options?.minP;
  let repetition_penalty = options?.repetitionPenalty;

  if (options?.creativity) {
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

  temperature = temperature ?? family.temperature;
  top_p = top_p ?? family.top_p;
  presence_penalty = presence_penalty ?? family.presence_penalty;
  frequency_penalty = frequency_penalty ?? family.frequency_penalty;
  top_k = top_k ?? family.top_k;
  min_p = min_p ?? family.min_p;
  repetition_penalty = repetition_penalty ?? family.repetition_penalty;

  const result: WireSamplingParams = {};
  if (temperature !== undefined) result.temperature = temperature;
  if (top_p !== undefined) result.top_p = top_p;
  if (presence_penalty !== undefined) result.presence_penalty = presence_penalty;
  if (frequency_penalty !== undefined) result.frequency_penalty = frequency_penalty;
  if (top_k !== undefined) result.top_k = top_k;
  if (min_p !== undefined) result.min_p = min_p;
  if (repetition_penalty !== undefined) {
    result.repetition_penalty = repetition_penalty;
    result.repeat_penalty = repetition_penalty;
  }
  return result;
}

/**
 * Parameters actually sent with the request: the resolved ones, minus the extended
 * knobs if this backend has already rejected them.
 */
export function samplingParamsForRequest(
  options: ChatOptions | undefined,
  model: string
): WireSamplingParams {
  const params = resolveSamplingParams(options, model);
  return extendedSamplingUnsupported ? stripExtendedSamplingParams(params) : params;
}

/** Names sent outside the OpenAI schema: dropped when a backend rejects them. */
const EXTENDED_SAMPLING_KEYS = ['top_k', 'min_p', 'repetition_penalty', 'repeat_penalty'] as const;

/** Keeps only the parameters of the standard OpenAI schema. */
export function stripExtendedSamplingParams(params: WireSamplingParams): WireSamplingParams {
  const out: WireSamplingParams = { ...params };
  for (const key of EXTENDED_SAMPLING_KEYS) delete out[key];
  return out;
}

export interface ChatStats {
  /** Total wall-clock time of the call, prompt ingestion included. */
  durationMs: number;
  tokenCount: number;
  /** Generation speed: tokens divided by the decode window only (prefill excluded). */
  tokensPerSecond: number;
  promptTokens: number;
  totalTokens: number;
  /** Time to first token, measured from the start of the successful attempt (T14.9). */
  ttftMs?: number;
  /** Duration of the decode phase, from the first token to the end of the stream. */
  decodeMs?: number;
  /** Prompt ingestion speed measured client-side: promptTokens / TTFT. */
  prefillTokensPerSecond?: number;
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

        if (error.message?.includes('reasoning_effort') && options?.reasoningEffort) {
          options = { ...options, reasoningEffort: undefined };
          continue;
        }

        // Backend without extended sampling knobs: drop them and retry. They live outside
        // the OpenAI schema (llama.cpp and vLLM read them, other servers reject the request).
        if (!extendedSamplingUnsupported && isExtendedSamplingRejectionError(error.message)) {
          extendedSamplingUnsupported = true;
          logSink.log(
            chalk.yellow(
              `[Sampling] Model '${this.currentModel}' rejected top_k/min_p/repetition_penalty: ` +
              `parameters dropped for this session, retrying without them.`
            )
          );
          // A rejected parameter is our fault, not the model's: the retry budget stays intact
          // (this branch can run only once per session, extendedSamplingUnsupported is now set).
          attempt--;
          continue;
        }

        // Backend without logprobs support: degrade visibly, never silently (T14.9).
        if (logprobsEnabled && isLogprobsRejectionError(error.message)) {
          logprobsEnabled = false;
          logprobsUnsupported = true;
          logSink.log(
            chalk.yellow(
              `[Telemetry] Model '${this.currentModel}' rejected 'logprobs': latent space inspection ` +
              `disabled for this session, retrying without it.`
            )
          );
          // A rejected parameter is our fault, not the model's: the retry budget stays intact
          // (this branch can run only once per session, logprobsUnsupported is now set).
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
