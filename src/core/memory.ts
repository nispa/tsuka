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

/** Eviction weight per kind: higher = survives longer. */
const KIND_WEIGHT: Record<MemoryKind, number> = { run: 0, fatto: 1, decisione: 2, lezione: 3 };

/**
 * T15.5: transient 'run' notes (condensed turn logs from agent.ts / goal.ts) may fill at most
 * this fraction of capacity during an overflow eviction; any excess is dropped before score
 * competition, so a run-heavy burst cannot evict a single durable fact.
 */
const RUN_QUOTA_RATIO = 0.3;

/** Scope reserved for facts visible across all workspaces. */
export const GLOBAL_SCOPE = 'globale';

/** Inherently shareable kinds (T8.2): visible across agents regardless of source filter. */
const SHAREABLE_KINDS: MemoryKind[] = ['lezione', 'decisione'];

/**
 * T14.20: a memory list showing raw content truncated at ~40 characters made every entry look
 * the same — most facts share a prefix (`[Goal] `, `AGENTE: `, …), so the part that would
 * actually distinguish them is exactly what got cut. `summary` is the short, human-written label
 * (a commit subject, not the diff) shown wherever facts are listed; `content` remains the full
 * detail. Capped at the same width a git subject line conventionally uses.
 */
const SUMMARY_MAX_LEN = 72;

/** Trims and caps an explicitly-given summary; empty/whitespace-only collapses to undefined. */
function normalizeSummary(raw?: string): string | undefined {
  const trimmed = (raw || '').trim();
  if (!trimmed) return undefined;
  return trimmed.length > SUMMARY_MAX_LEN ? trimmed.slice(0, SUMMARY_MAX_LEN - 1).trimEnd() + '…' : trimmed;
}

/**
 * T14.21: a plain first-line-truncated fallback turned out to still be unreadable for most
 * *existing* facts — the system's own call sites (`goal.ts`, `agent.ts`, `spawnAgent.ts`) write
 * one long single-line pointer with the distinguishing part (which goal, which task) buried past
 * character 72, so a generic truncation reproduced the exact "everything looks the same" bug
 * this field exists to fix, just at a slightly wider cutoff. These formats are our own — fixed,
 * deterministic string templates we wrote — so a healed fact from before this field existed can
 * get the *same* summary it would have gotten had `summary` shipped with that call site from the
 * start, instead of a second-rate guess.
 */
const KNOWN_SUMMARY_PATTERNS: Array<{ re: RegExp; summarize: (m: RegExpMatchArray) => string }> = [
  { re: /^\[Goal\] ([^:]+):/, summarize: (m) => `Goal — ${m[1]}'s output condensed` },
  { re: /^\[Compressed history\]/, summarize: () => 'History auto-compressed' },
  { re: /^Reasoning trace (complete|interrupted) \(\d+ chars\) on "([^"]*)"/, summarize: (m) => `Reasoning trace ${m[1]}: "${m[2]}"` },
  { re: /^\[Subagent @([^\]]+)\] Task: "([^"]*)"/, summarize: (m) => `Subagent @${m[1]}: ${m[2]}` },
];

/**
 * Fallback for a fact with no explicit summary — old data predating this field, or a caller that
 * skipped it. Recognizes the system's own known content formats first (see above); anything else
 * (typically an agent's free-form `save_memory` content saved before `summary` was required)
 * falls back to a plain first-line truncation — still just a guess, but it beats showing nothing.
 */
