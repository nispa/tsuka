import * as path from 'path';
import { homePath } from '../apphome';
import { ConfigManager } from '../config';
import { deriveTags, isMeaninglessQuery, rankByBM25 } from './bm25';
import {
  RUN_QUOTA_RATIO,
  SHAREABLE_KINDS,
  pickEvictionVictim,
  rankByRetentionValue,
} from './retention';
import {
  AddFactOptions,
  GLOBAL_SCOPE,
  isValidKind,
  MemoryBackend,
  MemoryBackendOptions,
  MemoryFact,
  SearchOptions,
  scopeFromWorkspaceRoot,
  UpdateFactPatch,
} from './types';
import {
  normalizeSummary,
  deriveSummary,
  factKey,
  mergeDuplicate,
  dedupeFacts,
} from './codec';
import {
  safeLoadJsonMemoryFile,
  atomicSaveJsonMemoryFile,
  readMemoryMtime,
} from './storage';

/**
 * JsonMemoryBackend: the default MemoryBackend implementation.
 *
 * - Facts are persisted in `memory/memory.json`.
 * - Workspace scoped with global fallthrough (`GLOBAL_SCOPE`).
 * - Retrieval scoring lives in `bm25.ts`, retention/eviction policy in `retention.ts`.
 * - Codec and serialization utilities live in `codec.ts`, atomic I/O in `storage.ts`.
 *
 * It is one implementation behind the `MemoryBackend` contract (AGENTS.md directive 8):
 * consumers depend on the contract, never on this class.
 */
export class JsonMemoryBackend implements MemoryBackend {
  readonly name = 'json';

  private filePath: string;
  private facts: MemoryFact[] = [];
  private loadedMtime = -1;
  private maxFacts: number;
  private scope: string;

  private useOrder = new Map<string, number>();
  private useSeq = 0;

  private touch(factId: string): void {
    this.useOrder.set(factId, this.useSeq++);
  }

  /**
   * @param opts.filePath Path to memory JSON file (default: memory/memory.json in app home,
   *                      overridable via TSUKA_MEMORY_FILE).
   * @param opts.maxFacts Maximum number of facts retained before eviction (default from config).
   * @param opts.scope Scope of this instance (default: slug derived from workspace root).
   */
  constructor(opts: MemoryBackendOptions = {}) {
    const envOverride = process.env.TSUKA_MEMORY_FILE;
    const config = new ConfigManager();
    this.filePath = opts.filePath
      ?? (envOverride && envOverride.trim().length > 0 ? path.resolve(envOverride.trim()) : homePath('memory', 'memory.json'));
    this.maxFacts = Math.max(1, typeof opts.maxFacts === 'number' ? opts.maxFacts : config.getMemoryMaxFacts());
    this.scope = opts.scope && opts.scope.trim().length > 0
      ? opts.scope.trim()
      : scopeFromWorkspaceRoot(config.getWorkspaceRoot());
    this.load();
  }

  private load(): void {
    const result = safeLoadJsonMemoryFile(this.filePath);
    this.facts = result.facts;
    this.loadedMtime = result.mtime;
    this.useOrder = new Map();
    this.useSeq = 0;
    for (const f of this.facts) {
      this.touch(f.id);
    }
  }

  /** MemoryBackend.refresh: reloads from disk when another process changed the file. */
  refresh(): void {
    const mtime = readMemoryMtime(this.filePath);
    if (mtime !== this.loadedMtime) {
      this.load();
    }
  }

  private save(): void {
    const newMtime = atomicSaveJsonMemoryFile(this.filePath, this.facts);
    if (newMtime > 0) {
      this.loadedMtime = newMtime;
    }
  }

  private visibleFacts(): MemoryFact[] {
    return this.facts.filter((f) => f.scope === this.scope || f.scope === GLOBAL_SCOPE);
  }

