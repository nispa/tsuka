import * as fs from 'fs';
import { ConfigManager, CONFIG_PATH } from './config';
import { ChatMessage } from './types';

/**
 * Context ceiling for individual tool execution results (T8.8).
 *
 * Built-in byte limits in individual tools (5MB for `read_file`/`grep_search`, 50KB for
 * `execute_command`) protect against unbounded process memory, but can still overflow
 * the active LLM context window.
 *
 * `capForContext` enforces a strict token budget (~3.5 chars/token convention matching
 * `Agent.charsPerToken`). A truncation note explains omitted content and how to query remaining
 * portions using `grep_search` or `read_file` with offset/limit pagination.
 */

const CHARS_PER_TOKEN = 3.5;

const DEFAULT_RECOVERY_HINT =
  "To read the rest: use grep_search to find specific terms, or read_file with " +
  "offset/limit (or startLine/endLine) to page through subsequent lines.";

let cachedConfigManager: ConfigManager | null = null;
let cachedConfigMtime = -1;

function getSharedConfigManager(): ConfigManager {
  let mtime = -1;
  try {
    mtime = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {}
  if (!cachedConfigManager || mtime !== cachedConfigMtime) {
    cachedConfigManager = new ConfigManager();
    cachedConfigMtime = mtime;
  }
  return cachedConfigManager;
}

/** Returns the configured context cap for a single tool result in estimated tokens. */
export function getMaxToolResultTokens(): number {
  return getSharedConfigManager().getMaxToolResultTokens();
}

/** Calculates total raw character count across a message array. */
export function sumMessageChars(msgs: Array<Pick<ChatMessage, 'content' | 'tool_calls'>>): number {
  let chars = 0;
  for (const m of msgs) {
    if (typeof m.content === 'string') chars += m.content.length;
    if (m.tool_calls) {
      try { chars += JSON.stringify(m.tool_calls).length; } catch {}
    }
  }
  return chars;
}

/**
 * Estimates token count for an array of messages using the specified or default character ratio.
 */
export function estimateMessagesTokens(
  msgs: Array<Pick<ChatMessage, 'content' | 'tool_calls'>>,
  charsPerToken: number = CHARS_PER_TOKEN
): number {
  return Math.ceil(sumMessageChars(msgs) / charsPerToken);
}

export interface CapForContextOptions {
  /** Target content description in the truncation note (e.g. "file 'x.txt'"). */
  label?: string;
  /** Custom recovery hint to include in the truncation note. */
  recoveryHint?: string;
}

/**
 * Truncates text exceeding the token limit, retaining head and tail with an informative notice.
 */
export function capForContext(text: string, maxTokens?: number, options: CapForContextOptions = {}): string {
  const limit = maxTokens ?? getMaxToolResultTokens();
  const maxChars = Math.max(0, Math.floor(limit * CHARS_PER_TOKEN));
  if (text.length <= maxChars) {
    return text;
  }

  const label = options.label || 'this content';
  const recoveryHint = options.recoveryHint || DEFAULT_RECOVERY_HINT;
  const totalTokensEst = Math.ceil(text.length / CHARS_PER_TOKEN);

  const note =
    `\n\n[--- TRUNCATED to remain within context budget: ${label} is ~${totalTokensEst} ` +
    `estimated tokens; showing ~${limit} token slice. ${recoveryHint} ---]\n\n`;

  // Retain head and tail (60/40 ratio) to keep headers and final exit codes/errors
  const remaining = Math.max(0, maxChars - note.length);
  const headChars = Math.ceil(remaining * 0.6);
  const tailChars = remaining - headChars;

  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(text.length - tailChars) : '';

  return head + note + tail;
}

export type ReasoningEffortLevel = 'none' | 'low' | 'medium' | 'xhigh' | 'high';

export interface ReasoningBudgetResult {
  /** Effective reasoning effort level (dynamically throttled if context is constrained). */
  effectiveEffort?: string;
  /** Whether concision directive should be injected into prompt. */
  concisionRequired: boolean;
  /** Estimated maximum allowed reasoning tokens for this round. */
  maxReasoningTokens: number;
  /** Percentage of remaining free context window. */
  freeContextPercent: number;
}

/**
 * Calculates allowed reasoning effort and token budget based on remaining context (T11.10).
 * Prevents mid-CoT truncation and unexpected context overflow errors.
 */
export function calculateReasoningBudget(
  promptTokens: number,
  maxContextTokens: number,
  requestedEffort?: string
): ReasoningBudgetResult {
  const safeMax = Math.max(1024, maxContextTokens);
  const remaining = Math.max(0, safeMax - promptTokens);
  const freePercent = Math.round((remaining / safeMax) * 100);

  const effort = typeof requestedEffort === 'string' ? requestedEffort.toLowerCase() : undefined;

  // Plentiful context (> 55% free): no throttling
  if (freePercent > 55) {
    return {
      effectiveEffort: requestedEffort,
      concisionRequired: false,
      maxReasoningTokens: Math.min(8192, Math.floor(remaining * 0.6)),
      freeContextPercent: freePercent
    };
  }

  // Moderate context (30% - 55% free): advise concision, cap xhigh at medium
  if (freePercent >= 30) {
    let throttledEffort = requestedEffort;
    if (effort === 'xhigh' || effort === 'high') {
      throttledEffort = 'medium';
    }
    return {
      effectiveEffort: throttledEffort,
      concisionRequired: true,
      maxReasoningTokens: Math.min(4096, Math.floor(remaining * 0.5)),
      freeContextPercent: freePercent
    };
  }

  // Critical context (< 30% free): aggressive throttling and mandatory concision
  let throttledEffort: string | undefined = 'none';
  if (effort === 'xhigh' || effort === 'high' || effort === 'medium') {
    throttledEffort = freePercent >= 15 ? 'low' : 'none';
  } else if (effort === 'low') {
    throttledEffort = freePercent >= 15 ? 'low' : 'none';
  } else {
    throttledEffort = requestedEffort;
  }

  return {
    effectiveEffort: throttledEffort,
    concisionRequired: true,
    maxReasoningTokens: Math.min(2048, Math.floor(remaining * 0.4)),
    freeContextPercent: freePercent
  };
}
