import { MEMORY_DEFAULTS } from '../constants';
import { MemoryFact, MemoryKind } from './types';

/** Eviction weight per kind: higher = survives longer. */
export const KIND_WEIGHT: Record<MemoryKind, number> = { run: 0, fatto: 1, decisione: 2, lezione: 3 };

/**
 * T15.5: transient 'run' notes (condensed turn logs from agent.ts / goal.ts) may fill at most
 * this fraction of capacity during an overflow eviction; any excess is dropped before score
 * competition, so a run-heavy burst cannot evict a single durable fact.
 */
export const RUN_QUOTA_RATIO = MEMORY_DEFAULTS.runQuotaRatio;

/** Inherently shareable kinds (T8.2): visible across agents regardless of source filter. */
export const SHAREABLE_KINDS: MemoryKind[] = ['lezione', 'decisione'];

/**
 * Half-life in hours per kind (T15.2): how long a fact of that kind stays "fresh" before
 * its retention value halves. run notes are turn-scoped, lessons are meant to last.
 */
export function kindHalfLifeHours(kind: MemoryKind): number {
  switch (kind) {
    case 'run': return MEMORY_DEFAULTS.halfLifeHours.run;
    case 'fatto': return MEMORY_DEFAULTS.halfLifeHours.fatto;
    case 'decisione': return MEMORY_DEFAULTS.halfLifeHours.decisione; // 7 days
    case 'lezione': return MEMORY_DEFAULTS.halfLifeHours.lezione;     // 30 days
  }
}

/**
 * Exponential time-decay factor in (0, 1] for a fact (T15.2). A fact re-read by search()
 * gets its `lastUsed` refreshed and is therefore young again; an untouched old note erodes
 * toward zero. Pinned facts are exempt at the call sites, not here.
 */
export function retentionDecay(fact: MemoryFact): number {
  if (fact.pinned) return 1;
  const raw = fact.lastUsed || fact.timestamp || '';
  const ts = raw ? Date.parse(raw) : NaN;
  const base = Number.isFinite(ts) ? ts : Date.now();
  const hours = Math.max(0, (Date.now() - base) / 3600000);
  return Math.pow(0.5, hours / kindHalfLifeHours(fact.kind));
}

export function evictionScore(fact: MemoryFact, recencyRank: number, totalCandidates: number): number {
  const hitsScore = Math.min(fact.hits ?? 0, 20) / 20;
  const kindScore = (KIND_WEIGHT[fact.kind] ?? KIND_WEIGHT.fatto) / KIND_WEIGHT.lezione;
  const timeScore = retentionDecay(fact) * 10;
  const recencyScore = totalCandidates > 1 ? (recencyRank / (totalCandidates - 1)) * 2 : 1;
  return kindScore * 100 + timeScore + recencyScore + hitsScore;
}

/**
 * Orders facts by the very value the store uses to decide what to keep (kind weight,
 * then recency, then hits). One rule, two views: what memory protects longest from
 * eviction is what it shows first in a prompt — otherwise the prompt fills up with the
 * transient 'run' notes that memory itself considers the first thing to throw away.
 */
export function rankByRetentionValue(candidates: MemoryFact[], useOrder: Map<string, number>): MemoryFact[] {
  if (candidates.length === 0) return [];
  const byUseOrder = [...candidates].sort(
    (a, b) => (useOrder.get(a.id) ?? -1) - (useOrder.get(b.id) ?? -1)
  );
  const rankOf = new Map<MemoryFact, number>();
  byUseOrder.forEach((f, i) => rankOf.set(f, i));
  const total = byUseOrder.length;
  return [...candidates].sort(
    (a, b) =>
      evictionScore(b, rankOf.get(b)!, total) - evictionScore(a, rankOf.get(a)!, total) ||
      Date.parse(b.lastUsed || b.timestamp) - Date.parse(a.lastUsed || a.timestamp)
  );
}

/**
 * Picks the least-retention-valued non-pinned fact to evict, following the same score
 * used by rankByRetentionValue. Returns null when there is nothing evictable.
 */
export function pickEvictionVictim(facts: MemoryFact[], useOrder: Map<string, number>): MemoryFact | null {
  const candidates = facts.filter((f) => !f.pinned);
  if (candidates.length === 0) return null;

  const byUseOrder = [...candidates].sort(
    (a, b) => (useOrder.get(a.id) ?? -1) - (useOrder.get(b.id) ?? -1)
  );
  const rankOf = new Map<MemoryFact, number>();
  byUseOrder.forEach((f, i) => rankOf.set(f, i));
  const total = byUseOrder.length;

  let worst = candidates[0];
  let worstScore = evictionScore(worst, rankOf.get(worst)!, total);
  for (let i = 1; i < candidates.length; i++) {
    const f = candidates[i];
    const score = evictionScore(f, rankOf.get(f)!, total);
    if (score < worstScore) {
      worst = f;
      worstScore = score;
    }
  }
  return worst;
}