function deriveSummary(content: string): string {
  for (const { re, summarize } of KNOWN_SUMMARY_PATTERNS) {
    const match = content.match(re);
    if (match) return normalizeSummary(summarize(match)) ?? content.slice(0, SUMMARY_MAX_LEN);
  }
  const firstLine = (content.split(/\r?\n/)[0] || '').trim() || content.trim();
  return firstLine.length > SUMMARY_MAX_LEN ? firstLine.slice(0, SUMMARY_MAX_LEN - 1).trimEnd() + '…' : firstLine;
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
 * Functional words that carry no retrieval signal (T15.1). They are ignored on the *query* side
 * of scoring — both in the coverage denominator and the numerator — so `il server usa postgres`
 * and `server postgres` are treated as equally specific queries. Fact-side tokens are never
 * stripped: a fact's own words are its content, not noise.
 */
const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'it', 'its', 'this', 'that', 'these',
  'those', 'not', 'no', 'as', 'if', 'then', 'from', 'so', 'do', 'does', 'did', 'have', 'has',
  'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'my', 'your',
  'our', 'their', 'his', 'her', 'we', 'you', 'they', 'he', 'she', 'i', 'me', 'us', 'them',
  'who', 'whom', 'whose', 'which', 'what', 'when', 'where', 'why', 'how', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'up', 'down',
  'over', 'under', 'again', 'further', 'once', 'here', 'there', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'than', 'too', 'very',
  // Italian
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'un\u2019', 'l\u2019', 'd\u2019',
  'e', 'ed', 'o', 'od', 'ma', 'di', 'del', 'della', 'dei', 'degli', 'delle', 'dello', 'dal',
  'dalla', 'dai', 'dallo', 'agli', 'alle', 'ad', 'da', 'sul', 'sulla', 'sui', 'sugli', 'sulle',
  'nella', 'nel', 'nei', 'negli', 'nello', 'nelle', 'che', 'chi', 'cui', 'con', 'per', 'tra',
  'fra', 'non', 'si', 'ci', 'vi', 'se', 'come', 'dove', 'quando', 'anche', 'più', 'piu', 'piuttosto',
  'molto', 'troppo', 'tanto', 'poco', 'noi', 'voi', 'loro', 'lui', 'lei', 'essa', 'esso', 'essere',
  'stato', 'sono', 'ho', 'hai', 'ha', 'hanno', 'era', 'fu', 'questo', 'questa', 'questi',
  'queste', 'quello', 'quella', 'quelli', 'quelle', 'primo', 'ultimo', 'ogni', 'alcuni', 'alcune',
]);

/** Fact coverage ratio at or above which a fact gets a lexical-signal boost (T15.1). */
/** Kind badge shown in formatted output — a scannable type tag for the model (T15.8). */
const KIND_BADGE: Record<MemoryKind, string> = { fatto: 'FACT', decisione: 'DECISION', lezione: 'LESSON', run: 'RUN' };
const COVERAGE_BOOST_THRESHOLD = 0.75;
/** Boost added to the score when coverage passes the threshold (secondary after match count). */
const COVERAGE_BOOST = 500;
/** Prefix matching only applies to tokens at least this long (T15.1), avoiding noise on 1-2 char stems. */
const MIN_PREFIX_LEN = 3;

/** Symbol set of a fact's normalized tokens, reused across search calls. */
function tokensOf(texts: string): Set<string> {
  return new Set(normalizeText(texts).split(' ').filter((t) => t.length > 0));
}

/**
 * T15.1 token match: exact normalized equality, or the query token being a prefix of a fact
 * token for tokens of sufficient length (`mem` -> `memoria`). Only this forward direction is
 * safe: the reverse (`TypeScript` matching a fact token `type`) is exactly the spurious OR
 * match that `test_memory_scope.ts` T6.1a-1 documents as noise, not recall. Short tokens that
 * did not survive `normalizeToken`'s vowel strip fall back to exact matches to limit noise.
 */
function tokenMatches(queryToken: string, factToken: string): boolean {
  if (queryToken === factToken) return true;
  if (queryToken.length < MIN_PREFIX_LEN || factToken.length < MIN_PREFIX_LEN) return false;
  return factToken.startsWith(queryToken);
}

function matchesAny(queryToken: string, hayTokens: Set<string>): boolean {
  for (const factToken of hayTokens) {
    if (tokenMatches(queryToken, factToken)) return true;
  }
  return false;
}

