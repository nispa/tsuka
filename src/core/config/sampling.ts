import { logSink } from '../logSink';
import { SAMPLING_PARAM_KEYS, SamplingProfileParams } from './types';

/**
 * Validation helpers for the user-configured `samplingProfiles` table (T8.17).
 * Kept separate from the manager so they are testable without a config file.
 */

/**
 * Matches a samplingProfiles key against a model id: `/regex/flags` when the key is
 * wrapped in slashes, case-insensitive substring otherwise.
 */
export function matchesModelId(key: string, model: string): boolean {
  const regexForm = key.match(/^\/(.*)\/([a-z]*)$/);
  if (regexForm) {
    try {
      return new RegExp(regexForm[1], regexForm[2] || 'i').test(model);
    } catch {
      return false;
    }
  }
  return model.toLowerCase().includes(key.toLowerCase());
}

/** Keeps only known keys holding a finite number, reporting whatever it discards. */
export function sanitizeSamplingParams(raw: unknown, source: string): SamplingProfileParams | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(SAMPLING_PARAM_KEYS as readonly string[]).includes(key)) {
      logSink.log(`[Config] samplingProfiles['${source}']: unknown parameter '${key}', ignored.`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      logSink.log(`[Config] samplingProfiles['${source}'].${key}: not a number, ignored.`);
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as SamplingProfileParams) : undefined;
}
