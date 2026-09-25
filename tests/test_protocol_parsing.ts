/**
 * Test del parsing di protocollo con input sporchi (T1.3, PLANNING-QUALITA.md).
 *
 * Le funzioni testate qui sono il punto dove i bug non deterministici nascono:
 * il coordinamento multi-agente si basa su regex applicate all'output libero di
 * modelli piccoli (marker dentro markdown, maiuscole sbagliate, righe accumulate).
 * Ogni caso documenta il comportamento ATTUALE (non quello desiderabile): i casi
 * che oggi si comportano in modo indesiderato sono marcati `// TODO T2.1` e NON
 * vanno corretti in questo task — T2.1 li sostituirà con tool call strutturate.
 *
 * Esecuzione: npx tsx tests/test_protocol_parsing.ts
 */
import './isolateMemory';
import {
  hasCompletionMarker,
  hasUnanimousApproval,
  parseOrchestratorDecision,
  hasDoneSignal
} from '../src/cli/commands/team';
import { parsePlan, parseAgentLine } from '../src/cli/commands/goal';
import { distinctAgents, aiNameWithRole } from './fixtures/roster';

// Il parser di protocollo va verificato sui RUOLI: quale personaggio li interpreti
// dipende dal catalogo installato, che l'utente può rinominare.
const [WORKER, SECOND, LEAD] = distinctAgents('sysadmin', 'security_auditor', 'supervisor');
const WORKER_AI_NAME = aiNameWithRole('sysadmin');


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

function asst(content: string) {
  return { role: 'assistant', content };
}

