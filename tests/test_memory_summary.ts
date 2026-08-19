/**
 * Tests for T14.20/T14.21 — Memory list showing unreadable, indistinguishable entries.
 *
 * The TUI's `/memory` picker labeled every fact with a ~40-char slice of raw `content` and a
 * date that was actually just a time (`toLocaleTimeString()`, no day/month/year) — most facts
 * share a long common prefix (`[Goal] …`, `AGENTE: …`), so the part that would distinguish one
 * from another was exactly what got cut, and two facts saved on different days at a similar
 * hour looked identical. Fixed in three steps:
 *
 *  1. (T14.20) A new `summary` field (a commit subject, not the diff) on every `MemoryFact`,
 *     always populated — explicit when a caller provides one, otherwise derived from the first
 *     line of `content`. `save_memory` now requires it from the LLM instead of only offering
 *     `content`.
 *  2. (T14.20) The TUI/CLI listings show `summary` (not a `content` slice) and a real date.
 *  3. (T14.21) Found immediately on trying it against a real store: a plain first-line
 *     truncation reproduced the exact same "unreadable" bug for *existing* facts, because the
 *     system's own call sites (`goal.ts`, `agent.ts`, `spawnAgent.ts`) each write one long
 *     single-line pointer with the distinguishing detail past character 72. Healing now
 *     recognizes those known, fixed string formats first, and only falls back to a generic
 *     truncation for genuinely free-form content.
 *
 * This file covers (1) and (3) — the data layer. The listing/date-formatting change (2) is a
 * small, mostly visual edit to `systemModals.ts`/`cli/commands/memory.ts` covered indirectly by
 * `test_tui_data_driven.ts`'s existing HeaderView-style rendering checks; no fetch/store
 * dependency of its own worth a dedicated harness here.
 *
 * Isolated run: npx tsx tests/test_memory_summary.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore } from '../src/core/memory';
import { saveMemoryTool } from '../src/tools/impl/saveMemory';

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-memsummary-'));
let fileSeq = 0;
function tmpStore(scope = 'testscope'): MemoryStore {
  fileSeq++;
  return new MemoryStore(path.join(tmpDir, `memory-${fileSeq}.json`), 200, scope);
}

async function main() {
  console.log('=== Test memory summary field (T14.20) ===\n');

  // ── An explicit summary is kept verbatim (trimmed) ──
  {
    const store = tmpStore();
    const fact = store.addFact('The user prefers replies in Italian, always.', 'agent', {
      summary: '  User prefers Italian replies  ',
    });
    check('MS1', fact.summary === 'User prefers Italian replies', `summary esplicito conservato (trim): ${JSON.stringify(fact.summary)}`);
  }

  // ── No summary given: derived from the first line of content ──
  {
    const store = tmpStore();
    const fact = store.addFact('Port is 8080.\nSecond line should not leak into the summary.', 'agent');
    check('MS2', fact.summary === 'Port is 8080.', `sintesi derivata dalla prima riga: ${JSON.stringify(fact.summary)}`);
  }

  // ── An overlong explicit summary is capped, like a git subject line ──
  {
    const store = tmpStore();
    const longSummary = 'x'.repeat(120);
    const fact = store.addFact('content', 'agent', { summary: longSummary });
    check('MS3', fact.summary.length === 72 && fact.summary.endsWith('…'), `sintesi troncata a 72 caratteri con ellissi: len=${fact.summary.length}`);
  }

  // ── An overlong derived summary (no explicit one given) is capped the same way ──
  {
    const store = tmpStore();
    const fact = store.addFact('y'.repeat(200), 'agent');
    check('MS4', fact.summary.length === 72 && fact.summary.endsWith('…'), `sintesi derivata troncata anch'essa a 72: len=${fact.summary.length}`);
  }

  // ── Repeating the same content with a fresher explicit summary updates it (merge, T14.15) ──
  {
    const store = tmpStore();
    const first = store.addFact('Project fact: port is 8080.', 'agent', { summary: 'Old label' });
    const second = store.addFact('Project fact: port is 8080.', 'agent', { summary: 'Port is 8080' });
    check('MS5a', first.id === second.id, 'stesso contenuto nello stesso scope resta un unico fatto (dedup T14.15)');
    check('MS5b', second.summary === 'Port is 8080', `la sintesi più recente sostituisce la vecchia: ${JSON.stringify(second.summary)}`);
  }

  // ── Old data on disk with no `summary` field at all gets healed on load (self-healing, T14.15 pattern) ──
  {
    const filePath = path.join(tmpDir, 'legacy.json');
    fs.writeFileSync(filePath, JSON.stringify({
      facts: [{
        id: 'legacy-1',
        content: 'Legacy fact written before the summary field existed.',
        source: 'agent',
        timestamp: new Date().toISOString(),
        scope: 'testscope',
        kind: 'fatto',
        hits: 0,
        lastUsed: new Date().toISOString(),
        // no `summary` key
      }],
    }, null, 2));
    const store = new MemoryStore(filePath, 200, 'testscope');
    const [fact] = store.getRecent(10);
    check('MS6', fact?.summary === 'Legacy fact written before the summary field existed.', `fatto legacy sanato al load: ${JSON.stringify(fact?.summary)}`);
  }

  // ── T14.21: healing recognizes the system's own known content formats, instead of falling
  //    back to a generic truncation that reproduces the original "everything looks the same"
  //    bug on exactly the facts that make up most of a real store (goal.ts/agent.ts/spawnAgent.ts,
  //    which write one long single-line pointer with the distinguishing part past character 72) ──
  function healLegacyContent(content: string): string {
    fileSeq++;
    const filePath = path.join(tmpDir, `legacy-known-${fileSeq}.json`);
    fs.writeFileSync(filePath, JSON.stringify({
      facts: [{
        id: 'legacy-known',
        content,
        source: 'agent',
        timestamp: new Date().toISOString(),
        scope: 'testscope',
        kind: 'run',
        hits: 0,
        lastUsed: new Date().toISOString(),
      }],
    }, null, 2));
    const store = new MemoryStore(filePath, 200, 'testscope');
    return store.getRecent(10)[0]?.summary ?? '';
  }

  {
    const s = healLegacyContent(
      '[Goal] Geordi: Implemented the parser and wired it into the CLI, tests are green, ready for review.'
    );
    check('MS10', s === "Goal — Geordi's output condensed", `pattern [Goal] riconosciuto in un fatto legacy: ${JSON.stringify(s)}`);
  }
  {
    const s = healLegacyContent('[Compressed history] The conversation covered auth, then pivoted to the DB schema.');
    check('MS11', s === 'History auto-compressed', `pattern [Compressed history] riconosciuto: ${JSON.stringify(s)}`);
  }
  {
    const s = healLegacyContent(
      'Reasoning trace complete (2381 chars) on "non mi pare di aver capito bene, vorrei ricontrollare i dati" ' +
      'saved in memory/thinking/2026-08-19-agent.md — read with read_file before re-evaluating the task from scratch.'
    );
    check('MS12', s.startsWith('Reasoning trace complete: "non mi pare di aver capito bene'), `pattern traccia di reasoning riconosciuto (non più troncato a metà frase illeggibile): ${JSON.stringify(s)}`);
  }
  {
    const s = healLegacyContent(
      '[Subagent @researcher] Task: "Find the best library for X" -> Report: runs/abc/researcher-123.md. Summary: Found three candidates.'
    );
    check('MS13', s === 'Subagent @researcher: Find the best library for X', `pattern [Subagent] riconosciuto: ${JSON.stringify(s)}`);
  }
  {
    // Content matching no known system format (typical free-form agent content saved before
    // `summary` was required) still falls back to a plain first-line truncation, not a crash.
    const s = healLegacyContent('An arbitrary fact with no recognizable prefix at all.');
    check('MS14', s === 'An arbitrary fact with no recognizable prefix at all.', `fallback generico per contenuto non riconosciuto: ${JSON.stringify(s)}`);
  }

  // ── save_memory tool: summary is optional and derived when omitted; kind is optional and
  //    validated against the English schema enum (T15.3 — policy change from T14.20, which
  //    required an explicit summary) ──
  {
    const noSummary: any = await saveMemoryTool.execute({ content: 'Some fact.' } as any);
    check('MS15', typeof noSummary === 'string' && noSummary.includes('id:'),
      'summary omesso: il fatto viene salvato e il summary è derivato dal contenuto');

    const tooLong: any = await saveMemoryTool.execute({ summary: 'x'.repeat(80), content: 'Some fact.' });
    check('MS16', typeof tooLong === 'string' && tooLong.includes('id:'),
      'summary oltre 72 caratteri: troncato a valle dal cap di addFact, non più rifiutato (T15.3)');

    const badKind: any = await saveMemoryTool.execute({ kind: 'pizza', content: 'Some fact.' } as any).catch((e: Error) => e);
    check('MS18', badKind instanceof Error && /Invalid kind/.test(badKind.message), 'kind non appartenente all\'enum rifiutato');

    const goodKind: any = await saveMemoryTool.execute({ kind: 'lesson', content: 'Test the harness before every commit.' } as any);
    check('MS19', typeof goodKind === 'string' && goodKind.includes('id:'), 'kind inglese valido (lesson) accettato e mappato');

    const result = await saveMemoryTool.execute({ summary: 'A concise label', content: 'Some longer fact content here.' });
    check('MS17', typeof result === 'string' && result.includes('id:'), `salvataggio valido riuscito: ${result}`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
