import { MEMORY_DEFAULTS } from '../constants';
import { KIND_WEIGHT } from './retention';
import { GLOBAL_SCOPE, isValidKind, MemoryFact, MemoryKind } from './types';

const SUMMARY_MAX_LEN = MEMORY_DEFAULTS.summaryMaxLen;

/** Trims and caps an explicitly-given summary; empty/whitespace-only collapses to undefined. */
export function normalizeSummary(raw?: string): string | undefined {
  const trimmed = (raw || '').trim();
  if (!trimmed) return undefined;
  return trimmed.length > SUMMARY_MAX_LEN ? trimmed.slice(0, SUMMARY_MAX_LEN - 1).trimEnd() + '…' : trimmed;
}

const KNOWN_SUMMARY_PATTERNS: Array<{ re: RegExp; summarize: (m: RegExpMatchArray) => string }> = [
  { re: /^\[Goal\] ([^:]+):/, summarize: (m) => `Goal — ${m[1]}'s output condensed` },
  { re: /^\[Compressed history\]/, summarize: () => 'History auto-compressed' },
  { re: /^Reasoning trace (complete|interrupted) \(\d+ chars\) on "([^"]*)"/, summarize: (m) => `Reasoning trace ${m[1]}: "${m[2]}"` },
  { re: /^\[Subagent @([^\]]+)\] Task: "([^"]*)"/, summarize: (m) => `Subagent @${m[1]}: ${m[2]}` },
];

/**
 * Fallback for a fact with no explicit summary — old data predating this field, or a caller that
 * skipped it. Recognizes the system's own known content formats first; anything else
 * falls back to a plain first-line truncation.
 */
export function deriveSummary(content: string): string {
  for (const { re, summarize } of KNOWN_SUMMARY_PATTERNS) {
    const match = content.match(re);
    if (match) return normalizeSummary(summarize(match)) ?? content.slice(0, SUMMARY_MAX_LEN);
  }
  const firstLine = (content.split(/\r?\n/)[0] || '').trim() || content.trim();
  return firstLine.length > SUMMARY_MAX_LEN ? firstLine.slice(0, SUMMARY_MAX_LEN - 1).trimEnd() + '…' : firstLine;
}

/**
 * Normalizes a raw object loaded from JSON into a typed MemoryFact.
 */
export function normalizeFact(raw: any): MemoryFact {
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
 * Dedup key for a fact: same wording in the same scope is the same fact,
 * whichever agent wrote it and however it was spaced or capitalized.
 */
export function factKey(content: string, scope: string): string {
  return `${scope} ${content.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/**
 * Folds a duplicate into the fact already stored, keeping the strongest version of
 * every field: the most durable kind, the freshest timestamps, the summed hits.
 */
export function mergeDuplicate(existing: MemoryFact, incoming: MemoryFact): void {
  if (KIND_WEIGHT[incoming.kind] > KIND_WEIGHT[existing.kind]) {
    existing.kind = incoming.kind;
  }
  if (incoming.timestamp > existing.timestamp) existing.timestamp = incoming.timestamp;
  if (incoming.lastUsed > existing.lastUsed) existing.lastUsed = incoming.lastUsed;
  if (incoming.summary) existing.summary = incoming.summary;
  existing.hits = (existing.hits ?? 0) + (incoming.hits ?? 0);
  if (incoming.pinned) existing.pinned = true;
  if (incoming.tags && incoming.tags.length > 0) {
    existing.tags = Array.from(new Set([...(existing.tags ?? []), ...incoming.tags]));
  }
}

/**
 * Collapses duplicates within an array of MemoryFacts.
 */
export function dedupeFacts(facts: MemoryFact[]): { facts: MemoryFact[]; removed: number } {
  const byKey = new Map<string, MemoryFact>();
  for (const fact of facts) {
    const key = factKey(fact.content, fact.scope);
    const existing = byKey.get(key);
    if (existing) {
      mergeDuplicate(existing, fact);
    } else {
      byKey.set(key, fact);
    }
  }
  return { facts: Array.from(byKey.values()), removed: facts.length - byKey.size };
}

/** Kind badge shown in formatted output — a scannable type tag for the model (T15.8). */
export const KIND_BADGE: Record<MemoryKind, string> = {
  fatto: 'FACT',
  decisione: 'DECISION',
  lezione: 'LESSON',
  run: 'RUN',
};

/**
 * Formats a single memory line for system prompt injection.
 */
export function formatFactLine(f: MemoryFact): string {
  const when = f.pinned ? 'PINNED' : (f.timestamp || '').slice(0, 10) || '????-??-??';
  const badge = KIND_BADGE[f.kind] ?? 'FACT';
  return `- [${when}][${badge}] (${f.source}) ${f.content}`;
}

/**
 * Fits formatted memory lines into character budget and appends recall guidance.
 */
export function renderMemorySection(
  selected: MemoryFact[],
  totalAvailable: number,
  cap: number,
  noun: string,
  relevant = false
): string {
  const lines: string[] = [];
  let total = 0;
  for (const f of selected) {
    const line = formatFactLine(f);
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
