/**
 * Test della Blackboard di run (T6.2, TASKS.md — FASE 2): stato condiviso di UN
 * SOLO run `/team` o `/goal` (decisioni prese, artefatti prodotti, punti aperti),
 * separato sia dalla history (ciò che è stato detto) sia dalla memoria persistente
 * (ciò che resta fra le sessioni — `src/core/memory.ts`, mai toccata da qui).
 *
 * Copre i 3 punti dell'accettazione di T6.2:
 * (a) l'agente A scrive una nota nel suo turno (tool post_note) e l'agente B la
 *     legge nel turno successivo (tool read_notes) — verificato sull'OUTPUT del
 *     tool, attraverso lo stack reale Agent → ToolRegistry → tool (MockLLMProvider
 *     + runRoundRobin, come test_team_modes.ts), non chiamando Blackboard a mano;
 * (b) la nota compare nel JSON scritto in workflow_logs/ (writeWorkflowLog);
 * (c) due run concorrenti (Promise.all, come il blocco PARALLELO di /goal) non si
 *     vedono le note a vicenda — prova diretta dell'isolamento via AsyncLocalStorage.
 *
 * Le funzioni di modalità (runRoundRobin) sono chiamate direttamente, come in
 * test_team_modes.ts (bypassa l'entry point interattivo handleTeam, che chiede il
 * compito via prompts()) — avvolte a mano in Blackboard.withRun esattamente come fa
 * team.ts (handleTeam), quindi l'isolamento testato è lo stesso meccanismo di
 * produzione, non una scorciatoia.
 *
 * Esecuzione: npx tsx tests/test_blackboard.ts
 */
import { GenerationInterrupt } from '../src/cli/interrupt';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { buildMockCtx } from './mocks/mockCtx';
import { runRoundRobin } from '../src/cli/commands/team';
import { Blackboard } from '../src/core/blackboard';
import { distinctAgents, aiNameWithRole } from './fixtures/roster';

// Agenti scelti per MESTIERE: la blackboard è condivisa fra ruoli diversi, e quale
// personaggio li interpreti dipende dal catalogo installato.
const [WRITER, READER] = distinctAgents('developer', 'architect');
const WRITER_AI_NAME = aiNameWithRole('developer');


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

function seedTeamMessages(task: string) {
  return [
    { role: 'system' as const, content: '' },
    { role: 'user' as const, content: `COMPITO DI GRUPPO DA RISOLVERE: "${task}"` }
  ];
}

