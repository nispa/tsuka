import { ChatMessage, ChatRole, ToolCall } from '../types';
import { StreamChannel } from '../thinkParser';
import type { ProviderClass } from '../cloudProvider';

export type { ChatRole };
export type ChatMessageLike = ChatMessage;

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export type TimeoutAction = 'extend' | 'unlimited' | 'abort';

export interface TimeoutPromptInfo {
  type: 'first_token' | 'generation_duration';
  elapsedMs: number;
  model: string;
}

export type TimeoutPromptHandler = (info: TimeoutPromptInfo) => Promise<TimeoutAction>;

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
export interface ModelSamplingProfile {
  /** Matched against the model id, provider prefix and quantization suffix included. */
  match: RegExp;
  /** Used when reasoning is active. */
  thinking: WireSamplingParams;
  /** Used when the effort is 'none', i.e. the model answers without a think block. */
  instruct: WireSamplingParams;
}

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

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Minimal contract used by Agent and CLI commands.
 */
export interface ILLMProvider {
  chatWithTools(
    messages: ChatMessage[],
    tools?: ChatToolDefinition[],
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    signal?: AbortSignal,
    options?: ChatOptions
  ): Promise<ChatResponse>;
  getCurrentModel(): string;
  setCurrentModel(model: string): void;
  getBaseUrl(): string;
  getProviderClass?(): ProviderClass;
  listModels(): Promise<string[]>;
  reconfigure(baseUrl: string, apiKey: string, defaultModel: string, providerClass?: ProviderClass): void;
}
