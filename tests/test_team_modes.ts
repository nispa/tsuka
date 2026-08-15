/**
 * Test deterministici per le modalità di /team (T1.2, PLANNING-QUALITA.md).
 * Chiama direttamente le funzioni di modalità esportate da team.ts
 * (runRoundRobin, runOrchestrated, runPipeline — bypassando l'entry point
 * interattivo handleTeam, che chiede il compito via prompts()), con un
 * MockLLMProvider iniettato tramite CommandCtx (possibile da T1.1: CommandCtx.provider
 * è tipato su ILLMProvider, non sulla classe concreta LLMProvider).
 *
 * NOTA su STATO: FALLITO — il piano di pipeline (PLANNING.md) prevedeva uno stop
 * anticipato su "STATO: FALLITO", ma non è implementato da nessuna parte nel codice
 * attuale (nessuna funzione lo controlla). Lo scenario di rottura della pipeline
 * qui sotto riflette il comportamento REALE: nessuna stazione completa → la
 * pipeline scorre fino in fondo e ritorna completed:false. Segnalato per T2.1.
 *
 * Esecuzione: npx tsx tests/test_team_modes.ts
 */
import { runRoundRobin, runOrchestrated, runPipeline } from '../src/cli/commands/team';
import { GenerationInterrupt } from '../src/cli/interrupt';
import { ContextTracker } from '../src/core/contextTracker';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { buildMockCtx } from './mocks/mockCtx';
import { distinctAgents } from './fixtures/roster';

// Agenti risolti per MESTIERE, mai per nome proprio: il roster in characters/ è
// dati dell'utente e può essere rinominato o sostituito, i ruoli no. Le modalità
// di /team si verificano sui ruoli, non su chi li interpreta.
const [WORKER, SECOND, LEAD] = distinctAgents('sysadmin', 'security_auditor', 'supervisor');


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

