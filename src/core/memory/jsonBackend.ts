import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../apphome';
import { ConfigManager } from '../config';
import { logSink } from '../logSink';
import { MEMORY_DEFAULTS } from '../constants';
import { deriveTags, isMeaninglessQuery, rankByBM25 } from './bm25';
import {
  KIND_WEIGHT,
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
  MemoryKind,
  SearchOptions,
  scopeFromWorkspaceRoot,
  UpdateFactPatch,
} from './types';

/**
 * T14.20: a memory list showing raw content truncated at ~40 characters made every entry look
 * the same — most facts share a prefix (`[Goal] `, `AGENTE: `, …), so the part that would
 * actually distinguish them is exactly what got cut. `summary` is the short, human-written label
 * (a commit subject, not the diff) shown wherever facts are listed; `content` remains the full
 * detail. Capped at the same width a git subject line conventionally uses.
 */
const SUMMARY_MAX_LEN = MEMORY_DEFAULTS.summaryMaxLen;

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

interface MemoryFile {
  facts: MemoryFact[];
}

/** Kind badge shown in formatted output — a scannable type tag for the model (T15.8). */
const KIND_BADGE: Record<MemoryKind, string> = {
  fatto: 'FACT',
  decisione: 'DECISION',
  lezione: 'LESSON',
  run: 'RUN',
};

/**
 * JsonMemoryBackend: the default MemoryBackend implementation.
 *
 * - Facts are persisted in `memory/memory.json`.
 * - Workspace scoped with global fallthrough (`GLOBAL_SCOPE`).
 * - Retrieval scoring lives in `bm25.ts`, retention/eviction policy in `retention.ts`.
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
    return `${scope} ${content.trim().replace(/\s+/g, ' ').toLowerCase()}`;
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
      const key = JsonMemoryBackend.factKey(fact.content, fact.scope);
      const existing = byKey.get(key);
      if (existing) {
        JsonMemoryBackend.mergeDuplicate(existing, fact);
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
        this.facts = JsonMemoryBackend.dedupe(rawFacts.map((f) => this.normalizeFact(f))).facts;
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

  /** MemoryBackend.refresh: reloads from disk when another process changed the file. */
  refresh(): void {
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

    // Re-saying something already known refreshes it instead of adding a copy (T14.15):
    // duplicates crowd out real facts both in the eviction budget and in the prompt.
    const key = JsonMemoryBackend.factKey(fact.content, fact.scope);
    const existing = this.facts.find((f) => JsonMemoryBackend.factKey(f.content, f.scope) === key);
    if (existing) {
      JsonMemoryBackend.mergeDuplicate(existing, fact);
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

    const deduped = JsonMemoryBackend.dedupe(this.facts);
    if (deduped.removed > 0) {
      this.facts = deduped.facts;
    }
    this.evictIfNeeded();
    this.save();
    const key = JsonMemoryBackend.factKey(target.content, target.scope);
    return this.facts.find((f) => JsonMemoryBackend.factKey(f.content, f.scope) === key) ?? target;
  }

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

  formatForPrompt(limit: number = 10, maxChars?: number, sources?: string[]): string {
    const cap = typeof maxChars === 'number' ? maxChars : new ConfigManager().getMemoryMaxChars();
    const visible = this.filterBySource(this.visibleFacts(), sources);
    if (visible.length === 0) {
      return '';
    }
    const selected = rankByRetentionValue(visible, this.useOrder).slice(0, limit);
    return this.renderSection(selected, visible.length, cap, 'memories');
  }

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
    return this.renderSection(relevant, relevant.length, cap, 'relevant memories', true);
  }

  /**
   * Shared renderer for the prompt sections: fits formatted lines into the character
   * budget and appends the recall hint when facts were left out.
   */
  private renderSection(
    selected: MemoryFact[],
    totalAvailable: number,
    cap: number,
    noun: string,
    relevant = false
  ): string {
    const lines: string[] = [];
    let total = 0;
    for (const f of selected) {
      const line = JsonMemoryBackend.formatFactLine(f);
      if (total + line.length > cap) {
        break;
      }
      lines.push(line);
      total += line.length;
    }
    const omitted = Math.max(0, totalAvailable - lines.length);
    let section = lines.join('\n');
    if (omitted > 0) {
      section += relevant
        ? `\n… (${omitted} more relevant memories available: use recall_memory to search)`
        : `\n… (${omitted} more memories available: use recall_memory to search)`;
    }
    return section;
  }
}
