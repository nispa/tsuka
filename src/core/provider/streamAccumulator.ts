import { ThinkTagParser, StreamChannel } from '../thinkParser';
import type { ToolCall } from '../types';
import type { ChatResponse, ChatStats, InferenceCandidate } from './types';
import {
  LOGPROBS_TOP_N,
  TELEMETRY_EMIT_INTERVAL_MS,
  emitInferenceTelemetry,
} from './telemetry';

export interface StreamAccumulatorOptions {
  onChunk: (chunk: string, channel?: StreamChannel) => void;
  startTime: number;
  attemptStartTime: number;
  onFirstToken?: () => void;
}

interface StreamLogprobEntry {
  token: string;
  logprob: number;
  top_logprobs?: StreamLogprobEntry[];
}

export interface ProviderStreamChunk {
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    logprobs?: { content?: StreamLogprobEntry[] | null } | null;
  }>;
}

/**
 * Accumulates streaming SSE chunks from an LLM response, parsing thinking tags,
 * assembling fragmented tool calls, extracting logprobs, and recording telemetry.
 */
export class StreamAccumulator {
  private fullText = '';
  private reasoningText = '';
  private toolCallsAccumulator: ToolCall[] = [];
  private chunkCount = 0;
  private usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
  private firstTokenAt = 0;
  private decodedTokens = 0;
  private lastTelemetryAt = 0;
  private lastConfidence: number | undefined;
  private lastCandidates: InferenceCandidate[] | undefined;
  private thinkParser: ThinkTagParser;
  private receivedFirstToken = false;

  constructor(private readonly opts: StreamAccumulatorOptions) {
    this.thinkParser = new ThinkTagParser((text, channel) => {
      if (channel === 'content') {
        this.fullText += text;
      } else {
        this.reasoningText += text;
      }
      this.opts.onChunk(text, channel);
    });
  }

  processChunk(chunk: ProviderStreamChunk): void {
    if (!this.receivedFirstToken) {
      this.receivedFirstToken = true;
      this.opts.onFirstToken?.();
    }

    if (chunk?.usage) {
      this.usage = chunk.usage;
    }

    const choice = chunk?.choices?.[0];
    const content = choice?.delta?.content ?? '';
    const reasoning = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content ?? '';

    if (content || reasoning) {
      const logprobEntries = choice?.logprobs?.content ?? undefined;

      if (logprobEntries && logprobEntries.length > 0) {
        this.decodedTokens += logprobEntries.length;
        const last = logprobEntries[logprobEntries.length - 1];
        this.lastConfidence = Math.round(Math.exp(last.logprob) * 1000) / 10;
        this.lastCandidates = (last.top_logprobs || [])
          .slice(0, LOGPROBS_TOP_N)
          .map((c) => ({ token: c.token, prob: Math.exp(c.logprob) }));
      } else {
        this.decodedTokens++;
      }

      if (!this.firstTokenAt) {
        this.firstTokenAt = Date.now();
        emitInferenceTelemetry({ type: 'first_token', ttftMs: this.firstTokenAt - this.opts.attemptStartTime });
      }

      const now = Date.now();
      if (now - this.lastTelemetryAt >= TELEMETRY_EMIT_INTERVAL_MS) {
        this.lastTelemetryAt = now;
        emitInferenceTelemetry({
          type: 'decode',
          tokens: this.decodedTokens,
          decodeMs: now - this.firstTokenAt,
          confidence: this.lastConfidence,
          topCandidates: this.lastCandidates,
        });
      }
    }

    if (reasoning) {
      this.chunkCount++;
      this.reasoningText += reasoning;
      this.opts.onChunk(reasoning, 'reasoning');
    }

    if (content) {
      this.chunkCount++;
      this.thinkParser.push(content);
    }

    if (choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index;
        if (!this.toolCallsAccumulator[idx]) {
          this.toolCallsAccumulator[idx] = {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' }
          };
        }
        if (tc.id) this.toolCallsAccumulator[idx].id = tc.id;
        if (tc.function?.name) this.toolCallsAccumulator[idx].function.name += tc.function.name;
        if (tc.function?.arguments) this.toolCallsAccumulator[idx].function.arguments += tc.function.arguments;
      }
    }
  }

  getReasoningText(): string {
    return this.reasoningText;
  }

  finalize(): ChatResponse {
    this.thinkParser.flush();

    const cleanToolCalls = this.toolCallsAccumulator.filter(
      (tc) => tc && tc.function && tc.function.name
    );

    const endTime = Date.now();
    const durationMs = endTime - this.opts.startTime;
    const tokenCount = this.usage?.completion_tokens ?? (this.decodedTokens || this.chunkCount);
    const promptTokens = this.usage?.prompt_tokens ?? 0;
    const totalTokens = this.usage?.total_tokens ?? (promptTokens + tokenCount);

    const ttftMs = this.firstTokenAt ? this.firstTokenAt - this.opts.attemptStartTime : undefined;
    const decodeMs = this.firstTokenAt ? endTime - this.firstTokenAt : 0;
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
      content: this.fullText,
      toolCalls: cleanToolCalls.length > 0 ? cleanToolCalls : undefined,
      reasoningText: this.reasoningText || undefined,
      stats
    };
  }
}
