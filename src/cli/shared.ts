/**
 * Backward-compatible CLI barrel for the persona subsystem.
 *
 * Persona loading and prompt assembly are core application behavior: tools and
 * alternate frontends must not depend on the CLI package to resolve an agent.
 */
export * from '../core/personas';

import chalk from 'chalk';
import { getModelProfile, getRecommendedEffort } from '../core/modelProfile';
import { getModelTier, isOpenRouterProvider } from '../tools/registry';
import type { ReasoningEffort } from '../core/provider';
import { CLITheme } from './ui';

/** Warns when the active model has no measured capability profile. */
export function notifyIfUnprofiled(model: string, effort?: ReasoningEffort, providerBaseUrl?: string): void {
  if (!model) return;
  if (isOpenRouterProvider(providerBaseUrl)) {
    CLITheme.info('OpenRouter cloud policy active: tool tier defaults to LARGE; no benchmark is required.');
    return;
  }
  const profile = getModelProfile(model, effort);
  if (profile) {
    const recommended = getRecommendedEffort(model);
    if (recommended) {
      const matchHint = effort && effort === recommended
        ? chalk.green('(already active)')
        : chalk.cyan(`use /effort ${recommended} to configure`);
      CLITheme.info(`💡 Active benchmark profile: recommended effort ${chalk.magenta.bold(recommended.toUpperCase())} (${matchHint})`);
    }
    return;
  }
  const estimated = getModelTier(model, effort, providerBaseUrl);
  CLITheme.warning(`Model not yet profiled: tier estimated by name = '${estimated}' (higher-tier tools remain hidden).`);
  CLITheme.info(`Run ${chalk.cyan('/benchmark')} to measure real capabilities and calibrate tier.`);
}
