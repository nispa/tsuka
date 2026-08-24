import { AGENT_DEFAULTS } from './constants';

export interface TokenCalibrationState {
  charsPerToken: number;
}

/** Creates the runtime estimator state used by one Agent instance. */
export function createTokenCalibrationState(): TokenCalibrationState {
  return { charsPerToken: AGENT_DEFAULTS.seedCharsPerToken };
}

/** Estimates tokens from raw characters using the current calibrated ratio. */
export function estimateTokensFromChars(chars: number, state: TokenCalibrationState): number {
  return Math.ceil(chars / state.charsPerToken);
}

/**
 * Incorporates one provider prompt-token observation.
 *
 * Invalid or absent observations are ignored so a provider that omits usage
 * cannot corrupt the estimator used by history pruning.
 */
export function observePromptTokens(
  state: TokenCalibrationState,
  sentChars: number,
  promptTokens?: number,
  smoothing: number = AGENT_DEFAULTS.tokenRatioSmoothing
): void {
  if (!promptTokens || promptTokens <= 0) return;
  const observed = sentChars / promptTokens;
  if (!Number.isFinite(observed) || observed <= 0) return;
  state.charsPerToken = state.charsPerToken * (1 - smoothing) + observed * smoothing;
}
