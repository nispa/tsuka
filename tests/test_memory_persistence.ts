/**
 * Tests for T15.6 — robust persistence of MemoryStore (TASKS.md — FASE 7):
 *
 *  - Atomic writes: save() writes to a sibling `.tmp` file and renames it onto the real
 *    path, so an interruption mid-write can never leave a half-written memory.json.
 *  - Corrupt file recovery: a JSON that fails to parse is never reset silently — the bytes
 *    are preserved under `memory.json.corrupt-<epoch>` and a warning is emitted, then the
 *    store starts empty.
 *  - Orphan `.tmp` cleanup: a crash between write and rename leaves a stale tmp; it is
 *    removed on the next load.
 *  - T15.5 interplay: when a run-heavy overflow triggers eviction, the durable kinds all
 *    survive while the transient run notes are the ones dropped.
 *
 * Full isolation from the real user store (same pattern as test_memory_phase3.ts):
 * TSUKA_HOME points at a temporary home, so even the logSink file log and config resolution
 * stay inside the sandbox. MemoryStore instances use explicit temp file paths.
 *
 * Isolated run: npx tsx tests/test_memory_persistence.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setLogSink, resetLogSink } from '../src/core/logSink';

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

async function main() {
  console.log('=== Test memoria: persistenza robusta (T15.6) ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-mempersist-home-'));
  process.env.TSUKA_HOME = tmpHome;

  const { MemoryStore } = await import('../src/core/memory');

  const capture: string[] = [];
  setLogSink({
    log: () => {},
    warn: (m: string) => capture.push(m),
    error: (m: string) => capture.push(m),
  });

  const file = path.join(tmpHome, 'memory.json');

  // ── P1/P2: live save/load roundtrip, no leftover tmp after a clean write ──
  {
    const store1 = new MemoryStore(file, 50, 'scope-persist');
    store1.addFact('Durable fact that must survive a reload.', 'agent', { kind: 'fatto' });
    store1.addFact('Lesson worth keeping across sessions.', 'agent', { kind: 'lezione' });

    check('P1a', fs.existsSync(file), 'save() ha scritto il file su disco');
    check('P2', !fs.existsSync(`${file}.tmp`), 'nessun file .tmp residuo dopo una scrittura pulita');

    const store2 = new MemoryStore(file, 50, 'scope-persist');
    check('P1b', store2.count() === 2, `fatti ricaricati da nuova istanza (${store2.count()})`);
  }

  // ── P3: file corrotto -> backup recuperabile + warning, mai reset silenzioso ──
  {
    const corruptFile = path.join(tmpHome, 'corrupt.json');
    const garbage = '{"facts": [{"id": "half"';
    fs.writeFileSync(corruptFile, garbage, 'utf-8');

    const store = new MemoryStore(corruptFile, 50, 'scope-persist');
    check('P3a', store.count() === 0, 'store riparte vuoto dopo il file corrotto');

    const backup = fs.readdirSync(tmpHome).find((f) => /^corrupt\.json\.corrupt-\d+$/.test(f));
    check('P3b', !!backup, `file corrotto sopravvive in un backup rinominato (${backup})`);
    check('P3c', !!backup && fs.readFileSync(path.join(tmpHome, backup!), 'utf-8') === garbage,
      'il backup conserva i byte originali, senza correzioni silenziose');
    check('P3d', !fs.existsSync(corruptFile), 'il file corrotto originale non resta al suo posto');
    check('P3e', capture.some((m) => m.includes('corrupt')), 'il warning di backup è stato emesso via logSink');
  }

  // ── P4: tmp orfano da crash tra write e rename viene ripulito al load ──
  {
    const orphanFile = path.join(tmpHome, 'orphan.json');
    fs.writeFileSync(orphanFile, JSON.stringify({
      facts: [{ id: 'ok', content: 'Intact fact', source: 'agent', timestamp: new Date().toISOString(), scope: 'scope-persist', kind: 'fatto', hits: 0, lastUsed: new Date().toISOString() }],
    }), 'utf-8');
    fs.writeFileSync(`${orphanFile}.tmp`, 'half-written garbage from a crashed save', 'utf-8');

    const store = new MemoryStore(orphanFile, 50, 'scope-persist');
    check('P4a', store.count() === 1, 'il file reale (integro) è quello letto, non il tmp');
    check('P4b', !fs.existsSync(`${orphanFile}.tmp`), 'il tmp orfano è stato rimosso al load');
  }

  // ── P5 (interplay T15.5): store pieno di run => i kind durevoli sopravvivono all'overflow ──
  {
    const quotaFile = path.join(tmpHome, 'quota.json');
    const store = new MemoryStore(quotaFile, 5, 'scope-persist');
    const lesson = store.addFact('Lasting lesson: run notes are transient.', 'agent', { kind: 'lezione' });
    const decision = store.addFact('Decision: API base URL is configurable.', 'agent', { kind: 'decisione' });
    const fact = store.addFact('Project fact: only one GPU per branch.', 'agent', { kind: 'fatto' });
    for (let i = 0; i < 8; i++) {
      store.addFact(`[Goal] Run note #${i} with transient details`, 'goal_orchestrator', { kind: 'run' });
    }

    const ids = new Set(store.getRecent(50).map((f) => f.id));
    check('P5a', ids.has(lesson.id) && ids.has(decision.id) && ids.has(fact.id),
      'i tre kind durevoli sopravvivono a un overflow di soli run');
    check('P5b', store.count() === 5, `il totale resta al cap dopo l'eviction (${store.count()})`);
    const runs = store.getRecent(50).filter((f) => f.kind === 'run').length;
    check('P5c', runs <= 2, `i run residui sono al massimo la quota run di cap (residui: ${runs})`);
  }

  resetLogSink();
  fs.rmSync(tmpHome, { recursive: true, force: true });

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  resetLogSink();
  process.exit(1);
});