/**
 * Pure context scheduler policy (T22.4).
 *
 * Evaluates ContextPressure against strictly ordered thresholds to decide
 * the next lifecycle action: continue, prepare, or delegate.
 *
 * Pure function: deterministic, side-effect free, no imports from Agent,
 * providers, or presentation layers.
 */

import { ContextPressure } from './types';
import { CONTEXT_SCHEDULER_DEFAULTS } from './constants';

export type ContextAction = 'continue' | 'prepare' | 'delegate';

export interface ContextSchedulerConfig {
  prepareAt: number;
  delegateAt: number;
}

/**
 * Validates context scheduler configuration thresholds.
 *
 * Enforces:
 * - Config is a non-null object
 * - Both prepareAt and delegateAt are finite numbers within [0, 1]
 * - Strictly ordered: prepareAt < delegateAt
 *
 * Throws on invalid configuration without silent mutation or fallback.
 */
export function validateContextSchedulerConfig(config: ContextSchedulerConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('ContextSchedulerConfig must be a non-null object.');
  }

  const { prepareAt, delegateAt } = config;

  if (typeof prepareAt !== 'number' || !Number.isFinite(prepareAt)) {
    throw new Error(`Invalid ContextSchedulerConfig: prepareAt must be a finite number, received ${prepareAt}.`);
  }

  if (typeof delegateAt !== 'number' || !Number.isFinite(delegateAt)) {
    throw new Error(`Invalid ContextSchedulerConfig: delegateAt must be a finite number, received ${delegateAt}.`);
  }

  if (prepareAt < 0 || prepareAt > 1) {
    throw new Error(`Invalid ContextSchedulerConfig: prepareAt must be within [0, 1], received ${prepareAt}.`);
  }

  if (delegateAt < 0 || delegateAt > 1) {
    throw new Error(`Invalid ContextSchedulerConfig: delegateAt must be within [0, 1], received ${delegateAt}.`);
  }

  if (prepareAt >= delegateAt) {
    throw new Error(
      `Invalid ContextSchedulerConfig: thresholds must be strictly ordered (prepareAt < delegateAt), ` +
      `received prepareAt=${prepareAt} and delegateAt=${delegateAt}.`
    );
  }
}

/**
 * Validates that context pressure is a valid object with a finite ratio.
 */
function validateContextPressure(pressure: ContextPressure): void {
  if (!pressure || typeof pressure !== 'object') {
    throw new Error('ContextPressure must be a non-null object.');
  }

  if (typeof pressure.ratio !== 'number' || !Number.isFinite(pressure.ratio) || pressure.ratio < 0) {
    throw new Error(`Invalid ContextPressure: ratio must be a finite non-negative number, received ${pressure?.ratio}.`);
  }
}

/**
 * Pure policy function for context scheduling (T22.4).
 *
 * - ratio < prepareAt: 'continue'
 * - prepareAt <= ratio < delegateAt: 'prepare'
 * - ratio >= delegateAt: 'delegate'
 *
 * When config is omitted, defaults to centralized CONTEXT_SCHEDULER_DEFAULTS (0.60 / 0.70).
 */
export function scheduleContext(
  pressure: ContextPressure,
  config: ContextSchedulerConfig = CONTEXT_SCHEDULER_DEFAULTS
): ContextAction {
  validateContextPressure(pressure);
  validateContextSchedulerConfig(config);

  if (pressure.ratio < config.prepareAt) {
    return 'continue';
  }

  if (pressure.ratio < config.delegateAt) {
    return 'prepare';
  }

  return 'delegate';
}
