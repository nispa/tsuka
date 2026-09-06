/**
 * Configuration subsystem: shape of tsuka.config.json and its manager.
 *
 * Module map:
 * - `types.ts`    — `AppConfig` & friends, sampling-parameter whitelist, clean
 *                   default config written when the file is missing.
 * - `sampling.ts` — validation helpers for the user-configured sampling profiles.
 * - `manager.ts`  — `ConfigManager`: load/heal/save plus typed getters whose
 *                   fallbacks come from `src/core/constants.ts` (directive 9).
 */
export * from './types';
export { matchesModelId, sanitizeSamplingParams } from './sampling';
export { ConfigManager, CONFIG_PATH, resolveConfigPath } from './manager';
