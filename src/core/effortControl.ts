import chalk from 'chalk';
import { ReasoningEffort } from './provider';
import { logSink } from './logSink';

/**
 * Global runtime control of reasoning_effort (T8.14):
 * sits atop the 4-level cascade from T8.10 (`resolveReasoningEffort`, `agent.ts`),
 * controlled by the `/effort` command. Final precedence:
 * **global pin -> caller override -> character -> role -> config default**.
 *
 * Ephemeral PROCESS state: module variables, never written to `tsuka.config.json`.
 */

let pin: ReasoningEffort | undefined;
let askMode = false;

/** Active global pin, if present (undefined = no pin, cascade unchanged). */
export function getEffortPin(): ReasoningEffort | undefined {
  return pin;
}

/** Sets (or removes with undefined) the global effort pin. */
export function setEffortPin(effort: ReasoningEffort | undefined): void {
  pin = effort;
}

/** Returns true if `/effort ask` mode is active. */
export function isAskModeEnabled(): boolean {
  return askMode;
}

export function setAskMode(enabled: boolean): void {
  askMode = enabled;
}

/**
 * Reset helper for testing environments.
 */
export function resetEffortControlForTest(): void {
  pin = undefined;
  askMode = false;
}

/**
 * Applies the pin over an already-resolved cascade value or caller override.
 */
export function withEffortPin(cascaded: ReasoningEffort | undefined): ReasoningEffort | undefined {
  return pin ?? cascaded;
}

export type EffortSource = 'pin' | 'personaggio' | 'ruolo' | 'default' | 'nessuno';

/**
 * Resolves source of the active reasoning effort for interactive display.
 */
export function describeEffortSource(
  character: object | null | undefined,
  role: object | null | undefined,
  configDefault: ReasoningEffort | undefined
): { effort: ReasoningEffort | undefined; source: EffortSource } {
  const char = character as { reasoningEffort?: ReasoningEffort } | null | undefined;
  const r = role as { reasoningEffort?: ReasoningEffort } | null | undefined;
  if (pin) return { effort: pin, source: 'pin' };
  if (char?.reasoningEffort !== undefined) return { effort: char.reasoningEffort, source: 'personaggio' };
  if (r?.reasoningEffort !== undefined) return { effort: r.reasoningEffort, source: 'ruolo' };
  if (configDefault !== undefined) return { effort: configDefault, source: 'default' };
  return { effort: undefined, source: 'nessuno' };
}

/**
 * Reference effort level used for divergence detection (T8.14).
 */
export function getReferenceEffort(configDefault: ReasoningEffort | undefined): ReasoningEffort | undefined {
  return pin ?? configDefault;
}

const effortLabel = (e: ReasoningEffort | undefined) => e ?? 'none (model decides)';

/**
 * Compares two tool lists (before/after an effort change) and returns a human-readable diff.
 */
export function describeToolDiff(before: string[], after: string[]): string | null {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((t) => !beforeSet.has(t));
  const removed = before.filter((t) => !afterSet.has(t));
  if (added.length === 0 && removed.length === 0) return null;
  const parts: string[] = [];
  if (added.length > 0) parts.push(`+${added.length} available (${added.join(', ')})`);
  if (removed.length > 0) parts.push(`-${removed.length} hidden (${removed.join(', ')})`);
  return parts.join('; ');
}

/**
 * Logs (log-only, never interactive) when an agent turn's effective effort diverges from reference.
 */
export function logEffortDivergence(
  agentLabel: string,
  effective: ReasoningEffort | undefined,
  configDefault: ReasoningEffort | undefined
): void {
  const reference = getReferenceEffort(configDefault);
  if (effective === reference) return;
  logSink.log(chalk.gray(
    `[Effort] ${agentLabel}: turn at '${effortLabel(effective)}' (reference: '${effortLabel(reference)}'${pin ? ', pin active' : ''}).`
  ));
}

/**
 * Interactive confirmation used in interactive REPL chat when askMode is active.
 */
export async function confirmEffortDivergence(
  agentLabel: string,
  effective: ReasoningEffort | undefined,
  configDefault: ReasoningEffort | undefined,
  confirmFn: (effective: ReasoningEffort | undefined, reference: ReasoningEffort | undefined) => Promise<boolean>
): Promise<ReasoningEffort | undefined> {
  const currentPin = getEffortPin();
  if (currentPin !== undefined && effective === currentPin) {
    return effective;
  }
  const reference = getReferenceEffort(configDefault);
  if (effective === reference) return effective;
  if (!askMode) {
    logEffortDivergence(agentLabel, effective, configDefault);
    return effective;
  }
  const proceed = await confirmFn(effective, reference);
  if (proceed) return effective;
  logSink.log(chalk.yellow(
    `[Effort] Turn rejected at '${effortLabel(effective)}': executing at reference '${effortLabel(reference)}' instead.`
  ));
  return reference;
}
