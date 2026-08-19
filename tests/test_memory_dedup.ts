/**
 * Tests for T14.15 — Memory noise in the system prompt.
 *
 * The prompt reserves `memoryMaxChars` (600 by default) for persistent memory, and on a
 * real store that budget was being spent on repeated, low-value entries: the same fact
 * stored ten times, and transient '[Goal] …' turn notes crowding out actual project
 * knowledge. Two causes, verified separately here:
 *
 *  1. No dedup on write. `addFact` appended a new entry every time, so the same wording
 *     occupied ten slots of the eviction budget and up to ten lines of the prompt.
 *     Now a repeat folds into the existing fact, keeping the most durable kind, the
 *     freshest timestamps and the summed hits. Stores written before this fix are healed
 *     on load, since a manual cleanup nobody runs is not a fix.
 *  2. Selection by recency alone. `formatForPrompt` took the newest facts via
 *     `getRecent`, while `evictionScore` already ranked 'run' notes as the first thing to
 *     throw away. The prompt therefore showed exactly what memory considered worthless.
 *     Selection now reuses the retention score: one rule, two views.
 *
 * `getRecent` itself stays chronological — it backs the `/memory` listing, where "newest
 * first" is the right answer.
 *
 * Isolated run: npx tsx tests/test_memory_dedup.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore, GLOBAL_SCOPE } from '../src/core/memory';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-memdedup-'));
let fileSeq = 0;
function tmpStore(maxFacts = 200, scope = 'testscope'): MemoryStore {
  fileSeq++;
  return new MemoryStore(path.join(tmpDir, `memory-${fileSeq}.json`), maxFacts, scope);
}

function main() {
  console.log('=== Test memory noise in the prompt (T14.15) ===\n');

  // ════════════════════════════════════════════════════════════════
  // Group A — dedup on write
  // ════════════════════════════════════════════════════════════════
  {
    const store = tmpStore();
    for (let i = 0; i < 10; i++) {
      store.addFact('Project fact: port is 8080.', 'agent');
    }
    check('A1', store.count() === 1,
      `the same fact stated ten times is stored once (count=${store.count()}) — before the fix it took ten slots`);

    const stored = store.getRecent(10)[0];
    check('A2', (stored.hits ?? 0) >= 9,
      `the repeats are not lost, they become weight: hits=${stored.hits} (a fact repeated ten times mattered ten times)`);

    store.addFact('project FACT:   port is 8080.', 'other_agent');
    check('A3', store.count() === 1,
      'dedup normalizes case and whitespace: the same sentence typed differently is still the same fact');

    store.addFact('Project fact: port is 8080.', 'agent', { scope: GLOBAL_SCOPE });
    check('A4', store.count() === 2,
      'but the same wording in a different scope stays a distinct fact: scoping is not accidental duplication');
  }

  // ════════════════════════════════════════════════════════════════
  // Group B — merging keeps the strongest version of the fact
  // ════════════════════════════════════════════════════════════════
  {
    const store = tmpStore();
    store.addFact('Always run the tests before committing.', 'agent', { kind: 'run' });
    store.addFact('Always run the tests before committing.', 'agent', { kind: 'lezione', tags: ['ci'] });

    const fact = store.getRecent(10)[0];
    check('B1', fact.kind === 'lezione',
      `a repeat with a more durable kind upgrades the stored one (kind=${fact.kind}): the fact survives eviction as long as its best statement deserves`);
    check('B2', (fact.tags || []).includes('ci'),
      'tags from the repeat are merged in, not dropped');

    store.addFact('Always run the tests before committing.', 'agent', { kind: 'run' });
    check('B3', store.getRecent(10)[0].kind === 'lezione',
      'and a later, weaker repeat does not downgrade it');

    const pinnedStore = tmpStore();
    pinnedStore.addFact('Never touch production directly.', 'agent');
    pinnedStore.addFact('Never touch production directly.', 'agent', { pinned: true });
    check('B4', pinnedStore.getRecent(10)[0].pinned === true,
      'pinning through a repeat sticks: the merge takes the strongest value of every field');
  }

  // ════════════════════════════════════════════════════════════════
  // Group C — existing polluted stores are healed on load
  // ════════════════════════════════════════════════════════════════
  {
    // Same shape as the real store that prompted this task: 'run' notes repeated ten
    // times each, written before write-time dedup existed.
    const pollutedPath = path.join(tmpDir, 'polluted.json');
    const facts: any[] = [];
    let seq = 0;
    for (let copy = 0; copy < 10; copy++) {
      for (const content of [
        '[Goal] Pike: AGENTE: @developer — do work FINE',
        '[Goal] Geordi: AGENTE: @developer — do work FINE',
        'Global rule: use TypeScript strict mode.',
        'Project fact: port is 8080.'
      ]) {
        seq++;
        facts.push({
          id: `f${seq}`, content, source: 'goal_orchestrator',
          timestamp: `2026-08-17T10:00:${String(seq % 60).padStart(2, '0')}.000Z`,
          scope: 'testscope', kind: content.startsWith('[Goal]') ? 'run' : 'fatto',
          hits: 1, lastUsed: '2026-08-17T10:00:00.000Z'
        });
      }
    }
    fs.writeFileSync(pollutedPath, JSON.stringify({ facts }), 'utf-8');

    const store = new MemoryStore(pollutedPath, 200, 'testscope');
    check('C1', facts.length === 40 && store.count() === 4,
      `a store written before the fix is healed on load: ${facts.length} entries collapse to ${store.count()} distinct facts, no manual cleanup needed`);

    const section = store.formatForPrompt(10);
    const lines = section.split('\n').filter((l) => l.startsWith('- '));
    check('C2', lines.length === 4 && new Set(lines).size === 4,
      'and the prompt section shows each fact once instead of ten times');
  }

  // ════════════════════════════════════════════════════════════════
  // Group D — the prompt shows what memory considers worth keeping
  // ════════════════════════════════════════════════════════════════
  {
    const store = tmpStore();
    // Written oldest first: under pure recency the 'run' notes would win outright.
    store.addFact('Lesson: the parallel block must stay serialized on one GPU.', 'agent', { kind: 'lezione' });
    store.addFact('Decision: the API listens on port 8080.', 'agent', { kind: 'decisione' });
    store.addFact('Project fact: the workspace jail blocks "..".', 'agent', { kind: 'fatto' });
    for (let i = 0; i < 6; i++) {
      store.addFact(`[Goal] Pike: AGENTE: @developer — routing note ${i}`, 'goal_orchestrator', { kind: 'run' });
    }

    const section = store.formatForPrompt(4);
    const lines = section.split('\n').filter((l) => l.startsWith('- '));

    check('D1', lines.length > 0 && lines[0].includes('Lesson:'),
      `the most durable fact leads the section (${lines[0]?.slice(0, 60)}…)`);
    check('D2', section.includes('Decision:') && section.includes('Project fact:'),
      'lessons, decisions and facts all make it into the budget');

    const runLines = lines.filter((l) => l.includes('routing note'));
    check('D3', runLines.length <= 1,
      `transient 'run' notes no longer crowd out real knowledge (${runLines.length} of ${lines.length} lines) — before the fix the six newest notes filled the section`);

    const recent = store.getRecent(3);
    check('D4', recent.every((f) => f.kind === 'run'),
      'getRecent stays chronological: the /memory listing still answers "what happened last", the prompt answers "what matters"');
  }

  // ════════════════════════════════════════════════════════════════
  // Group E — the character budget buys real content now
  // ════════════════════════════════════════════════════════════════
  {
    const store = tmpStore();
    store.addFact('Decision: the harness targets local llama-server first.', 'agent', { kind: 'decisione' });
    for (let i = 0; i < 20; i++) {
      store.addFact('[Goal] Pike: AGENTE: @developer — do work FINE', 'goal_orchestrator', { kind: 'run' });
    }
    const section = store.formatForPrompt(10, 600);
    check('E1', section.length <= 600 + 80,
      `the section respects the character budget (${section.length} chars including the "more memories" footer)`);
    check('E2', section.includes('Decision: the harness targets local llama-server first.'),
      'and twenty repeats of one routing note can no longer squeeze the only real decision out of the prompt');
    const noise = (section.match(/do work FINE/g) || []).length;
    check('E3', noise <= 1,
      `the repeated note appears at most once (${noise}) instead of twenty times`);
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best effort */ }
  process.exit(failed > 0 ? 1 : 0);
}

main();
