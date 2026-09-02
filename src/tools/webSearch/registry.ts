import type { WebSearchBackend, WebSearchBackendFactory, WebSearchBackendFactoryContext } from './types';

const registry = new Map<string, WebSearchBackendFactory>();

export function registerWebSearchBackend(id: string, factory: WebSearchBackendFactory): void {
  const key = id.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error('Web search backend id must be a non-empty kebab-case string.');
  registry.set(key, factory);
}

export function listWebSearchBackends(): string[] {
  return Array.from(registry.keys()).sort();
}

export function createWebSearchBackend(id: string, context: WebSearchBackendFactoryContext): WebSearchBackend {
  const key = id.trim().toLowerCase();
  const factory = registry.get(key);
  if (!factory) throw new Error(`Unknown web search backend '${key}'. Registered backends: ${listWebSearchBackends().join(', ')}.`);
  return factory(context);
}