  private filterBySource(facts: MemoryFact[], sources?: string[]): MemoryFact[] {
    const own = (sources ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    if (own.length === 0) return facts;
    const ownSet = new Set(own);
    return facts.filter((f) => ownSet.has(f.source) || SHAREABLE_KINDS.includes(f.kind));
  }

  private evictIfNeeded(): void {
    const runBudget = Math.floor(this.maxFacts * RUN_QUOTA_RATIO);
    while (this.facts.length > this.maxFacts) {
      const runs = this.facts.filter((f) => !f.pinned && f.kind === 'run');
      if (runs.length > runBudget) {
        let oldestRun = runs[0];
        for (const r of runs) {
          if ((this.useOrder.get(r.id) ?? -1) < (this.useOrder.get(oldestRun.id) ?? -1)) {
            oldestRun = r;
          }
        }
        this.facts = this.facts.filter((f) => f !== oldestRun);
        this.useOrder.delete(oldestRun.id);
        continue;
      }

      const victim = pickEvictionVictim(this.facts, this.useOrder);
      if (!victim) break;
      this.facts = this.facts.filter((f) => f !== victim);
    }
  }

  addFact(content: string, source: string, opts?: AddFactOptions): MemoryFact {
    const timestamp = new Date().toISOString();
    const trimmedContent = content.trim();
    const fact: MemoryFact = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      content: trimmedContent,
      summary: normalizeSummary(opts?.summary) ?? deriveSummary(trimmedContent),
      source,
      timestamp,
      scope: opts?.scope && opts.scope.trim().length > 0 ? opts.scope.trim() : this.scope,
      kind: opts?.kind && isValidKind(opts.kind) ? opts.kind : 'fatto',
      hits: 0,
      lastUsed: timestamp,
    };
    const tags = opts?.tags && opts.tags.length > 0 ? opts.tags : deriveTags(trimmedContent);
    if (tags.length > 0) fact.tags = tags;
    if (opts?.pinned) fact.pinned = true;

    const key = factKey(fact.content, fact.scope);
    const existing = this.facts.find((f) => factKey(f.content, f.scope) === key);
    if (existing) {
      mergeDuplicate(existing, fact);
      existing.hits = (existing.hits ?? 0) + 1;
      this.touch(existing.id);
      this.save();
      return existing;
    }

    this.facts.push(fact);
    this.touch(fact.id);
    this.evictIfNeeded();
    this.save();
    return fact;
  }

  getRecent(limit: number = 10, sources?: string[]): MemoryFact[] {
    const visible = this.filterBySource(this.visibleFacts(), sources);
    return [...visible].reverse().slice(0, limit);
  }

  search(query: string, limit: number = 10, opts?: SearchOptions): MemoryFact[] {
    const touch = opts?.touch !== false;

    let results: MemoryFact[];
    if (isMeaninglessQuery(query)) {
      results = this.getRecent(limit, opts?.sources);
    } else {
      const candidates = this.filterBySource(this.visibleFacts(), opts?.sources);
      results = rankByBM25(candidates, query, limit, this.useOrder);
    }

    if (touch && results.length > 0) {
      const nowIso = new Date().toISOString();
      for (const f of results) {
        f.hits = (f.hits ?? 0) + 1;
        f.lastUsed = nowIso;
        this.touch(f.id);
      }
      this.save();
    }
    return results;
  }

  remove(id: string): boolean {
    const before = this.facts.length;
    this.facts = this.facts.filter((f) => f.id !== id);
    if (this.facts.length !== before) {
      this.useOrder.delete(id);
      this.save();
      return true;
    }
    return false;
  }

  updateFact(id: string, patch: UpdateFactPatch): MemoryFact | null {
    const target = this.facts.find((f) => f.id === id);
    if (!target) return null;
    if (typeof patch.content === 'string' && patch.content.trim().length > 0) {
      target.content = patch.content.trim();
    }
    if (typeof patch.summary === 'string' && patch.summary.trim().length > 0) {
      target.summary = normalizeSummary(patch.summary) ?? target.summary;
    }
    if (patch.kind && isValidKind(patch.kind)) {
      target.kind = patch.kind;
    }
    if (Array.isArray(patch.tags) && patch.tags.length > 0) {
      const merged = Array.from(new Set([...(target.tags ?? []), ...patch.tags.map(String)]));
      target.tags = merged.length > 0 ? merged : undefined;
    }
    const nowIso = new Date().toISOString();
    target.timestamp = nowIso;
    target.lastUsed = nowIso;
    this.touch(target.id);

    const deduped = dedupeFacts(this.facts);
    if (deduped.removed > 0) {
      this.facts = deduped.facts;
    }
    this.evictIfNeeded();
    this.save();
    const key = factKey(target.content, target.scope);
    return this.facts.find((f) => factKey(f.content, f.scope) === key) ?? target;
  }

  clear(): void {
    this.facts = [];
    this.useOrder = new Map();
    this.save();
  }

  count(): number {
    return this.visibleFacts().length;
  }

  selectForPrompt(limit: number, sources?: string[]): { facts: MemoryFact[]; available: number } {
    const visible = this.filterBySource(this.visibleFacts(), sources);
    return { facts: rankByRetentionValue(visible, this.useOrder).slice(0, limit), available: visible.length };
  }
}