/** Auto-tag budget (T15.4) and minimum token length for a tag to carry signal. */
export const AUTO_TAGS_MAX = 5;
const MIN_TAG_LEN = 3;

/**
 * Derives up to AUTO_TAGS_MAX significant tags from content when the caller passes none
 * (T15.4). Stop words never become tags; the normalized form is used only for dedup, while
 * the stored tag keeps the original word so listings stay readable.
 */
function deriveTags(content: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const word of content.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length === 0) continue;
    const norm = normalizeToken(word);
    if (norm.length < MIN_TAG_LEN || STOP_WORDS.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    tags.push(word);
    if (tags.length >= AUTO_TAGS_MAX) break;
  }
  return tags;
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
      summary: typeof raw.summary === 'string' && raw.summary.trim().length > 0 ? raw.summary.trim() : deriveSummary(raw.content),
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

  /**
   * Dedup key for a fact (T14.15): same wording in the same scope is the same fact,
   * whichever agent wrote it and however it was spaced or capitalized.
   */
  private static factKey(content: string, scope: string): string {
    return `${scope} ${content.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  }

  /**
   * Folds a duplicate into the fact already stored, keeping the strongest version of
   * every field: the most durable kind, the freshest timestamps, the summed hits.
   * A fact repeated ten times is one fact that mattered ten times, not ten facts.
   */
  private static mergeDuplicate(existing: MemoryFact, incoming: MemoryFact): void {
    if (KIND_WEIGHT[incoming.kind] > KIND_WEIGHT[existing.kind]) {
      existing.kind = incoming.kind;
    }
    if (incoming.timestamp > existing.timestamp) existing.timestamp = incoming.timestamp;
    if (incoming.lastUsed > existing.lastUsed) existing.lastUsed = incoming.lastUsed;
    if (incoming.summary) existing.summary = incoming.summary; // same as timestamp/lastUsed: freshest wins
    existing.hits = (existing.hits ?? 0) + (incoming.hits ?? 0);
    if (incoming.pinned) existing.pinned = true;
    if (incoming.tags && incoming.tags.length > 0) {
      existing.tags = Array.from(new Set([...(existing.tags ?? []), ...incoming.tags]));
    }
  }

  /**
   * Collapses duplicates already sitting in the store. Existing memory files predate
   * write-time dedup, so they are healed on load instead of requiring a manual cleanup.
   * Returns the number of entries removed.
   */
  private static dedupe(facts: MemoryFact[]): { facts: MemoryFact[]; removed: number } {
    const byKey = new Map<string, MemoryFact>();
    for (const fact of facts) {
      const key = MemoryStore.factKey(fact.content, fact.scope);
      const existing = byKey.get(key);
      if (existing) {
        MemoryStore.mergeDuplicate(existing, fact);
      } else {
        byKey.set(key, fact);
      }
    }
    return { facts: Array.from(byKey.values()), removed: facts.length - byKey.size };
  }

  private load(): void {
    try {
      // T15.6: an orphan tmp file means a previous save crashed between write and rename;
      // it is never a valid source, discard it before looking at the real file.
      const tmpPath = `${this.filePath}.tmp`;
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
      if (fs.existsSync(this.filePath)) {
        this.loadedMtime = fs.statSync(this.filePath).mtimeMs;
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as MemoryFile;
        const rawFacts = Array.isArray(data.facts) ? data.facts : [];
        this.facts = MemoryStore.dedupe(rawFacts.map((f) => this.normalizeFact(f))).facts;
      } else {
        this.facts = [];
        this.loadedMtime = -1;
      }
    } catch (error: any) {
      // T15.6: a corrupt file is never reset silently. Preserve the bytes under a recoverable
      // backup name and tell the user — only then start from an empty store.
      if (fs.existsSync(this.filePath)) {
        const backup = `${this.filePath}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(this.filePath, backup);
          logSink.warn(
            `Shared memory file was corrupt (${this.filePath}); backed up to ${backup}. No memory lost silently — inspect the backup.`
          );
        } catch (renameError: any) {
          logSink.error(`Could not back up corrupt shared memory (${this.filePath}): ${renameError.message}`);
        }
      }
      logSink.error(`Error reading shared memory (${this.filePath}): ${error.message}. Starting with empty memory.`);
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
      // T15.6: write to a sibling tmp file then rename onto the real path — the rename is
      // atomic on the same filesystem, so an interruption mid-write can never leave a
      // half-written memory.json behind (the worst case is an orphaned .tmp, cleaned on load).
      const data: MemoryFile = { facts: this.facts };
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
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

  /**
   * Half-life in hours per kind (T15.2): how long a fact of that kind stays "fresh" before
   * its retention value halves. run notes are turn-scoped, lessons are meant to last.
   */
  private static kindHalfLifeHours(kind: MemoryKind): number {
    switch (kind) {
      case 'run': return 2;
      case 'fatto': return 48;
      case 'decisione': return 168; // 7 days
      case 'lezione': return 720;   // 30 days
    }
  }

  /**
   * Exponential time-decay factor in (0, 1] for a fact (T15.2). A fact re-read by search()
   * gets its `lastUsed` refreshed and is therefore young again; an untouched old note erodes
   * toward zero. Pinned facts are exempt at the call sites, not here.
   */
  private retentionDecay(fact: MemoryFact): number {
    if (fact.pinned) return 1;
    const raw = fact.lastUsed || fact.timestamp || '';
    const ts = raw ? Date.parse(raw) : NaN;
    const base = Number.isFinite(ts) ? ts : Date.now();
    const hours = Math.max(0, (Date.now() - base) / 3600000);
    return Math.pow(0.5, hours / MemoryStore.kindHalfLifeHours(fact.kind));
  }

  private evictionScore(fact: MemoryFact, recencyRank: number, totalCandidates: number): number {
    const hitsScore = Math.min(fact.hits ?? 0, 20) / 20;
    const kindScore = (KIND_WEIGHT[fact.kind] ?? KIND_WEIGHT.fatto) / KIND_WEIGHT.lezione;
    const timeScore = this.retentionDecay(fact) * 10;
    const recencyScore = totalCandidates > 1 ? (recencyRank / (totalCandidates - 1)) * 2 : 1;
    return kindScore * 100 + timeScore + recencyScore + hitsScore;
  }

  /**
   * Orders facts by the very value the store uses to decide what to keep (kind weight,
   * then recency, then hits). One rule, two views: what memory protects longest from
   * eviction is what it shows first in a prompt — otherwise the prompt fills up with the
   * transient 'run' notes that memory itself considers the first thing to throw away.
   */
  private rankByRetentionValue(candidates: MemoryFact[]): MemoryFact[] {
    if (candidates.length === 0) return [];
    const byUseOrder = [...candidates].sort(
      (a, b) => (this.useOrder.get(a.id) ?? -1) - (this.useOrder.get(b.id) ?? -1)
    );
    const rankOf = new Map<MemoryFact, number>();
    byUseOrder.forEach((f, i) => rankOf.set(f, i));
    const total = byUseOrder.length;
    return [...candidates].sort(
      (a, b) =>
        this.evictionScore(b, rankOf.get(b)!, total) - this.evictionScore(a, rankOf.get(a)!, total) ||
        Date.parse(b.lastUsed || b.timestamp) - Date.parse(a.lastUsed || a.timestamp)
    );
  }

  private evictIfNeeded(): void {
    // T15.5: while the store is genuinely overflowing, transient 'run' notes are held to a
    // fraction of capacity and their excess is dropped first — a burst of condensed turn logs
    // can no longer starve the durable kinds. The quota only applies during overflow: a store
    // below its cap never sacrifices a thing, and pinned facts are never candidates.
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

    // Re-saying something already known refreshes it instead of adding a copy (T14.15):
    // duplicates crowd out real facts both in the eviction budget and in the prompt.
    const key = MemoryStore.factKey(fact.content, fact.scope);
    const existing = this.facts.find((f) => MemoryStore.factKey(f.content, f.scope) === key);
    if (existing) {
      MemoryStore.mergeDuplicate(existing, fact);
      // The repeat itself is the signal: stating something again means it mattered again,
      // which is exactly what `hits` weighs in the retention score.
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
    const rawTokens = query.split(/\s+/).filter((k) => k.length > 0).map(normalizeToken);
    const meaningful = rawTokens.filter((t) => !STOP_WORDS.has(t));
    const queryTokens = meaningful.length > 0 ? meaningful : rawTokens;
    const touch = opts?.touch !== false;
    let results: MemoryFact[];

    if (queryTokens.length === 0) {
      results = this.getRecent(limit, opts?.sources);
    } else {
      const candidates = this.filterBySource(this.visibleFacts(), opts?.sources);
      const scored: Array<{ fact: MemoryFact; score: number; useOrder: number }> = [];
      for (const f of candidates) {
        const hayTokens = tokensOf(`${f.content} ${(f.tags ?? []).join(' ')}`);
        let matches = 0;
        for (const qt of queryTokens) {
          if (matchesAny(qt, hayTokens)) matches++;
        }
        if (matches === 0) continue;
        const coverage = matches / queryTokens.length;
        const hitsScore = Math.min(f.hits ?? 0, 20) / 20;
        const score =
          matches * 1000 +
          (coverage >= COVERAGE_BOOST_THRESHOLD ? COVERAGE_BOOST : 0) +
          hitsScore;
        scored.push({ fact: f, score, useOrder: this.useOrder.get(f.id) ?? -1 });
      }
      scored.sort((a, b) => b.score - a.score || b.useOrder - a.useOrder);
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

  /**
   * T15.7 — Updates a single fact in place: new content, summary, kind and/or extra tags.
   * Timestamps refresh on the updated fact. If the edit makes its content duplicate another
   * fact, the duplicate collapses via the same dedup rule as addFact (T14.15) instead of
   * piling up. Returns the surviving fact (which may be the merged duplicate target), or null
   * when no fact with that id exists.
   */
  updateFact(id: string, patch: { content?: string; summary?: string; kind?: MemoryKind; tags?: string[] }): MemoryFact | null {
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

    const deduped = MemoryStore.dedupe(this.facts);
    if (deduped.removed > 0) {
      this.facts = deduped.facts;
    }
    this.evictIfNeeded();
    this.save();
    const key = MemoryStore.factKey(target.content, target.scope);
    return this.facts.find((f) => MemoryStore.factKey(f.content, f.scope) === key) ?? target;
  }

  /**
   * T15.7 — Removes a single fact by id (boolean success), same semantics as remove().
   * Naming mirror of updateFact so the memory tools read symmetrically.
   */
  forgetFact(id: string): boolean {
    return this.remove(id);
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
   * One line of the prompt section (T15.8): a freshness slot (`PINNED` or YYYY-MM-DD), the
   * kind badge, the author, and the content. The badge tells small models, which are bad at
   * inferring the date or the exposition from a bare sentence, whether a memory is a lasting
   * lesson or a transient run note at a glance.
   */
  private static formatFactLine(f: MemoryFact): string {
    const when = f.pinned ? 'PINNED' : (f.timestamp || '').slice(0, 10) || '????-??-??';
    const badge = KIND_BADGE[f.kind] ?? 'FACT';
    return `- [${when}][${badge}] (${f.source}) ${f.content}`;
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
    const selected = this.rankByRetentionValue(visible).slice(0, limit);
    const lines: string[] = [];
    let total = 0;
    for (const f of selected) {
      const line = MemoryStore.formatFactLine(f);
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
      const line = MemoryStore.formatFactLine(f);
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
