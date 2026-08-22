import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Kind of stored fact (T6.1): guides score-based eviction.
 * 'run' is evicted first (condensed turn notes), 'lezione' lasts the longest (lasting teachings).
 */
export type MemoryKind = 'fatto' | 'decisione' | 'lezione' | 'run';

const VALID_KINDS: MemoryKind[] = ['fatto', 'decisione', 'lezione', 'run'];
export function isValidKind(k: any): k is MemoryKind {
  return typeof k === 'string' && (VALID_KINDS as string[]).includes(k);
}

/**
 * English schema-level kind tokens (T15.3/T15.7) exposed to the LLM, mapped to the store's
 * internal pre-existing vocabulary. The mapping lives here so every memory tool uses one
 * authority instead of hand-rolled per-tool maps.
 */
export const MEMORY_KIND_TOKENS: Record<string, MemoryKind> = {
  facts: 'fatto',
  run: 'run',
  decision: 'decisione',
  lesson: 'lezione',
};

/** Resolves a tool-provided English kind token to its internal MemoryKind; throws on unknown values. */
export function resolveMemoryKind(raw: string): MemoryKind {
  const kind = MEMORY_KIND_TOKENS[raw.trim().toLowerCase()];
  if (!kind) {
    throw new Error(`Invalid kind '${raw}': choose one of ${Object.keys(MEMORY_KIND_TOKENS).join(', ')}.`);
  }
  return kind;
}

/** Scope reserved for facts visible across all workspaces. */
export const GLOBAL_SCOPE = 'globale';

/**
 * Derives a stable scope slug from the workspace root path (T6.1).
 */
export function scopeFromWorkspaceRoot(root: string): string {
  const normalized = path.resolve(root).toLowerCase();
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  const base = path.basename(normalized).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 24) || 'ws';
  return `${base}-${hash}`;
}

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
  summary: string;   // Short human-readable label (T14.20) — always populated, explicit or derived
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
  /** Short label (T14.20) — a commit subject, not the diff. Auto-derived from content if omitted. */
  summary?: string;
}

export interface UpdateFactPatch {
  content?: string;
  summary?: string;
  kind?: MemoryKind;
  tags?: string[];
}

/**
 * Construction options handed to a backend factory. All fields are optional hints:
 * a backend may ignore any of them (e.g. a remote backend has no file path).
 */
export interface MemoryBackendOptions {
  filePath?: string;
  maxFacts?: number;
  scope?: string;
}

/**
 * The pluggable long-term memory contract (AGENTS.md directive 8).
 *
 * Every consumer in the harness (Agent, goal orchestrator, memory tools, prompt builder)
 * depends on this interface — never on a concrete implementation. The JSON/BM25 store
 * shipped in `jsonBackend.ts` is the default backend registered under the name 'json';
 * alternative backends (SQLite, vector, remote) register their own factory in the registry
 * and are selected through configuration (`memory.backend` / `TSUKA_MEMORY_BACKEND`).
 */
export interface MemoryBackend {
  /** Registry name of this backend's implementation family (e.g. 'json'). */
  readonly name: string;

  /** Adds a new fact (or refreshes an existing duplicate); evicts if capacity is exceeded. */
  addFact(content: string, source: string, opts?: AddFactOptions): MemoryFact;

  /** Returns recent facts visible in the active scope, newest first. */
  getRecent(limit?: number, sources?: string[]): MemoryFact[];

  /** Keyword/relevance search over visible facts. */
  search(query: string, limit?: number, opts?: SearchOptions): MemoryFact[];

  /** Removes a fact by id; returns true when something was removed. */
  remove(id: string): boolean;

  /** Removes a fact by id (naming mirror of updateFact used by the forget tool). */
  forgetFact(id: string): boolean;

  /** Updates a fact in place; returns the surviving fact or null when the id is unknown. */
  updateFact(id: string, patch: UpdateFactPatch): MemoryFact | null;

  /** Wipes all facts visible to this backend instance. */
  clear(): void;

  /** Number of facts visible in the active scope. */
  count(): number;

  /** Compact retention-ranked section formatted for system-prompt injection. */
  formatForPrompt(limit?: number, maxChars?: number, sources?: string[]): string;

  /** Like formatForPrompt, but ranked by relevance to the given task text. */
  formatRelevant(taskText: string, limit?: number, maxChars?: number, sources?: string[]): string;

  /**
   * Optional hook invoked before every singleton use so stateful backends can pick up
   * external changes (the JSON backend re-reads the file when its mtime moved).
   */
  refresh?(): void;
}
