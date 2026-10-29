import { ConfigManager } from '../../core/config';
import { SANDBOX_DEFAULTS } from '../../core/constants';
import { hostSandbox } from './hostSandbox';
import { mxcSandbox } from './mxcSandbox';
import { ExecutionSandbox, SandboxStatus } from './types';

const sandboxes = new Map<string, ExecutionSandbox>();

/**
 * Registers (or replaces) an execution sandbox under its name. Built-in backends register
 * at module load, tests and plug-ins at startup; the active one is chosen from
 * configuration (`sandbox.backend`), never imported by the tool that runs commands.
 */
export function registerExecutionSandbox(sandbox: ExecutionSandbox): void {
  const key = sandbox.name.trim().toLowerCase();
  if (!key) throw new Error('Execution sandbox name must be a non-empty string.');
  sandboxes.set(key, sandbox);
}

export function listExecutionSandboxes(): string[] {
  return Array.from(sandboxes.keys()).sort();
}

/**
 * The configured sandbox. An unknown name throws instead of falling back to `host`:
 * a user who asked for confinement must never get an unconfined shell silently.
 */
export function getExecutionSandbox(name: string = new ConfigManager().getSandboxBackend()): ExecutionSandbox {
  const key = name.trim().toLowerCase() || SANDBOX_DEFAULTS.backend;
  const sandbox = sandboxes.get(key);
  if (!sandbox) {
    throw new Error(`Unknown execution sandbox '${key}'. Registered sandboxes: ${listExecutionSandboxes().join(', ')}.`);
  }
  return sandbox;
}

/**
 * Status of the configured sandbox for banners, status lines and workflow logs. Never throws:
 * an unknown name is reported as an unavailable sandbox, which is what execute_command does with it.
 */
export function describeActiveSandbox(): SandboxStatus {
  const name = new ConfigManager().getSandboxBackend();
  try {
    return getExecutionSandbox(name).describe();
  } catch (err: any) {
    return { name, available: false, reason: err.message };
  }
}

/** One line for humans: what runs commands, or why nothing will. */
export function formatSandboxStatus(status: SandboxStatus): string {
  if (status.available) return `${status.name}${status.detail ? ` (${status.detail})` : ''}`;
  return `${status.name} UNAVAILABLE: ${status.reason ?? 'no reason given'} — execute_command will refuse to run`;
}

registerExecutionSandbox(hostSandbox);
// Registering does not load the MXC SDK: that happens only when `mxc` is described or launched.
registerExecutionSandbox(mxcSandbox);
