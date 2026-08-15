/**
 * Test dei workspace isolati per il blocco PARALLELO di /goal (T3.2, PLANNING-QUALITA.md).
 *
 * Bug: nel blocco `PARALLELO` (`Promise.all` in goal.ts), tutti gli agenti condividono
 * lo stesso workspace: due branch che scrivono lo stesso file con contenuto diverso si
 * sovrascrivono a vicenda in modo silenzioso, senza alcuna segnalazione.
 *
 * Fix: ogni branch scrive isolato in una propria cartella di staging
 * (`workspace/parallel-<n>/` sotto l'app home, non nella workspace reale — vedi
 * `src/core/parallelWorkspace.ts`), attivata come jail temporanea via
 * `withWorkspaceOverride` (AsyncLocalStorage, `src/tools/impl/utils.ts`). A fine
 * blocco i file vengono uniti nella workspace principale: se due branch hanno
 * scritto lo stesso path con contenuto diverso, il conflitto viene segnalato e
 * NESSUNO dei due viene copiato (nessuna sovrascrittura silenziosa).
 *
 * Parte 1: unit test diretto di `mergeParallelWorkspaces` (deterministico, senza
 * LLM/tool). Parte 2: test end-to-end con 2 "agenti mock" (MockLLMProvider) che
 * chiamano davvero il tool `write_file` dentro un blocco PARALLELO di /goal —
 * prova che l'isolamento (AsyncLocalStorage) e il merge funzionano attraversando
 * lo stack reale (Agent → ToolRegistry → resolveSafePath).
 *
 * NOTA: come in test_workspace_jail.ts, i moduli che leggono la configurazione
 * (ConfigManager, resolveSafePath, homePath) vanno importati DINAMICAMENTE dopo
 * aver impostato TSUKA_HOME, perché calcolano i percorsi al load del modulo.
 *
 * Esecuzione: npx tsx tests/test_parallel_workspace.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { InteractiveMenu } from '../src/cli/ui';

// I branch paralleli sono etichettati con il nome dell'agente: qui contano i RUOLI
// coinvolti, non chi li interpreta nel catalogo installato. La fixture va importata
// DINAMICAMENTE come gli altri moduli che leggono la home (vedi nota in testa):
// un import statico caricherebbe apphome prima che TSUKA_HOME sia impostato.
let FIRST = '';
let SECOND = '';


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

async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

async function main() {
  console.log('=== Test Workspace Isolati Blocco PARALLELO (T3.2) ===\n');

  // Isola TSUKA_HOME per l'intero test PRIMA di importare qualunque modulo che
  // dipenda da homePath/ConfigManager (createParallelBranches usa homePath: se
  // TSUKA_HOME non fosse impostato ancora, creerebbe workspace/parallel-N/ nella
  // vera cartella del progetto invece che in una home temporanea).
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-parallel-home-'));
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-parallel-ws-'));
  process.env.TSUKA_HOME = tmpHome;
  fs.writeFileSync(
    path.join(tmpHome, 'tsuka.config.json'),
    JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer',
      activeTrait: 'professional',
      activeCharacter: 'custom',
      workspaceRoot: tmpWorkspace
    }, null, 2)
  );
  // handleGoal (Parte 2) legge personaggi/ruoli/tratti reali via homePath(): li
  // copiamo nella home temporanea (characters/roles/traits sono asset statici
  // del progetto, non serve fingerli — stesso approccio di tests/mocks/mockCtx.ts).
  const projectRoot = path.resolve(__dirname, '..');
  for (const dir of ['characters', 'roles', 'traits']) {
    fs.cpSync(path.join(projectRoot, dir), path.join(tmpHome, dir), { recursive: true });
  }

  const { distinctAgents } = await import('./fixtures/roster');
  [FIRST, SECOND] = distinctAgents('developer', 'architect');

  // ── Parte 1: mergeParallelWorkspaces isolato (senza LLM/tool) ─────────────

  {
    const { createParallelBranches, mergeParallelWorkspaces } = await import('../src/core/parallelWorkspace');
    const tmpMain = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-parallel-main-'));

    // M1: due branch scrivono file distinti → entrambi finiscono nel merge
    {
      const branches = createParallelBranches([FIRST, SECOND]);
      fs.writeFileSync(path.join(branches[0].root, 'a.txt'), 'Contenuto A');
      fs.writeFileSync(path.join(branches[1].root, 'b.txt'), 'Contenuto B');

      const result = mergeParallelWorkspaces(branches, tmpMain);

      check('M1a', result.conflicts.length === 0, 'nessun conflitto per path distinti');
      check('M1b', result.merged.sort().join(',') === 'a.txt,b.txt', `entrambi i path uniti (merged: ${result.merged.join(', ')})`);
      check(
        'M1c',
        fs.readFileSync(path.join(tmpMain, 'a.txt'), 'utf-8') === 'Contenuto A' &&
          fs.readFileSync(path.join(tmpMain, 'b.txt'), 'utf-8') === 'Contenuto B',
        'i file nella workspace principale hanno il contenuto corretto'
      );
      check(
        'M1d',
        !fs.existsSync(branches[0].root) && !fs.existsSync(branches[1].root),
        'le cartelle di staging sono state ripulite dopo il merge'
      );
    }

    // M2: stesso path, contenuto diverso tra branch → conflitto, file principale intatto
    {
      // Il file NON esiste ancora nella workspace principale: deve restare così.
      const target = path.join(tmpMain, 'conflict.txt');
      const branches = createParallelBranches([FIRST, SECOND]);
      fs.writeFileSync(path.join(branches[0].root, 'conflict.txt'), 'Versione 1');
      fs.writeFileSync(path.join(branches[1].root, 'conflict.txt'), 'Versione 2');

      const result = mergeParallelWorkspaces(branches, tmpMain);

      check('M2a', result.merged.length === 0, 'nessun file unito (l\'unico path è in conflitto)');
      check(
        'M2b',
        result.conflicts.length === 1 && result.conflicts[0].relativePath === 'conflict.txt' &&
          result.conflicts[0].labels.sort().join(',') === [FIRST, SECOND].sort().join(','),
        `conflitto segnalato con i branch coinvolti (${JSON.stringify(result.conflicts)})`
      );
      check('M2c', !fs.existsSync(target), 'il file NON viene creato nella workspace principale in caso di conflitto');
    }

    // M3: stesso path scritto da più branch ma con contenuto IDENTICO → non è un conflitto, si unisce
    {
      const branches = createParallelBranches([FIRST, SECOND]);
      fs.writeFileSync(path.join(branches[0].root, 'same.txt'), 'Uguale per tutti');
      fs.writeFileSync(path.join(branches[1].root, 'same.txt'), 'Uguale per tutti');

      const result = mergeParallelWorkspaces(branches, tmpMain);

      check('M3a', result.conflicts.length === 0, 'contenuto identico tra branch → nessun conflitto');
      check('M3b', result.merged.includes('same.txt'), 'il path viene comunque unito');
    }

    // M4: un file preesistente nella workspace principale resta intatto se il path va in conflitto
    {
      const target = path.join(tmpMain, 'preexisting.txt');
      fs.writeFileSync(target, 'Originale');
      const branches = createParallelBranches([FIRST, SECOND]);
      fs.writeFileSync(path.join(branches[0].root, 'preexisting.txt'), 'Tentativo 1');
      fs.writeFileSync(path.join(branches[1].root, 'preexisting.txt'), 'Tentativo 2');

      mergeParallelWorkspaces(branches, tmpMain);

      check('M4', fs.readFileSync(target, 'utf-8') === 'Originale', 'file preesistente in conflitto: resta intatto, nessuna sovrascrittura silenziosa');
    }

    fs.rmSync(tmpMain, { recursive: true, force: true });
  }

  // ── Parte 2: end-to-end con /goal, MockLLMProvider e write_file reale ─────

  const originalSelect = InteractiveMenu.select;
  (InteractiveMenu as any).select = async () => 'yes'; // auto-approva i prompt RESTRICTED (write_file)

  // Import dinamico DOPO aver impostato TSUKA_HOME (come in test_workspace_jail.ts)
  const { handleGoal } = await import('../src/cli/commands/goal');
  const { buildMockCtx } = await import('./mocks/mockCtx');
  const { writeFileTool } = await import('../src/tools/impl/writeFile');
  const { ContextTracker } = await import('../src/core/contextTracker');

  // G1: due agenti mock scrivono file distinti in parallelo → entrambi nella workspace reale
  {
    ContextTracker.getInstance().clear();
    const provider = new MockLLMProvider([
      { content: `PARALLELO:\nAGENTE: @${FIRST} — Scrivi file A\nAGENTE: @${SECOND} — Scrivi file B\nFINE PARALLELO\nFINE` }, // piano
      { toolCalls: [mockToolCall('write_file', { path: 'a.txt', content: 'Contenuto A' })] },
      { toolCalls: [mockToolCall('write_file', { path: 'b.txt', content: 'Contenuto B' })] },
      { content: 'Fatto.\nSTATO: COMPLETATO' },
      { content: 'Fatto.\nSTATO: COMPLETATO' },
    ]);
    const ctx = buildMockCtx(provider);
    ctx.registry.register(writeFileTool);

    await handleGoal(ctx, 'Scrivi due file distinti in parallelo');

    check('G1a', provider.remaining === 0, 'tutti gli step scriptati (piano + 2×2 round) sono stati consumati');
    check(
      'G1b',
      fs.existsSync(path.join(tmpWorkspace, 'a.txt')) && fs.readFileSync(path.join(tmpWorkspace, 'a.txt'), 'utf-8') === 'Contenuto A',
      "'a.txt' presente nella workspace reale con il contenuto corretto"
    );
    check(
      'G1c',
      fs.existsSync(path.join(tmpWorkspace, 'b.txt')) && fs.readFileSync(path.join(tmpWorkspace, 'b.txt'), 'utf-8') === 'Contenuto B',
      "'b.txt' presente nella workspace reale con il contenuto corretto"
    );
    check(
      'G1d',
      !fs.existsSync(path.join(tmpHome, 'workspace', 'parallel-1')) && !fs.existsSync(path.join(tmpHome, 'workspace', 'parallel-2')),
      'le cartelle di staging sono state ripulite a fine blocco'
    );
  }

  // G2: due agenti mock scrivono LO STESSO file con contenuto diverso → conflitto segnalato, file principale intatto
  {
    ContextTracker.getInstance().clear();
    const preexisting = path.join(tmpWorkspace, 'conflict.txt');
    fs.writeFileSync(preexisting, 'Originale prima del parallelo');

    const provider = new MockLLMProvider([
      { content: `PARALLELO:\nAGENTE: @${FIRST} — Scrivi conflitto\nAGENTE: @${SECOND} — Scrivi conflitto\nFINE PARALLELO\nFINE` },
      { toolCalls: [mockToolCall('write_file', { path: 'conflict.txt', content: `Versione di ${FIRST}` })] },
      { toolCalls: [mockToolCall('write_file', { path: 'conflict.txt', content: `Versione di ${SECOND}` })] },
      { content: 'Fatto.\nSTATO: COMPLETATO' },
      { content: 'Fatto.\nSTATO: COMPLETATO' },
    ]);
    const ctx = buildMockCtx(provider);
    ctx.registry.register(writeFileTool);

    const { logs } = await captureLogs(() => handleGoal(ctx, 'Scrivi lo stesso file in parallelo'));

    check(
      'G2a',
      fs.readFileSync(preexisting, 'utf-8') === 'Originale prima del parallelo',
      'il file principale resta intatto (nessuna sovrascrittura silenziosa dal conflitto)'
    );
    check(
      'G2b',
      logs.some((l) => l.includes('Conflitti nel blocco parallelo')) && logs.some((l) => l.includes('conflict.txt')),
      'il conflitto viene segnalato in console (agenti coinvolti + path)'
    );
  }

  InteractiveMenu.select = originalSelect;

  // Pulizia
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpWorkspace, { recursive: true, force: true }); } catch {}
  delete process.env.TSUKA_HOME;

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