async function main() {
  console.log('=== Test Blackboard di run (T6.2) ===\n');

  // ── (a) agente A scrive una nota, agente B la legge nel turno successivo ───
  // Verificato attraversando lo stack reale: il risultato del tool read_notes
  // (un messaggio 'tool' nella history INVIATA al modello alla chiamata LLM
  // successiva) deve contenere il testo scritto da post_note.
  let noteRunId = '';
  {
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('post_note', { key: 'decisione-db', value: 'Uso SQLite per il db' })] }, // il primo agente: scrive
      { content: 'Nota lasciata.\nSTATO: DA_CONTINUARE' },                                                 // il primo agente: chiude il turno (non completo)
      { toolCalls: [mockToolCall('read_notes', {})] },                                                     // il secondo agente: legge
      { content: 'Vista la nota di il primo agente.\nSTATO: COMPLETATO' },                                           // il secondo agente: chiude
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WRITER, READER] };
    const interrupt = new GenerationInterrupt();

    // Stessa API usata da handleTeam (team.ts): un runId per workflow, la strategia
    // eseguita dentro Blackboard.withRun.
    noteRunId = Blackboard.newRunId();
    const r = await Blackboard.withRun(noteRunId, () =>
      runRoundRobin(ctx, team, 'decidi il database', 2, interrupt, seedTeamMessages('decidi il database'))
    );

    check('BB-a-1', r.completed === true && r.roundsDone === 1, `round-robin completato al round 1 (completed=${r.completed}, roundsDone=${r.roundsDone})`);
    check('BB-a-2', provider.remaining === 0, 'copione consumato interamente: 2 chiamate per il primo agente (post_note + STATO) + 2 per il secondo agente (read_notes + STATO)');

    // callLog[3] = seconda chiamata LLM di il secondo agente (dopo l'esecuzione di
    // read_notes): la history inviata al modello deve includere il messaggio
    // 'tool' con l'output di read_notes — è la prova che passa per il tool reale.
    const readerSecondCall = provider.callLog[3];
    const toolMsg = readerSecondCall?.messages.find((m: any) => m.role === 'tool' && m.name === 'read_notes');
    check('BB-a-3', !!toolMsg, 'la seconda chiamata LLM di il secondo agente include un messaggio tool read_notes nella history inviata al modello');
    check(
      'BB-a-4',
      !!toolMsg && typeof toolMsg.content === 'string' && toolMsg.content.includes('Uso SQLite per il db'),
      `il contenuto della nota scritta da il primo agente compare nel risultato di read_notes letto da il secondo agente (${JSON.stringify(toolMsg?.content)})`
    );
    check(
      'BB-a-5',
      !!toolMsg && typeof toolMsg.content === 'string' && new RegExp(WRITER_AI_NAME, 'i').test(toolMsg.content),
      `l'autore della nota (il primo agente) è attribuito correttamente nel testo restituito da read_notes (${JSON.stringify(toolMsg?.content)})`
    );
  }

  // ── (b) la nota compare nel JSON in workflow_logs/ ──────────────────────────
  {
    // Isola workflow_logs/ in una home temporanea (come test_parallel_workspace.ts):
    // homePath() legge TSUKA_HOME ad ogni chiamata (non lo cachea al load del
    // modulo), ma per coerenza con la convenzione già in uso nel repo importiamo
    // dinamicamente workflowLog.ts DOPO aver impostato la env var.
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-blackboard-home-'));
    process.env.TSUKA_HOME = tmpHome;

    const { writeWorkflowLog } = await import('../src/cli/commands/workflowLog');

    // Snapshot del run (a): la nota scritta da il primo agente tramite lo stack reale sopra.
    const snapshot = Blackboard.forRun(noteRunId).snapshot();
    check('BB-b-pre', snapshot.length === 1 && snapshot[0].key === 'decisione-db', `snapshot del run (a) contiene la nota scritta da il primo agente (${JSON.stringify(snapshot)})`);

    writeWorkflowLog({
      team: { name: 'test-blackboard', displayName: 'Test Blackboard', members: [WRITER, READER] },
      task: 'decidi il database',
      completed: true,
      failed: false,
      roundsDone: 1,
      teamMessages: [],
      turnLog: [],
      blackboard: snapshot
    });
    Blackboard.endRun(noteRunId);

    const logsDir = path.join(tmpHome, 'workflow_logs');
    const files = fs.existsSync(logsDir) ? fs.readdirSync(logsDir) : [];
    check('BB-b-1', files.length === 1, `esattamente un file di workflow log scritto (${files.length})`);
    const reportRaw = files.length > 0 ? fs.readFileSync(path.join(logsDir, files[0]), 'utf-8') : '';
    const report = files.length > 0 ? JSON.parse(reportRaw) : null;
    check('BB-b-2', !!report && Array.isArray(report.blackboard) && report.blackboard.length === 1, `il JSON del workflow log include il campo 'blackboard' con la nota (${reportRaw.slice(0, 200)})`);
    check(
      'BB-b-3',
      !!report && report.blackboard[0]?.key === 'decisione-db' &&
        report.blackboard[0]?.value === 'Uso SQLite per il db' &&
        report.blackboard[0]?.author?.toLowerCase() === WRITER_AI_NAME.toLowerCase(),
      `la nota nel JSON ha key/value/author corretti (${JSON.stringify(report?.blackboard)})`
    );

    fs.rmSync(tmpHome, { recursive: true, force: true });
    delete process.env.TSUKA_HOME;
  }

  // ── (c) due run concorrenti (Promise.all) non si vedono le note a vicenda ───
  {
    const providerX = new MockLLMProvider([
      { toolCalls: [mockToolCall('post_note', { key: 'segreto-x', value: 'Solo il run X conosce questo' })] },
      { content: 'Fatto.\nSTATO: COMPLETATO' },
    ]);
    const providerY = new MockLLMProvider([
      { toolCalls: [mockToolCall('read_notes', {})] },
      { content: 'Nessuna nota vista.\nSTATO: COMPLETATO' },
    ]);
    const ctxX = buildMockCtx(providerX);
    const ctxY = buildMockCtx(providerY);
    const teamX = { members: [WRITER] };
    const teamY = { members: [READER] };
    const interruptX = new GenerationInterrupt();
    const interruptY = new GenerationInterrupt();

    const runIdX = Blackboard.newRunId();
    const runIdY = Blackboard.newRunId();
    check('BB-c-runid', runIdX !== runIdY, 'i due run generano runId distinti');

    // Due run distinti eseguiti in Promise.all, ognuno nel proprio Blackboard.withRun:
    // stesso schema del blocco PARALLELO di /goal (branch diversi in Promise.all
    // nello stesso processo), qui applicato a due workflow indipendenti.
    const [resX, resY] = await Promise.all([
      Blackboard.withRun(runIdX, () => runRoundRobin(ctxX, teamX, 'compito segreto X', 1, interruptX, seedTeamMessages('compito segreto X'))),
      Blackboard.withRun(runIdY, () => runRoundRobin(ctxY, teamY, 'compito curioso Y', 1, interruptY, seedTeamMessages('compito curioso Y')))
    ]);

    check('BB-c-1', resX.completed === true && resY.completed === true, `entrambi i run completati indipendentemente (X=${resX.completed}, Y=${resY.completed})`);

    // read_notes eseguito dentro il run Y (seconda chiamata LLM di il secondo agente, indice
    // 1 nel SUO provider): non deve contenere la nota scritta nel run X.
    const yToolMsg = providerY.callLog[1]?.messages.find((m: any) => m.role === 'tool' && m.name === 'read_notes');
    check('BB-c-2', !!yToolMsg, 'la seconda chiamata LLM del run Y include il risultato di read_notes');
    check(
      'BB-c-3',
      !!yToolMsg && typeof yToolMsg.content === 'string' && !yToolMsg.content.includes('Solo il run X conosce questo'),
      `il run Y NON vede la nota scritta nel run X concorrente (${JSON.stringify(yToolMsg?.content)})`
    );
    check(
      'BB-c-4',
      !!yToolMsg && typeof yToolMsg.content === 'string' && (/nessuna nota/i.test(yToolMsg.content) || /no notes/i.test(yToolMsg.content)),
      `read_notes nel run Y ritorna "nessuna nota" (la sua blackboard è vuota) (${JSON.stringify(yToolMsg?.content)})`
    );
    check('BB-c-5', Blackboard.forRun(runIdX).snapshot().length === 1, 'la blackboard del run X contiene la nota scritta al suo interno');
    check('BB-c-6', Blackboard.forRun(runIdY).snapshot().length === 0, 'la blackboard del run Y resta vuota: nessuna nota scritta al suo interno, e nessuna "trapelata" da X');

    Blackboard.endRun(runIdX);
    Blackboard.endRun(runIdY);
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