async function main() {
  console.log('=== Test Parsing di Protocollo (input sporchi) ===\n');

  // ── hasCompletionMarker ──────────────────────────────────────────────────
  console.log('--- hasCompletionMarker ---');

  check('P1', hasCompletionMarker([asst('Tutto fatto.\nSTATUS: COMPLETED')]), 'marker a inizio riga dopo testo → riconosciuto');

  check(
    'P2',
    hasCompletionMarker([asst('non scriverò mai STATUS: COMPLETED in questa frase')]) === false,
    'marker citato a metà frase (non a inizio riga) → correttamente NON riconosciuto'
  );

  check('P3', hasCompletionMarker([asst('status:    completed')]), 'case-insensitive e spazi extra dopo i due punti → riconosciuto');

  check(
    'P4',
    hasCompletionMarker([{ role: 'tool', content: 'STATUS: COMPLETED', name: 'x' } as any]) === false,
    'marker in un messaggio tool (non assistant) → ignorato correttamente'
  );

  // TODO T2.1: il modello spesso mette il marker in grassetto markdown; ** non è
  // whitespace quindi la regex (^|\n)\s*STATUS non matcha. Fallimento reale e frequente.
  check(
    'P5',
    hasCompletionMarker([asst('**STATUS: COMPLETED**')]) === false,
    '[GAP T2.1] marker avvolto in markdown grassetto NON viene riconosciuto oggi'
  );

  // TODO T2.1: uno spazio prima dei due punti ("STATUS :" invece di "STATUS:") rompe
  // il match perché la regex richiede "STATUS:" letterale senza spazio interno.
  check(
    'P6',
    hasCompletionMarker([asst('STATUS : COMPLETED')]) === false,
    '[GAP T2.1] spazio prima dei due punti NON viene riconosciuto oggi'
  );

  check('P7', hasCompletionMarker([asst('nessun marker qui')]) === false, 'nessun marker presente → false');

  // ── hasUnanimousApproval ─────────────────────────────────────────────────
  console.log('\n--- hasUnanimousApproval ---');

  function vote(v: string) {
    return { role: 'user', content: `VOTE: ${v}` };
  }

  check('P8', hasUnanimousApproval([]) === false, 'nessun voto → false (non unanime per default)');

  check(
    'P9',
    hasUnanimousApproval([vote('APPROVE'), vote('approvo'), vote('APPROVE')]),
    'tutti approvano (case-insensitive) → true'
  );

  check(
    'P10',
    hasUnanimousApproval([vote('APPROVE'), vote('REVISE')]) === false,
    'un solo dissenso rompe l\'unanimità → false'
  );

  check(
    'P11',
    hasUnanimousApproval([{ role: 'assistant', content: 'VOTE: APPROVE' }]) === false,
    'voto in un messaggio non-user (ignorato dal filtro ruolo) → nessun voto valido → false'
  );

  check(
    'P12',
    hasUnanimousApproval([{ role: 'user', content: 'Considerando tutto, il mio VOTE: APPROVE senza riserve' }]),
    'testo libero attorno al marker (nessun ancoraggio a inizio riga qui) → riconosciuto comunque'
  );

  // ── hasDoneSignal ────────────────────────────────────────────────────────
  console.log('\n--- hasDoneSignal ---');

  check('P13', hasDoneSignal('END'), 'END da solo → true');
  check('P14', hasDoneSignal('  END  '), 'END con whitespace attorno (trim esterno) → true');
  check('P15', hasDoneSignal('end.'), 'minuscolo + punteggiatura dopo il word boundary → true');
  check(
    'P16',
    hasDoneSignal('Il piano è END') === false,
    'END a metà riga (non a inizio riga) → correttamente NON riconosciuto'
  );
  check('P17', hasDoneSignal('Ecco il riepilogo:\nEND'), 'END su riga propria dopo testo multilinea → true');

  // ── parseOrchestratorDecision ────────────────────────────────────────────
  console.log('\n--- parseOrchestratorDecision ---');

  check(
    'P18',
    parseOrchestratorDecision(`AGENT: @${WORKER}`, [WORKER])?.agent === WORKER,
    'formato standard "AGENT: @nome" → riconosciuto'
  );

  check(
    'P19',
    parseOrchestratorDecision(`agent:${WORKER}`, [WORKER])?.agent === WORKER,
    'minuscolo e senza spazi/@ → riconosciuto (case-insensitive, @ opzionale)'
  );

  check(
    'P20',
    parseOrchestratorDecision(`**AGENT: @${WORKER}**`, [WORKER])?.agent === WORKER,
    'markdown grassetto attorno al marker → riconosciuto (qui non c\'è ancoraggio a inizio riga)'
  );

  check(
    'P21',
    parseOrchestratorDecision('Scelgo io chi deve continuare il lavoro', [WORKER]) === null,
    'nessun marker "AGENT:" presente → null (fallback a round-robin lato chiamante)'
  );

  // Fallback per aiName: il modello scrive il nome "umano" del personaggio invece
  // del nome tecnico del membro (aiName preso dal catalogo installato, non scritto qui).
  check(
    'P22',
    parseOrchestratorDecision(`AGENT: @${WORKER_AI_NAME}`, [WORKER])?.agent === WORKER,
    `aiName single-word ("${WORKER_AI_NAME}") risolto correttamente al nome tecnico del membro via resolveCharacter`
  );

  // TODO T2.1: la regex cattura solo \w+ dopo @, quindi su un aiName con spazio si
  // ferma alla prima parola e la risoluzione fallisce. Nome sintetico apposta: il
  // gap è del parser, non di un personaggio particolare del catalogo.
  check(
    'P23',
    parseOrchestratorDecision('AGENT: @Nome Composto', ['nome_composto']) === null,
    '[GAP T2.1] aiName multi-parola ("Nome Composto") NON viene risolto oggi: la regex si ferma alla prima parola'
  );

  check(
    'P24',
    parseOrchestratorDecision('AGENT: @sconosciuto', [WORKER]) === null,
    'nome che non corrisponde a nessun membro valido e nessun aiName → null'
  );

  // ── parsePlan / parseAgentLine (goal.ts) ─────────────────────────────────
  console.log('\n--- parsePlan / parseAgentLine ---');

  {
    const r = parsePlan(`AGENT: @${WORKER} — Analizza il server\nEND`, [WORKER]);
    check(
      'P25',
      r.flatSteps === 1 && r.groups.length === 1 && r.groups[0].mode === 'sequential' &&
        r.groups[0].steps[0].task === 'Analizza il server',
      'piano sequenziale semplice, un solo step → parsato correttamente'
    );
  }

  {
    const plan =
      `AGENT: @${SECOND} — Cerca vulnerabilità note\n` +
      'PARALLEL:\n' +
      `AGENT: @${WORKER} — Analizza le policy di sicurezza\n` +
      'AGENT: @pippo — Prepara script di hardening\n' +
      'END PARALLEL\n' +
      `AGENT: @${LEAD} — Revisiona il lavoro\n` +
      'END';
    const r = parsePlan(plan, [SECOND, WORKER, 'pippo', LEAD]);
    const modes = r.groups.map((g) => g.mode);
    check(
      'P26',
      r.flatSteps === 4 && modes.join(',') === 'sequential,parallel,sequential' && r.groups[1].steps.length === 2,
      'piano con blocco PARALLEL ben chiuso → gruppi sequential/parallel/sequential corretti'
    );
  }

  {
    // Task sulla riga successiva (dash finale senza contenuto): accumula fino al prossimo marker.
    const plan = `AGENT: @${WORKER} —\nAnalizza il server\ncontrolla le porte aperte\nEND`;
    const r = parsePlan(plan, [WORKER]);
    check(
      'P27',
      r.groups[0]?.steps[0]?.task === 'Analizza il server controlla le porte aperte',
      'task multilinea (dash a fine riga, contenuto sulle righe successive) → accumulato correttamente'
    );
  }

  {
    // Nome agente non nella lista valida: oggi lo step viene scartato SENZA alcuna
    // segnalazione — esattamente la "degradazione silenziosa" che T2.1 deve rendere visibile.
    const plan = `AGENT: @fantasma — Task inventato\nAGENT: @${WORKER} — Task reale\nEND`;
    const r = parsePlan(plan, [WORKER]);
    check(
      'P28',
      r.flatSteps === 1 && r.groups[0].steps[0].agentName === WORKER,
      '[GAP T2.1] agente non valido scartato silenziosamente, nessun log/warning emesso'
    );
  }

  {
    // Preambolo narrativo del modello prima del piano vero: righe non riconosciute
    // vengono saltate senza errori.
    const plan = `Ecco il mio piano dettagliato per raggiungere l'obiettivo:\n\nAGENT: @${WORKER} — Task\nEND`;
    const r = parsePlan(plan, [WORKER]);
    check('P29', r.flatSteps === 1, 'testo narrativo prima del piano → ignorato, piano comunque estratto');
  }

  {
    // Trattino normale invece di em-dash: la classe [—–-] include anche '-'.
    const r = parseAgentLine([`AGENT: @${WORKER} - Task con trattino ASCII normale`], 0);
    check('P30', r?.name === WORKER && r?.task === 'Task con trattino ASCII normale', 'trattino ASCII "-" al posto dell\'em-dash → riconosciuto');
  }

  {
    // PARALLEL senza chiusura "END PARALLEL": il blocco assorbe tutto il resto,
    // incluso un successivo AGENT sequenziale che avrebbe dovuto essere separato.
    const plan =
      'PARALLEL:\n' +
      `AGENT: @${WORKER} — Task A\n` +
      'AGENT: @pippo — Task B\n' +
      `AGENT: @${LEAD} — Task C (doveva essere sequenziale dopo)\n` +
      'END';
    const r = parsePlan(plan, [WORKER, 'pippo', LEAD]);
    check(
      'P31',
      r.groups.length === 1 && r.groups[0].mode === 'parallel' && r.groups[0].steps.length === 3,
      '[GAP T2.1] PARALLEL senza "END PARALLEL" assorbe anche step successivi pensati come sequenziali'
    );
  }

  check('P32', parsePlan('', [WORKER]).flatSteps === 0, 'contenuto vuoto → nessuno step, nessun crash');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
