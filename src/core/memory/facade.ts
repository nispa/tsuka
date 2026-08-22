import { createMemoryBackend } from './registry';
import { AddFactOptions, MemoryBackend, SearchOptions, UpdateFactPatch, MemoryFact } from './types';

/**
 * Compatibility facade over the pluggable memory system (AGENTS.md directive 8).
 *
 * Every existing call site (`Agent`, goal orchestrator, spawnAgent, memory tools, CLI,
 * TUI) keeps using `MemoryStore` exactly as before; underneath, each instance forwards
 * to whichever `MemoryBackend` is registered and selected via configuration
 * (`memoryBackend` in tsuka.config.json or the TSUKA_MEMORY_BACKEND env var).
 */
export class MemoryStore {
  private static instance: MemoryStore | null = null;

  private readonly backend: MemoryBackend;

  /**
   * @param filePath Path to the backing storage (default resolved by the backend).
   * @param maxFacts Maximum facts retained before eviction (default from config).
   * @param scope Scope of this instance (default: slug derived from workspace root).
   */
  constructor(filePath?: string, maxFacts?: number, scope?: string) {
    this.backend = createMemoryBackend({ filePath, maxFacts, scope });
  }

  /**
   * Returns the shared process singleton backed by the active configured backend,
   * refreshing external state before every use (file mtime for the JSON backend).
   */
  static getInstance(): MemoryStore {
    if (!MemoryStore.instance) {
      MemoryStore.instance = new MemoryStore();
    }
    MemoryStore.instance.backend.refresh?.();
    return MemoryStore.instance;
  }

  /** The underlying backend instance (escape hatch for diagnostics and tests). */
  get activeBackend(): MemoryBackend {
    return this.backend;
  }

  addFact(content: string, source: string, opts?: AddFactOptions): MemoryFact {
    return this.backend.addFact(content, source, opts);
  }

  getRecent(limit: number = 10, sources?: string[]): MemoryFact[] {
    return this.backend.getRecent(limit, sources);
  }

  search(query: string, limit: number = 10, opts?: SearchOptions): MemoryFact[] {
    return this.backend.search(query, limit, opts);
  }

  remove(id: string): boolean {
    return this.backend.remove(id);
  }

  updateFact(id: string, patch: UpdateFactPatch): MemoryFact | null {
    return this.backend.updateFact(id, patch);
  }

  forgetFact(id: string): boolean {
    return this.backend.forgetFact(id);
  }

  clear(): void {
    this.backend.clear();
  }

  count(): number {
    return this.backend.count();
  }

  formatForPrompt(limit: number = 10, maxChars?: number, sources?: string[]): string {
    return this.backend.formatForPrompt(limit, maxChars, sources);
  }

  formatRelevant(taskText: string, limit: number = 10, maxChars?: number, sources?: string[]): string {
    return this.backend.formatRelevant(taskText, limit, maxChars, sources);
  }
}
