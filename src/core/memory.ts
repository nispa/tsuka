import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { homePath } from './apphome';
import { ConfigManager } from './config';
import { logSink } from './logSink';

/**
 * Kind of stored fact (T6.1): guides score-based eviction.
 * 'run' is evicted first (condensed turn notes), 'lezione' lasts the longest (lasting teachings).
 */
export type MemoryKind = 'fatto' | 'decisione' | 'lezione' | 'run';

const VALID_KINDS: MemoryKind[] = ['fatto', 'decisione', 'lezione', 'run'];
function isValidKind(k: any): k is MemoryKind {
  return typeof k === 'string' && (VALID_KINDS as string[]).includes(k);
}

/** Eviction weight per kind: higher = survives longer. */
const KIND_WEIGHT: Record<MemoryKind, number> = { run: 0, fatto: 1, decisione: 2, lezione: 3 };

/** Scope reserved for facts visible across all workspaces. */
export const GLOBAL_SCOPE = 'globale';

/** Inherently shareable kinds (T8.2): visible across agents regardless of source filter. */
const SHAREABLE_KINDS: MemoryKind[] = ['lezione', 'decisione'];

/**
 * Options for search() (T8.3/T8.4).
 */
export interface SearchOptions {
  /** Filter by authoring agent source in read operations. */
  sources?: string[];
  /** If false, search does not increment hits or write lastUsed to disk (T8.4). */
  touch?: boolean;
}

/**
 * A single remembered fact in persistent shared memory.
 */
export interface MemoryFact {
  id: string;
  content: string;
  source: string;    // Author name (agent name or 'user')
  timestamp: string; // ISO 8601
  scope: string;     // Workspace slug, or GLOBAL_SCOPE
  kind: MemoryKind;  // Category guiding eviction (default: 'fatto')
  tags?: string[];
  pinned?: boolean;  // If true, exempt from eviction
  hits: number;      // Frequency count returned by search()
  lastUsed: string;  // ISO 8601 of creation or last search() retrieval
}

export interface AddFactOptions {
  scope?: string;
  kind?: MemoryKind;
  tags?: string[];
  pinned?: boolean;
}

interface MemoryFile {
  facts: MemoryFact[];
}

/**
 * Derives a stable scope slug from the workspace root path (T6.1).
 */
export function scopeFromWorkspaceRoot(root: string): string {
  const normalized = path.resolve(root).toLowerCase();
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  const base = path.basename(normalized).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 24) || 'ws';
  return `${base}-${hash}`;
}

const FINAL_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * Lightweight morphological normalization token helper for search matching (T8.3).
 */
function normalizeToken(token: string): string {
  let s = token.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.length > 3) {
    const last = s.charAt(s.length - 1);
    if (last === 's' || FINAL_VOWELS.has(last)) {
      s = s.slice(0, -1);
    }
  }
  return s;
}

function normalizeText(text: string): string {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .map(normalizeToken)
    .join(' ');
}

/**
 * MemoryStore: Persistent shared long-term memory across sessions.
 *
 * - Facts are persisted in `memory/memory.json`.
 * - Singleton access with automatic mtime reload on disk changes.
 * - Workspace scoped with global fallthrough (`GLOBAL_SCOPE`).
 */
export class MemoryStore {
  private static instance: MemoryStore | null = null;

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
   * @param filePath Path to memory JSON file (default: memory/memory.json in app home).
   * @param maxFacts Maximum number of facts retained before eviction (default from config).
   * @param scope Scope of this instance (default: slug derived from workspace root).
   */
  constructor(filePath?: string, maxFacts?: number, scope?: string) {
    const envOverride = process.env.TSUKA_MEMORY_FILE;
    const config = new ConfigManager();
    this.filePath = filePath
      ?? (envOverride && envOverride.trim().length > 0 ? path.resolve(envOverride.trim()) : homePath('memory', 'memory.json'));
    this.maxFacts = Math.max(1, typeof maxFacts === 'number' ? maxFacts : config.getMemoryMaxFacts());
    this.scope = scope && scope.trim().length > 0
      ? scope.trim()
      : scopeFromWorkspaceRoot(config.getWorkspaceRoot());
    this.load();
  }

