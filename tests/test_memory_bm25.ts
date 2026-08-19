/**
 * Tests for T17.1 — BM25 retrieval.
 *
 * `search()` moved from prefix + coverage matching to BM25 (TF saturation, document-length
 * normalization, and inverse document frequency). The whole reason for the move is IDF: a token
 * is weighted by how *discriminating* it is across the store, so a word every fact shares
 * carries almost no signal while a rare one dominates.
 *
 * That property is exactly what nothing covered. BM25 shipped with a Map-iteration bug in the
 * document-frequency loop (`matchesAny(qt, d.freqs)` instead of `d.freqs.keys()`): iterating a
 * Map yields `[token, count]` pairs, so the comparison was string-vs-array — always false. Every
 * token landed on n=0 and received an identical IDF, silently disabling the weighting, while the
 * *scoring* loop destructured correctly and kept term frequencies working. All seven memory
 * suites stayed green because each one asserts recall ("is the right fact returned?"), never
 * discrimination ("is the rare token worth more than the common one?").
 *
 * R1 is the regression guard for that bug: it fails on the broken version and passes on the fix.
 *
 * Isolated run: npx tsx tests/test_memory_bm25.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore } from '../src/core/memory';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-memretrieval-'));
let fileSeq = 0;
function tmpStore(maxFacts = 200, scope = 'testscope'): MemoryStore {
  fileSeq++;
  return new MemoryStore(path.join(tmpDir, `memory-${fileSeq}.json`), maxFacts, scope);
}

function main() {
  console.log('=== Test BM25 retrieval (T17.1) ===\n');

  // ── R1: IDF is the only differentiator (the regression guard) ──
  // Both candidates match exactly ONE query token, with the same term frequency and the same
  // document length, so term frequency and length normalization cancel out entirely: the only
  // thing that can separate them is how discriminating their token is across the corpus.
  // "deployment" appears in 9 facts, "kubernetes" in 1, so the kubernetes fact must win.
  //
  // The candidates are inserted rare-first on purpose. With the IDF bug every token shares one
  // constant weight, the two scores tie exactly, and the tie-break falls through to insertion
  // recency — handing first place to whichever was added last. Inserting the common one last
  // means the broken build ranks it first and this check fails, which is the point of a guard.
  {
    const store = tmpStore();
    for (let i = 0; i < 8; i++) {
      store.addFact(`deployment filler note ${i}`, 'agent');
    }
    store.addFact('kubernetes status board', 'agent');   // rare token, inserted first
    store.addFact('deployment status board', 'agent');   // common token, inserted last

    const results = store.search('deployment kubernetes', 5, { touch: false });
    check(
      'R1',
      results.length > 0 && /kubernetes/i.test(results[0].content),
      `the rare token outweighs the one 9 facts share: ${JSON.stringify(results[0]?.summary)}`
    );
  }

  // ── R2: the same two facts flip rank when the corpus flips ──
  // Nothing about the two candidates changes between the stores — only how common each of their
  // tokens is elsewhere. A ranking that reacts to that is a ranking with a live IDF; a constant
  // IDF returns the same order both times, so one of the two checks below must fail on it.
  {
    const alphaCommon = tmpStore();
    for (let i = 0; i < 8; i++) alphaCommon.addFact(`alpha filler note ${i}`, 'agent');
    alphaCommon.addFact('beta status board', 'agent');
    alphaCommon.addFact('alpha status board', 'agent');
    const r1 = alphaCommon.search('alpha beta', 5, { touch: false });

    const betaCommon = tmpStore();
    for (let i = 0; i < 8; i++) betaCommon.addFact(`beta filler note ${i}`, 'agent');
    betaCommon.addFact('alpha status board', 'agent');
    betaCommon.addFact('beta status board', 'agent');
    const r2 = betaCommon.search('alpha beta', 5, { touch: false });

    check(
      'R2a',
      r1.length > 0 && /beta/i.test(r1[0].content),
      `when alpha is the common token, beta ranks first: ${JSON.stringify(r1[0]?.summary)}`
    );
    check(
      'R2b',
      r2.length > 0 && /alpha/i.test(r2[0].content),
      `same two facts, mirrored corpus, mirrored ranking: ${JSON.stringify(r2[0]?.summary)}`
    );
  }

  // ── R3: term-frequency saturation — more repeats help, but with diminishing returns ──
  // A fact repeating the query token must not beat a shorter, denser match purely on raw count.
  {
    const store = tmpStore();
    store.addFact('redis', 'agent');
    store.addFact(`redis ${'filler '.repeat(60)}`.trim(), 'agent');

    const results = store.search('redis', 5, { touch: false });
    check(
      'R3',
      results.length === 2 && results[0].content === 'redis',
      `length normalization favours the concise fact over the padded one: ${JSON.stringify(results[0]?.summary)}`
    );
  }

  // ── R4: stop words on the query side do not drive ranking (T15.1, preserved under BM25) ──
  {
    const store = tmpStore();
    store.addFact('The pipeline uses nomad for scheduling', 'agent');
    store.addFact('An unrelated note about the weather and the sea', 'agent');

    const withStops = store.search('the pipeline uses nomad', 5, { touch: false });
    const withoutStops = store.search('pipeline nomad', 5, { touch: false });
    check(
      'R4',
      withStops.length > 0 && withoutStops.length > 0 && withStops[0].id === withoutStops[0].id,
      'adding functional words to a query does not change which fact wins'
    );
  }

  // ── R5: prefix matching still works (T15.1 behaviour kept under BM25) ──
  {
    const store = tmpStore();
    store.addFact('The memoria module stores project knowledge', 'agent');
    const results = store.search('memo', 5, { touch: false });
    check('R5', results.length === 1, `a query token prefixes a longer fact token: ${results.length} result(s)`);
  }

  // ── R6: a query matching nothing returns nothing (no OR-scoring noise floor) ──
  {
    const store = tmpStore();
    store.addFact('Postgres runs on port 5432', 'agent');
    const results = store.search('kubernetes helm istio', 5, { touch: false });
    check('R6', results.length === 0, `no spurious matches for an unrelated query: ${results.length} result(s)`);
  }

  // ── R7: determinism — the same query over an unchanged store ranks identically ──
  // BM25 recomputes IDF per query over the visible facts; with `touch: false` nothing about the
  // store changes between runs, so two consecutive searches must agree exactly. A drift here
  // would mean ranking depends on iteration or timing rather than on the corpus.
  {
    const store = tmpStore();
    store.addFact('postgres runs the primary database', 'agent');
    store.addFact('redis backs the session cache', 'agent');
    store.addFact('postgres replication lags on the standby', 'agent');

    const first = store.search('postgres database', 5, { touch: false }).map((f) => f.id);
    const second = store.search('postgres database', 5, { touch: false }).map((f) => f.id);
    check(
      'R7',
      first.length > 0 && JSON.stringify(first) === JSON.stringify(second),
      `two identical queries return the same ranking (${first.length} result(s))`
    );
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