/** Cattura le righe stampate con console.log durante l'esecuzione di fn. */
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
  console.log('=== Test Modalità /team (con MockLLMProvider) ===\n');

  // ── ROUND-ROBIN ──────────────────────────────────────────────────────────

  // T1: felice — STATO: COMPLETATO al primo turno → early stop, secondo membro mai chiamato
  {
    const provider = new MockLLMProvider([
      { content: 'Ho controllato tutto.\nSTATO: COMPLETATO' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER, SECOND] };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'verifica il sistema', 3, interrupt, seedTeamMessages('verifica il sistema'));
    check('RR1a', r.completed === true && r.roundsDone === 1, `early stop al round 1 (completed=${r.completed}, roundsDone=${r.roundsDone})`);
    check('RR1b', provider.remaining === 0, 'script consumato esattamente 1 volta: il secondo agente non è mai stato chiamato dopo il COMPLETATO del primo agente');
  }

  // T2: rottura — nessun marker in nessun round → stop al max round, non completato
  {
    const provider = new MockLLMProvider([
      { content: 'Lavoro in corso.\nSTATO: DA_CONTINUARE' },
      { content: 'Ancora in corso.\nSTATO: DA_CONTINUARE' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER] };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'compito senza fine', 2, interrupt, seedTeamMessages('compito senza fine'));
    check('RR2', r.completed === false && r.roundsDone === 2, `nessun marker → esaurisce i round senza completarsi (completed=${r.completed}, roundsDone=${r.roundsDone})`);
  }

  // ── ORCHESTRATED ─────────────────────────────────────────────────────────

  // T3: felice — l'orchestrator sceglie un membro valido, il routing viene seguito
  {
    const provider = new MockLLMProvider([
      { content: `AGENTE: @${WORKER}` },                    // decisione dell'orchestrator
      { content: 'Fatto.\nSTATO: COMPLETATO' }           // turno del primo agente
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [LEAD, WORKER, SECOND], orchestrator: LEAD };
    const interrupt = new GenerationInterrupt();
    const r = await runOrchestrated(ctx, team, 'analizza i log', 2, interrupt, seedTeamMessages('analizza i log'));
    check('OR1', r.completed === true && r.roundsDone === 1, `routing verso @${WORKER} seguito e completato (completed=${r.completed}, roundsDone=${r.roundsDone})`);
  }

  // T4: rottura — risposta dell'orchestrator non parseabile → fallback round-robin, con warning visibile
  {
    const provider = new MockLLMProvider([
      { content: 'Non saprei proprio chi dovrebbe continuare qui.' }, // orchestrator: né AGENTE: né FINE
      { content: 'Ok, procedo io.\nSTATO: COMPLETATO' }               // turno del fallback (primo agente)
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [LEAD, WORKER], orchestrator: LEAD };
    const interrupt = new GenerationInterrupt();
    const { result: r, logs } = await captureLogs(() =>
      runOrchestrated(ctx, team, 'compito ambiguo', 1, interrupt, seedTeamMessages('compito ambiguo'))
    );
    check(
      'OR2a',
      logs.some((l) => l.includes('risposta non riconosciuta')),
      '[verifica T2.1] il fallback a round-robin è visibile in log, non silenzioso'
    );
    check('OR2b', r.completed === true, `il fallback ha comunque chiamato @${WORKER} (unico worker) e completato (completed=${r.completed})`);
  }

  // ── PIPELINE ─────────────────────────────────────────────────────────────

  // T5: felice — catena completa, l'ultima stazione dichiara COMPLETATO
  {
    const provider = new MockLLMProvider([
      { content: 'Ho iniziato il lavoro.\nSTATO: DA_CONTINUARE' }, // stazione 1
      { content: 'Ho finito tutto.\nSTATO: COMPLETATO' }           // stazione 2
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER, SECOND] };
    const interrupt = new GenerationInterrupt();
    const teamMessages = seedTeamMessages('catena di lavoro');
    const r = await runPipeline(ctx, team, 'catena di lavoro', interrupt, teamMessages);
    check('PL1a', r.completed === true && r.roundsDone === 2, `catena completa, entrambe le stazioni eseguite (completed=${r.completed}, roundsDone=${r.roundsDone})`);
    const assistantMsgs = teamMessages.filter((m: any) => m.role === 'assistant');
    check('PL1b', assistantMsgs.length === 2, `entrambe le stazioni hanno lasciato un messaggio in history (trovati: ${assistantMsgs.length})`);
  }

  // T6: rottura — nessuna stazione completa → la pipeline scorre fino in fondo, completed:false
  // (STATO: FALLITO non è implementato: vedi nota in testa al file)
  {
    const provider = new MockLLMProvider([
      { content: 'Parzialmente fatto.\nSTATO: DA_CONTINUARE' },
      { content: 'Ancora parziale.\nSTATO: DA_CONTINUARE' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER, SECOND] };
    const interrupt = new GenerationInterrupt();
    const r = await runPipeline(ctx, team, 'catena senza esito', interrupt, seedTeamMessages('catena senza esito'));
    check(
      'PL2',
      r.completed === false && r.roundsDone === 2,
      `[gap PLANNING.md] nessun marker STATO: FALLITO gestito: la pipeline scorre comunque fino in fondo (completed=${r.completed}, roundsDone=${r.roundsDone})`
    );
  }

  // ── HYBRID / VOTING (round-robin con discussionRounds + voting) ─────────

  // T7: felice — unanimità di voto dopo il lavoro → completato
  {
    const provider = new MockLLMProvider([
      { content: 'Ho lavorato.\nSTATO: DA_CONTINUARE' },     // turno di lavoro del primo agente
      { content: '"Ottimo lavoro."\nVOTO: APPROVO' }          // discussione/voto del primo agente
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER], discussionRounds: 1, voting: true };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'task con voto', 2, interrupt, seedTeamMessages('task con voto'));
    check('HV1', r.completed === true && r.roundsDone === 1, `voto unanime (APPROVO) → completato dopo il round di discussione (completed=${r.completed}, roundsDone=${r.roundsDone})`);
  }

  // T8: rottura — un MODIFICARE rompe l'unanimità → turno di lavoro extra
  {
    const provider = new MockLLMProvider([
      { content: 'Prima bozza.\nSTATO: DA_CONTINUARE' },        // round 1: lavoro
      { content: '"Manca qualcosa."\nVOTO: MODIFICARE' },       // round 1: voto (non unanime)
      { content: 'Corretto.\nSTATO: COMPLETATO' }                // round 2: lavoro extra, completa
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER], discussionRounds: 1, voting: true };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'task con revisione', 2, interrupt, seedTeamMessages('task con revisione'));
    check(
      'HV2',
      r.completed === true && r.roundsDone === 2,
      `MODIFICARE al round 1 forza un turno extra (round 2) che completa (completed=${r.completed}, roundsDone=${r.roundsDone})`
    );
  }

  // ── PROTOCOLLO A TOOL CALL (T2.1) ────────────────────────────────────────
  // Per ogni modalità: scenario "modello usa il tool" (report_status/route_next/
  // cast_vote) + scenario "modello scrive solo testo" (fallback a regex, con
  // segnalazione gialla verificata nei log).

  console.log('\n--- Protocollo a tool call (T2.1) ---');

  // RRT1: round-robin, felice — report_status(COMPLETATO) via tool call, nessun marker testuale
  {
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('report_status', { status: 'COMPLETATO', summary: 'Verificato tutto.' })] }, // turno 1: tool call
      { content: 'Fatto, stato registrato.' } // turno 2: risposta finale dopo l'esecuzione del tool
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER, SECOND] };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'verifica il sistema', 3, interrupt, seedTeamMessages('verifica il sistema'));
    check('RRT1a', r.completed === true && r.roundsDone === 1, `report_status(COMPLETATO) via tool call → early stop (completed=${r.completed}, roundsDone=${r.roundsDone})`);
    check('RRT1b', provider.remaining === 0, 'il secondo agente non è mai stato chiamato: la tool call ha chiuso il turno del primo agente, non un marker testuale');
  }

  // RRT2: round-robin, rottura — solo testo (marker STATO:) → fallback a regex, degrado segnalato in giallo
  {
    const provider = new MockLLMProvider([
      { content: 'Fatto tutto.\nSTATO: COMPLETATO' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER] };
    const interrupt = new GenerationInterrupt();
    const { result: r, logs } = await captureLogs(() =>
      runRoundRobin(ctx, team, 'task testuale', 2, interrupt, seedTeamMessages('task testuale'))
    );
    check('RRT2a', r.completed === true && r.roundsDone === 1, `nessuna tool call: fallback a regex STATO: COMPLETATO → comunque completato (completed=${r.completed})`);
    check('RRT2b', logs.some((l) => l.includes("non ha usato la tool call 'report_status'")), 'caduta di livello a regex segnalata in UI (riga gialla)');
  }

  // ORT1: orchestrated, felice — route_next(@${WORKER}) via tool call, nessun marker AGENTE: testuale
  {
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('route_next', { agent: WORKER, reason: 'È il più adatto al compito.' })] }, // decisione orchestrator via tool
      { content: 'Fatto.\nSTATO: COMPLETATO' } // turno del primo agente
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [LEAD, WORKER, SECOND], orchestrator: LEAD };
    const interrupt = new GenerationInterrupt();
    const r = await runOrchestrated(ctx, team, 'analizza i log', 2, interrupt, seedTeamMessages('analizza i log'));
    check('ORT1', r.completed === true && r.roundsDone === 1, `routing via tool call route_next verso @${WORKER} seguito e completato (completed=${r.completed}, roundsDone=${r.roundsDone})`);
  }

  // ORT2: orchestrated, rottura — solo testo (AGENTE: @nome) → fallback a regex, degrado segnalato
  {
    const provider = new MockLLMProvider([
      { content: `AGENTE: @${WORKER}` },
      { content: 'Fatto.\nSTATO: COMPLETATO' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [LEAD, WORKER], orchestrator: LEAD };
    const interrupt = new GenerationInterrupt();
    const { result: r, logs } = await captureLogs(() =>
      runOrchestrated(ctx, team, 'compito testuale', 1, interrupt, seedTeamMessages('compito testuale'))
    );
    check('ORT2a', r.completed === true, `nessuna tool call route_next: fallback a regex AGENTE: @${WORKER} → comunque instradato (completed=${r.completed})`);
    check('ORT2b', logs.some((l) => l.includes("non ha usato la tool call 'route_next'")), 'caduta di livello a regex segnalata in UI (riga gialla)');
  }

  // PLT1: pipeline, felice — report_status(COMPLETATO) via tool call ferma la catena alla prima stazione
  {
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('report_status', { status: 'COMPLETATO', summary: 'Fatto tutto.' })] },
      { content: 'Registrato.' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER, SECOND] };
    const interrupt = new GenerationInterrupt();
    const r = await runPipeline(ctx, team, 'catena di lavoro', interrupt, seedTeamMessages('catena di lavoro'));
    check('PLT1', r.completed === true && r.roundsDone === 1, `report_status(COMPLETATO) via tool call ferma la pipeline alla stazione 1 (completed=${r.completed}, roundsDone=${r.roundsDone})`);
  }

  // PLT2: pipeline — report_status(FALLITO) via tool call interrompe la catena (gap T1.2/PLANNING.md ora chiuso)
  {
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('report_status', { status: 'FALLITO', summary: 'Impossibile procedere: dipendenza mancante.' })] },
      { content: 'Segnalato il fallimento.' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER, SECOND] };
    const interrupt = new GenerationInterrupt();
    const r: any = await runPipeline(ctx, team, 'catena impossibile', interrupt, seedTeamMessages('catena impossibile'));
    check(
      'PLT2',
      r.completed === false && r.failed === true && r.roundsDone === 1,
      `[T2.1] STATO: FALLITO via report_status ora ferma la pipeline (gap PLANNING.md chiuso): completed=${r.completed}, failed=${r.failed}, roundsDone=${r.roundsDone}, secondo agente mai chiamato`
    );
  }

  // PLT3: pipeline, rottura — solo testo (STATO:) su entrambe le stazioni → fallback a regex, degrado segnalato
  {
    const provider = new MockLLMProvider([
      { content: 'Parzialmente fatto.\nSTATO: DA_CONTINUARE' },
      { content: 'Ho concluso tutto.\nSTATO: COMPLETATO' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER, SECOND] };
    const interrupt = new GenerationInterrupt();
    const { result: r, logs } = await captureLogs(() =>
      runPipeline(ctx, team, 'catena testuale', interrupt, seedTeamMessages('catena testuale'))
    );
    check('PLT3a', r.completed === true && r.roundsDone === 2, `nessuna tool call su nessuna stazione: catena portata avanti via marker testuali (completed=${r.completed}, roundsDone=${r.roundsDone})`);
    const degradeCount = logs.filter((l) => l.includes("non ha usato la tool call 'report_status'")).length;
    check('PLT3b', degradeCount === 2, `caduta di livello segnalata per entrambe le stazioni (trovate ${degradeCount} righe)`);
  }

  // HVT1: hybrid/voting, felice — cast_vote(APPROVO) via tool call, nessun marker VOTO: testuale
  {
    const provider = new MockLLMProvider([
      { content: 'Ho lavorato.\nSTATO: DA_CONTINUARE' },
      { toolCalls: [mockToolCall('cast_vote', { vote: 'APPROVO', reason: 'Ottimo lavoro.' })] }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER], discussionRounds: 1, voting: true };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'task con voto', 2, interrupt, seedTeamMessages('task con voto'));
    check('HVT1', r.completed === true && r.roundsDone === 1, `voto APPROVO via tool call cast_vote → unanimità → completato (completed=${r.completed}, roundsDone=${r.roundsDone})`);
  }

  // HVT2: hybrid/voting, rottura — solo testo (VOTO:) → fallback a regex, degrado segnalato
  {
    const provider = new MockLLMProvider([
      { content: 'Ho lavorato.\nSTATO: DA_CONTINUARE' },
      { content: '"Ottimo lavoro."\nVOTO: APPROVO' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER], discussionRounds: 1, voting: true };
    const interrupt = new GenerationInterrupt();
    const { result: r, logs } = await captureLogs(() =>
      runRoundRobin(ctx, team, 'task con voto testuale', 2, interrupt, seedTeamMessages('task con voto testuale'))
    );
    check('HVT2a', r.completed === true && r.roundsDone === 1, `nessuna tool call cast_vote: fallback a regex VOTO: APPROVO → comunque unanime (completed=${r.completed})`);
    check('HVT2b', logs.some((l) => l.includes("non ha usato la tool call 'cast_vote'")), 'caduta di livello a regex segnalata in UI (riga gialla)');
  }

  // PLT4: pipeline con acceptance e retry loop (T6.4) — tent. 1 fallisce (FALLITO), tent. 2 passa
  {
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('report_status', { status: 'FALLITO', summary: 'Prima prova fallita' })] },
      { content: 'Errore nel turno.' },
      { toolCalls: [mockToolCall('report_status', { status: 'COMPLETATO', summary: 'Seconda prova superata' })] },
      { content: 'Registrato con successo.' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER], acceptance: { fileExists: 'README.md' }, maxAttempts: 2 };
    const interrupt = new GenerationInterrupt();
    const r: any = await runPipeline(ctx, team, 'catena con retry', interrupt, seedTeamMessages('catena con retry'));
    check('PLT4', r.completed === true, `[T6.4] pipeline con acceptance: ritentativo al turno 2 ha superato la stazione (completed=${r.completed})`);
  }

  // PLT5: pipeline con campi assenti → comportamento classico invariato
  {
    const provider = new MockLLMProvider([
      { content: 'Turno unico.\nSTATO: COMPLETATO' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER] };
    const interrupt = new GenerationInterrupt();
    const r = await runPipeline(ctx, team, 'catena classica', interrupt, seedTeamMessages('catena classica'));
    check('PLT5', r.completed === true && r.roundsDone === 1, `[T6.4] campi acceptance assenti: comportamento classico invariato (completed=${r.completed})`);
  }

  // ── T9.10: nudge quando un round produce solo testo, senza tool call né marker ──
  console.log('\n--- Nudge su "solo ragionamento, nessuna azione" (T9.10) ---');

  // NA1: primo round senza tool call e senza marker → nudge; il round successivo
  // chiama report_status (l'Agent continua il proprio loop interno: dopo un tool
  // eseguito serve comunque una risposta di chiusura, come in RRT1a) → il turno
  // si completa. Senza il nudge, il copione si sarebbe esaurito dopo 1 sola
  // chiamata invece di 3.
  {
    const provider = new MockLLMProvider([
      { content: 'Sto valutando come procedere, ci sono diverse opzioni da considerare...' }, // solo ragionamento, nessun segnale → nudge
      { toolCalls: [mockToolCall('report_status', { status: 'COMPLETATO', summary: 'Fatto dopo il nudge.' })] }, // agisce
      { content: 'Fatto, stato registrato.' } // chiusura dopo l'esecuzione del tool (come RRT1a)
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER] };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'compito che richiede azione', 3, interrupt, seedTeamMessages('compito che richiede azione'));
    check('NA1a', provider.remaining === 0, 'tutte e tre le risposte scriptate sono state consumate (nudge + azione + chiusura)');
    check('NA1b', r.completed === true, `il turno si completa dopo il nudge (completed=${r.completed})`);
  }

  // NA2: nessun segnale né prima né dopo il nudge → un solo nudge (non un loop
  // infinito), poi il turno finisce comunque e ricade sul default 'continue'.
  {
    const provider = new MockLLMProvider([
      { content: 'Ci penso ancora un attimo...' },
      { content: 'Ok, credo di aver capito il problema.' } // ancora nessun tool call né marker
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER] };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'compito senza mai un segnale', 1, interrupt, seedTeamMessages('compito senza mai un segnale'));
    check('NA2a', provider.remaining === 0, 'esattamente un nudge (2 chiamate totali, non di più): nessun loop infinito');
    check('NA2b', r.completed === false, `senza segnale nemmeno dopo il nudge, il turno NON risulta completato (completed=${r.completed})`);
  }

  // NA3: un marker DA_CONTINUARE (non solo COMPLETATO) è comunque una chiusura
  // testuale legittima → nessun nudge.
  {
    const provider = new MockLLMProvider([
      { content: 'Lavoro avviato ma non ancora finito.\nSTATO: DA_CONTINUARE' }
    ]);
    const ctx = buildMockCtx(provider);
    const team = { members: [WORKER] };
    const interrupt = new GenerationInterrupt();
    const r = await runRoundRobin(ctx, team, 'compito con DA_CONTINUARE esplicito', 1, interrupt, seedTeamMessages('compito con DA_CONTINUARE esplicito'));
    check('NA3', provider.remaining === 0, 'STATO: DA_CONTINUARE (non solo COMPLETATO) evita il nudge: unica chiamata scriptata consumata');
  }

  ContextTracker.getInstance().clear();

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