  /**
   * Returns the shared process singleton instance.
   */
  static getInstance(): MemoryStore {
    if (!MemoryStore.instance) {
      MemoryStore.instance = new MemoryStore();
    }
    MemoryStore.instance.reloadIfChanged();
    return MemoryStore.instance;
  }

  private normalizeFact(raw: any): MemoryFact {
    return {
      id: raw.id,
      content: raw.content,
      source: raw.source,
      timestamp: raw.timestamp,
      scope: typeof raw.scope === 'string' && raw.scope.trim().length > 0 ? raw.scope : GLOBAL_SCOPE,
      kind: isValidKind(raw.kind) ? raw.kind : 'fatto',
      tags: Array.isArray(raw.tags) && raw.tags.length > 0 ? raw.tags.map(String) : undefined,
      pinned: raw.pinned === true ? true : undefined,
      hits: typeof raw.hits === 'number' && raw.hits >= 0 ? raw.hits : 0,
      lastUsed: typeof raw.lastUsed === 'string' && raw.lastUsed.length > 0 ? raw.lastUsed : raw.timestamp,
    };
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.loadedMtime = fs.statSync(this.filePath).mtimeMs;
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as MemoryFile;
        const rawFacts = Array.isArray(data.facts) ? data.facts : [];
        this.facts = rawFacts.map((f) => this.normalizeFact(f));
      } else {
        this.facts = [];
        this.loadedMtime = -1;
      }
    } catch (error: any) {
      logSink.error(`Error reading shared memory (${this.filePath}): ${error.message}. Initializing empty memory.`);
      this.facts = [];
      this.loadedMtime = -1;
    }
    this.useOrder = new Map();
    this.useSeq = 0;
    for (const f of this.facts) {
      this.touch(f.id);
    }
  }

  private reloadIfChanged(): void {
    try {
      const mtime = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).mtimeMs : -1;
      if (mtime !== this.loadedMtime) {
        this.load();
      }
    } catch {}
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: MemoryFile = { facts: this.facts };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.loadedMtime = fs.statSync(this.filePath).mtimeMs;
    } catch (error: any) {
      logSink.error(`Error saving shared memory: ${error.message}`);
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

  private evictionScore(fact: MemoryFact, recencyRank: number, totalCandidates: number): number {
    const recencyScore = totalCandidates > 1 ? recencyRank / (totalCandidates - 1) : 1;
    const hitsScore = Math.min(fact.hits ?? 0, 20) / 20;
    const kindScore = (KIND_WEIGHT[fact.kind] ?? KIND_WEIGHT.fatto) / KIND_WEIGHT.lezione;
    return kindScore * 100 + recencyScore * 10 + hitsScore;
  }

  private evictIfNeeded(): void {
    while (this.facts.length > this.maxFacts) {
      const candidates = this.facts.filter((f) => !f.pinned);
      if (candidates.length === 0) break;

      const byUseOrder = [...candidates].sort(
        (a, b) => (this.useOrder.get(a.id) ?? -1) - (this.useOrder.get(b.id) ?? -1)
      );
      const rankOf = new Map<MemoryFact, number>();
      byUseOrder.forEach((f, i) => rankOf.set(f, i));
      const total = byUseOrder.length;

      let worst = candidates[0];
      let worstScore = this.evictionScore(worst, rankOf.get(worst)!, total);
      for (let i = 1; i < candidates.length; i++) {
        const f = candidates[i];
        const score = this.evictionScore(f, rankOf.get(f)!, total);
        if (score < worstScore) {
          worst = f;
          worstScore = score;
        }
      }
      this.facts = this.facts.filter((f) => f !== worst);
    }
  }

  /**
   * Adds a new fact to memory. Evicts low-scoring facts if capacity is exceeded.
   */
  addFact(content: string, source: string, opts?: AddFactOptions): MemoryFact {
    const timestamp = new Date().toISOString();
    const fact: MemoryFact = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      content: content.trim(),
      source,
      timestamp,
      scope: opts?.scope && opts.scope.trim().length > 0 ? opts.scope.trim() : this.scope,
      kind: opts?.kind && isValidKind(opts.kind) ? opts.kind : 'fatto',
      hits: 0,
      lastUsed: timestamp,
    };
    if (opts?.tags && opts.tags.length > 0) fact.tags = opts.tags;
    if (opts?.pinned) fact.pinned = true;

    this.facts.push(fact);
    this.touch(fact.id);
    this.evictIfNeeded();
    this.save();
    return fact;
  }

  /**
   * Returns recent facts visible in this scope, sorted newest first.
   */
  getRecent(limit: number = 10, sources?: string[]): MemoryFact[] {
    const visible = this.filterBySource(this.visibleFacts(), sources);
    return [...visible].reverse().slice(0, limit);
  }

  /**
   * Performs keyword search with OR scoring across visible facts.
   */
  search(query: string, limit: number = 10, opts?: SearchOptions): MemoryFact[] {
    const keywords = query.split(/\s+/).filter((k) => k.length > 0).map(normalizeToken);
    const touch = opts?.touch !== false;
    let results: MemoryFact[];

    if (keywords.length === 0) {
      results = this.getRecent(limit, opts?.sources);
    } else {
      const candidates = this.filterBySource(this.visibleFacts(), opts?.sources);
      const scored = candidates
        .map((f) => {
          const haystack = normalizeText(`${f.content} ${(f.tags ?? []).join(' ')}`);
          const score = keywords.reduce((acc, k) => acc + (haystack.includes(k) ? 1 : 0), 0);
          return { fact: f, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (this.useOrder.get(b.fact.id) ?? -1) - (this.useOrder.get(a.fact.id) ?? -1);
        });
      results = scored.slice(0, limit).map((x) => x.fact);
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

  clear(): void {
    this.facts = [];
    this.useOrder = new Map();
    this.save();
  }

  count(): number {
    return this.visibleFacts().length;
  }

  /**
   * Compact section formatted for injection into system prompts.
   */
  formatForPrompt(limit: number = 10, maxChars?: number, sources?: string[]): string {
    const cap = typeof maxChars === 'number' ? maxChars : new ConfigManager().getMemoryMaxChars();
    const visible = this.filterBySource(this.visibleFacts(), sources);
    if (visible.length === 0) {
      return '';
    }
    const recent = this.getRecent(limit, sources);
    const lines: string[] = [];
    let total = 0;
    for (const f of recent) {
      const date = f.timestamp.slice(0, 10);
      const line = `- [${date}] (${f.source}) ${f.content}`;
      if (total + line.length > cap) {
        break;
      }
      lines.push(line);
      total += line.length;
    }
    const omitted = visible.length - lines.length;
    let section = lines.join('\n');
    if (omitted > 0) {
      section += `\n… (${omitted} more memories available: use recall_memory to search)`;
    }
    return section;
  }

  /**
   * Formats relevant memories for prompt injection based on task query relevance.
   */
  formatRelevant(taskText: string, limit: number = 10, maxChars?: number, sources?: string[]): string {
    const text = (taskText || '').trim();
    const cap = typeof maxChars === 'number' ? maxChars : new ConfigManager().getMemoryMaxChars();
    if (!text) {
      return this.formatForPrompt(limit, cap, sources);
    }
    const relevant = this.search(text, limit, { sources, touch: false });
    if (relevant.length === 0) {
      return '';
    }
    const lines: string[] = [];
    let total = 0;
    for (const f of relevant) {
      const date = f.timestamp.slice(0, 10);
      const line = `- [${date}] (${f.source}) ${f.content}`;
      if (total + line.length > cap) {
        break;
      }
      lines.push(line);
      total += line.length;
    }
    const omitted = relevant.length - lines.length;
    let section = lines.join('\n');
    if (omitted > 0) {
      section += `\n… (${omitted} more relevant memories available: use recall_memory to search)`;
    }
    return section;
  }
}
