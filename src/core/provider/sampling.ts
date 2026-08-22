import { ConfigManager, SamplingProfileParams } from '../config';
import { ChatOptions, ModelSamplingProfile, ReasoningEffort, WireSamplingParams } from './types';

/**
 * Built-in sampling defaults recommended by each model family's authors (T8.17).
 * Data-driven on purpose: a new family means a new row here, no branching elsewhere.
 */
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

/** Names sent outside the OpenAI schema: dropped when a backend rejects them. */
const EXTENDED_SAMPLING_KEYS = ['top_k', 'min_p', 'repetition_penalty', 'repeat_penalty'] as const;

/** Keeps only the parameters of the standard OpenAI schema. */
export function stripExtendedSamplingParams(params: WireSamplingParams): WireSamplingParams {
  const out: WireSamplingParams = { ...params };
  for (const key of EXTENDED_SAMPLING_KEYS) delete out[key];
  return out;
}

/** Identifies a backend rejecting the sampling knobs outside the OpenAI schema. */
export function isExtendedSamplingRejectionError(message: string): boolean {
  return /top_k|min_p|repetition_penalty|repeat_penalty/i.test(message || '');
}

/** True until a backend has rejected the extended knobs at least once this session. */
export function isExtendedSamplingSupported(): boolean {
  return !extendedSamplingUnsupported;
}

/** Records that this backend rejects the extended knobs: they stay off for the session. */
export function noteExtendedSamplingRejected(): void {
  extendedSamplingUnsupported = true;
}

/** Set once a backend has rejected those knobs: they stay off for the rest of the session. */
let extendedSamplingUnsupported = false;

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
