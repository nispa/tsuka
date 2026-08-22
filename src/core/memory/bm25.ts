import { MEMORY_DEFAULTS } from '../constants';
import { MemoryFact } from './types';

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

/** Prefix matching only applies to tokens at least this long (T15.1), avoiding noise on 1-2 char stems. */
const MIN_PREFIX_LEN = MEMORY_DEFAULTS.minPrefixTokenLen;
/** BM25 term-frequency saturation and length-normalization parameters (T17.1). */
const BM25_K1 = MEMORY_DEFAULTS.bm25K1;
const BM25_B = MEMORY_DEFAULTS.bm25B;

/**
 * Frequency map of a fact's normalized tokens (content + tags). Counts — not just presence —
 * feed BM25 term frequencies and document lengths (T17.1).
 */
function tokenFreqs(texts: string): Map<string, number> {
  const freqs = new Map<string, number>();
  for (const t of normalizeText(texts).split(' ').filter((t) => t.length > 0)) {
    freqs.set(t, (freqs.get(t) ?? 0) + 1);
  }
  return freqs;
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

function matchesAny(queryToken: string, hayTokens: Iterable<string>): boolean {
  for (const factToken of hayTokens) {
    if (tokenMatches(queryToken, factToken)) return true;
  }
  return false;
}

/** Auto-tag budget (T15.4) and minimum token length for a tag to carry signal. */
export const AUTO_TAGS_MAX = MEMORY_DEFAULTS.autoTagsMax;
const MIN_TAG_LEN = 3;

/**
 * Derives up to AUTO_TAGS_MAX significant tags from content when the caller passes none
 * (T15.4). Stop words never become tags; the normalized form is used only for dedup, while
 * the stored tag keeps the original word so listings stay readable.
 */
export function deriveTags(content: string): string[] {
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

/** True when a query carries no retrieval signal after stop-word removal. */
export function isMeaninglessQuery(query: string): boolean {
  const rawTokens = query.split(/\s+/).filter((k) => k.length > 0).map(normalizeToken);
  return rawTokens.filter((t) => !STOP_WORDS.has(t)).length === 0 && rawTokens.length === 0;
}

/**
 * Ranks candidates against a keyword query with BM25 (T17.1): a fact scores by the
 * discriminating power (IDF) of the query tokens it contains, with term-frequency
 * saturation and document-length normalization. Hit count and insertion recency stay
 * tertiary tie-breakers. Pure function: no I/O, no state mutation.
 *
 * @param candidates facts eligible for retrieval (already scope/source filtered).
 * @param query raw user/tool query text.
 * @param limit maximum number of facts returned.
 * @param useOrder insertion/use sequence used as the final deterministic tie-breaker.
 */
export function rankByBM25(
  candidates: MemoryFact[],
  query: string,
  limit: number,
  useOrder: Map<string, number>
): MemoryFact[] {
  const rawTokens = query.split(/\s+/).filter((k) => k.length > 0).map(normalizeToken);
  const meaningful = rawTokens.filter((t) => !STOP_WORDS.has(t));
  const queryTokens = meaningful.length > 0 ? meaningful : rawTokens;

  const docs = candidates.map((f) => {
    const freqs = tokenFreqs(`${f.content} ${(f.tags ?? []).join(' ')}`);
    let len = 0;
    for (const c of freqs.values()) len += c;
    return { fact: f, freqs, len };
  });

  const N = docs.length;
  const avgLen = N > 0 ? docs.reduce((s, d) => s + d.len, 0) / N : 0;

  // Document frequency (facts containing each query token) -> inverse document frequency.
  const idfOf = new Map<string, number>();
  for (const qt of queryTokens) {
    let n = 0;
    // .keys(): iterating the Map itself yields [token, count] pairs, and matchesAny would
    // compare a string against an array — always false, so every token would land on n=0 and
    // receive an identical IDF, silently disabling the very weighting BM25 exists for.
    for (const d of docs) if (matchesAny(qt, d.freqs.keys())) n++;
    idfOf.set(qt, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  const scored: Array<{ fact: MemoryFact; score: number; hitsScore: number; useOrder: number }> = [];
  for (const d of docs) {
    let bm25 = 0;
    for (const qt of queryTokens) {
      let tf = 0;
      for (const [factToken, count] of d.freqs) {
        if (tokenMatches(qt, factToken)) tf += count;
      }
      if (tf === 0) continue;
      const idf = idfOf.get(qt) ?? 0;
      const norm = tf + BM25_K1 * (1 - BM25_B + BM25_B * (avgLen > 0 ? d.len / avgLen : 1));
      bm25 += idf * ((tf * (BM25_K1 + 1)) / norm);
    }
    if (bm25 <= 0) continue;
    const hitsScore = Math.min(d.fact.hits ?? 0, 20) / 20;
    scored.push({ fact: d.fact, score: bm25, hitsScore, useOrder: useOrder.get(d.fact.id) ?? -1 });
  }
  scored.sort((a, b) => b.score - a.score || b.hitsScore - a.hitsScore || b.useOrder - a.useOrder);
  return scored.slice(0, limit).map((x) => x.fact);
}
