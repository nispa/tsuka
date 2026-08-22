/**
 * Pluggable long-term memory subsystem (AGENTS.md directive 8).
 *
 * Public surface (identical to the pre-refactor single-file module):
 * - Types & helpers: MemoryFact, MemoryKind, SearchOptions, AddFactOptions,
 *   UpdateFactPatch, GLOBAL_SCOPE, MEMORY_KIND_TOKENS, resolveMemoryKind,
 *   scopeFromWorkspaceRoot.
 * - Default implementation: JsonMemoryBackend.
 * - Plugin machinery: MemoryBackend contract, registerMemoryBackend,
 *   createMemoryBackend, listMemoryBackends, MemoryBackendFactory.
 * - Compatibility entry point: MemoryStore facade delegating to the active backend
 *   selected via `memoryBackend` in tsuka.config.json or TSUKA_MEMORY_BACKEND.
 */
export * from './types';
export { JsonMemoryBackend } from './jsonBackend';
export { AUTO_TAGS_MAX } from './bm25';
export {
  registerMemoryBackend,
  createMemoryBackend,
  listMemoryBackends,
  resolveMemoryBackendName,
} from './registry';
export type { MemoryBackendFactory } from './registry';
export { MemoryStore } from './facade';
