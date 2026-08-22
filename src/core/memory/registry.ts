import { ConfigManager } from '../config';
import { JsonMemoryBackend } from './jsonBackend';
import { MemoryBackend, MemoryBackendOptions } from './types';

/**
 * Factory creating a backend instance from construction options.
 */
export type MemoryBackendFactory = (opts: MemoryBackendOptions) => MemoryBackend;

const registry = new Map<string, MemoryBackendFactory>();

/**
 * Registers (or replaces) a memory backend implementation family under the given name.
 * Called by built-in backends at module load and by plugins at startup; the active
 * backend is chosen from configuration, never hard-wired at call sites.
 */
export function registerMemoryBackend(name: string, factory: MemoryBackendFactory): void {
  const key = name.trim().toLowerCase();
  if (!key) throw new Error('Memory backend name must be a non-empty string.');
  registry.set(key, factory);
}

/**
 * Lists the names of every registered backend (useful for config validation and UX).
 */
export function listMemoryBackends(): string[] {
  return Array.from(registry.keys()).sort();
}

/**
 * Resolves the configured backend name: the TSUKA_MEMORY_BACKEND environment variable
 * wins over `memoryBackend` in tsuka.config.json; 'json' is the default.
 */
export function resolveMemoryBackendName(configured?: string): string {
  const env = process.env.TSUKA_MEMORY_BACKEND;
  if (env && env.trim().length > 0) return env.trim().toLowerCase();
  const value = (configured ?? '').trim().toLowerCase();
  return value.length > 0 ? value : 'json';
}

/**
 * Creates the active memory backend. Throws an explicit error listing the registered
 * alternatives when the configured name is unknown — a wrong backend name must never
 * silently fall back to another store.
 */
export function createMemoryBackend(nameOrOpts?: string | MemoryBackendOptions, maybeOpts?: MemoryBackendOptions): MemoryBackend {
  const opts = typeof nameOrOpts === 'string' ? (maybeOpts ?? {}) : (nameOrOpts ?? {});
  const name = resolveMemoryBackendName(
    typeof nameOrOpts === 'string' ? nameOrOpts : new ConfigManager().getMemoryBackend()
  );
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`Unknown memory backend '${name}'. Registered backends: ${listMemoryBackends().join(', ')}.`);
  }
  return factory(opts);
}

registerMemoryBackend('json', (opts) => new JsonMemoryBackend(opts));
