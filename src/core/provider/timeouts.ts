import { ConfigManager } from '../config';
import { LLM_DEFAULTS } from '../constants';
import { TimeoutAction, TimeoutPromptInfo, TimeoutPromptHandler } from './types';

export const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = LLM_DEFAULTS.firstTokenTimeoutMs;
export const DEFAULT_MAX_RETRIES = LLM_DEFAULTS.maxRetries;
export const DEFAULT_MAX_TOKENS_CEILING = LLM_DEFAULTS.maxTokensCeiling;

let maxGenerationMs = LLM_DEFAULTS.generationTimeoutMs;

/** Wall-clock budget for one chatWithTools call, configurable at runtime (T8.16). */
export function getGenerationTimeoutMs(): number {
  return maxGenerationMs;
}

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
    maxGenerationMs = ms;
  }
}

/**
 * Testing helper: lowers generation timeout without real waits.
 */
export function __setMaxGenerationMsForTest(ms: number): void {
  maxGenerationMs = ms;
}

let globalTimeoutPromptHandler: TimeoutPromptHandler | undefined;

export function setTimeoutPromptHandler(handler: TimeoutPromptHandler | undefined): void {
  globalTimeoutPromptHandler = handler;
}

/**
 * Asks the UI-level handler what to do when a timeout fires ('extend', 'unlimited',
 * 'abort'). Returns undefined when no handler is installed or it throws — the caller
 * then applies its own default (abort).
 */
export async function requestTimeoutDecision(info: TimeoutPromptInfo): Promise<TimeoutAction | undefined> {
  if (!globalTimeoutPromptHandler) return undefined;
  try {
    return await globalTimeoutPromptHandler(info);
  } catch {
    return undefined;
  }
}
