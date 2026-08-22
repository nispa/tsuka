import { ConfigManager } from '../config';
import { InferenceTelemetryEvent, InferenceTelemetrySink } from './types';

/** Number of alternative tokens requested when logprobs inspection is enabled (T14.9). */
export const LOGPROBS_TOP_N = 3;

/** Minimum interval between two live decode telemetry events, to avoid one re-render per token. */
export const TELEMETRY_EMIT_INTERVAL_MS = 100;

let globalInferenceTelemetrySink: InferenceTelemetrySink | undefined;

export function setInferenceTelemetrySink(sink: InferenceTelemetrySink | undefined): void {
  globalInferenceTelemetrySink = sink;
}

export function emitInferenceTelemetry(event: InferenceTelemetryEvent): void {
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
export function isLogprobsRejectionError(message: string): boolean {
  return /logprob/i.test(message || '');
}

/**
 * Records that this backend does not support logprobs: the feature stays off for
 * the rest of the session instead of being retried on every call.
 */
export function noteLogprobsRejected(): void {
  logprobsUnsupported = true;
}

/**
 * Testing helper: forces logprobs on/off without touching the user config and
 * clears any rejection recorded by a previous test.
 */
export function __setLogprobsEnabledForTest(enabled: boolean | undefined): void {
  logprobsEnabledForTest = enabled;
  logprobsUnsupported = false;
}
