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
import {
  hasCompletionMarker,
  hasUnanimousApproval,
  parseOrchestratorDecision,
  hasDoneSignal
} from '../src/cli/commands/team';
import { parsePlan, parseAgentLine } from '../src/cli/commands/goal';

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

  check('P1', hasCompletionMarker([asst('Tutto fatto.\nSTATO: COMPLETATO')]), 'marker a inizio riga dopo testo → riconosciuto');

  check(
    'P2',
    hasCompletionMarker([asst('non scriverò mai STATO: COMPLETATO in questa frase')]) === false,
    'marker citato a metà frase (non a inizio riga) → correttamente NON riconosciuto'
  );

  check('P3', hasCompletionMarker([asst('stato:    completato')]), 'case-insensitive e spazi extra dopo i due punti → riconosciuto');

  check(
    'P4',
    hasCompletionMarker([{ role: 'tool', content: 'STATO: COMPLETATO', name: 'x' } as any]) === false,
    'marker in un messaggio tool (non assistant) → ignorato correttamente'
  );

  // TODO T2.1: il modello spesso mette il marker in grassetto markdown; ** non è
  // whitespace quindi la regex (^|\n)\s*STATO non matcha. Fallimento reale e frequente.
  check(
    'P5',
    hasCompletionMarker([asst('**STATO: COMPLETATO**')]) === false,
    '[GAP T2.1] marker avvolto in markdown grassetto NON viene riconosciuto oggi'
  );

  // TODO T2.1: uno spazio prima dei due punti ("STATO :" invece di "STATO:") rompe
  // il match perché la regex richiede "STATO:" letterale senza spazio interno.
  check(
    'P6',
    hasCompletionMarker([asst('STATO : COMPLETATO')]) === false,
    '[GAP T2.1] spazio prima dei due punti NON viene riconosciuto oggi'
  );

  check('P7', hasCompletionMarker([asst('nessun marker qui')]) === false, 'nessun marker presente → false');

  // ── hasUnanimousApproval ─────────────────────────────────────────────────
  console.log('\n--- hasUnanimousApproval ---');

  function vote(v: string) {
    return { role: 'user', content: `VOTO: ${v}` };
  }

  check('P8', hasUnanimousApproval([]) === false, 'nessun voto → false (non unanime per default)');

  check(
    'P9',
    hasUnanimousApproval([vote('APPROVO'), vote('approvo'), vote('APPROVO')]),
    'tutti approvano (case-insensitive) → true'
  );

  check(
    'P10',
    hasUnanimousApproval([vote('APPROVO'), vote('MODIFICARE')]) === false,
    'un solo dissenso rompe l\'unanimità → false'
  );

  check(
    'P11',
    hasUnanimousApproval([{ role: 'assistant', content: 'VOTO: APPROVO' }]) === false,
    'voto in un messaggio non-user (ignorato dal filtro ruolo) → nessun voto valido → false'
  );

  check(
    'P12',
    hasUnanimousApproval([{ role: 'user', content: 'Considerando tutto, il mio VOTO: APPROVO senza riserve' }]),
    'testo libero attorno al marker (nessun ancoraggio a inizio riga qui) → riconosciuto comunque'
  );

  // ── hasDoneSignal ────────────────────────────────────────────────────────
  console.log('\n--- hasDoneSignal ---');

  check('P13', hasDoneSignal('FINE'), 'FINE da solo → true');
  check('P14', hasDoneSignal('  FINE  '), 'FINE con whitespace attorno (trim esterno) → true');
  check('P15', hasDoneSignal('fine.'), 'minuscolo + punteggiatura dopo il word boundary → true');
  check(
    'P16',
    hasDoneSignal('Il piano è FINE') === false,
    'FINE a metà riga (non a inizio riga) → correttamente NON riconosciuto'
  );
  check('P17', hasDoneSignal('Ecco il riepilogo:\nFINE'), 'FINE su riga propria dopo testo multilinea → true');

  // ── parseOrchestratorDecision ────────────────────────────────────────────
  console.log('\n--- parseOrchestratorDecision ---');

  check(
    'P18',
    parseOrchestratorDecision('AGENTE: @falco', ['falco'])?.agent === 'falco',
    'formato standard "AGENTE: @nome" → riconosciuto'
  );

  check(
    'P19',
    parseOrchestratorDecision('agente:falco', ['falco'])?.agent === 'falco',
    'minuscolo e senza spazi/@ → riconosciuto (case-insensitive, @ opzionale)'
  );

  check(
    'P20',
    parseOrchestratorDecision('**AGENTE: @falco**', ['falco'])?.agent === 'falco',
    'markdown grassetto attorno al marker → riconosciuto (qui non c\'è ancoraggio a inizio riga)'
  );

  check(
    'P21',
    parseOrchestratorDecision('Scelgo io chi deve continuare il lavoro', ['falco']) === null,
    'nessun marker "AGENTE:" presente → null (fallback a round-robin lato chiamante)'
  );

  // Fallback per aiName: il modello scrive il nome "umano" del personaggio invece
  // del nome tecnico del membro. yes_lawyer.json ha aiName "Peppe" (characters/yes_lawyer.json).
  check(
    'P22',
    parseOrchestratorDecision('AGENTE: @Peppe', ['yes_lawyer'])?.agent === 'yes_lawyer',
    'aiName single-word ("Peppe") risolto correttamente al nome tecnico del membro via resolveCharacter'
  );

  // TODO T2.1: cold_steel.json ha aiName "Cold Steel" (due parole). La regex
  // cattura solo \w+ dopo @, quindi si ferma a "Cold" e la risoluzione fallisce:
  // un aiName multi-parola non è mai recuperabile da questo parser.
  check(
    'P23',
    parseOrchestratorDecision('AGENTE: @Cold Steel', ['cold_steel']) === null,
    '[GAP T2.1] aiName multi-parola ("Cold Steel") NON viene risolto oggi: la regex si ferma alla prima parola'
  );

  check(
    'P24',
    parseOrchestratorDecision('AGENTE: @sconosciuto', ['falco']) === null,
    'nome che non corrisponde a nessun membro valido e nessun aiName → null'
  );

  // ── parsePlan / parseAgentLine (goal.ts) ─────────────────────────────────
  console.log('\n--- parsePlan / parseAgentLine ---');

  {
    const r = parsePlan('AGENTE: @falco — Analizza il server\nFINE', ['falco']);
    check(
      'P25',
      r.flatSteps === 1 && r.groups.length === 1 && r.groups[0].mode === 'sequential' &&
        r.groups[0].steps[0].task === 'Analizza il server',
      'piano sequenziale semplice, un solo step → parsato correttamente'
    );
  }

  {
    const plan =
      'AGENTE: @piccione — Cerca vulnerabilità note\n' +
      'PARALLELO:\n' +
      'AGENTE: @falco — Analizza le policy di sicurezza\n' +
      'AGENTE: @pippo — Prepara script di hardening\n' +
      'FINE PARALLELO\n' +
      'AGENTE: @overseer — Revisiona il lavoro\n' +
      'FINE';
    const r = parsePlan(plan, ['piccione', 'falco', 'pippo', 'overseer']);
    const modes = r.groups.map((g) => g.mode);
    check(
      'P26',
      r.flatSteps === 4 && modes.join(',') === 'sequential,parallel,sequential' && r.groups[1].steps.length === 2,
      'piano con blocco PARALLELO ben chiuso → gruppi sequential/parallel/sequential corretti'
    );
  }

  {
    // Task sulla riga successiva (dash finale senza contenuto): accumula fino al prossimo marker.
    const plan = 'AGENTE: @falco —\nAnalizza il server\ncontrolla le porte aperte\nFINE';
    const r = parsePlan(plan, ['falco']);
    check(
      'P27',
      r.groups[0]?.steps[0]?.task === 'Analizza il server controlla le porte aperte',
      'task multilinea (dash a fine riga, contenuto sulle righe successive) → accumulato correttamente'
    );
  }

  {
    // Nome agente non nella lista valida: oggi lo step viene scartato SENZA alcuna
    // segnalazione — esattamente la "degradazione silenziosa" che T2.1 deve rendere visibile.
    const plan = 'AGENTE: @fantasma — Task inventato\nAGENTE: @falco — Task reale\nFINE';
    const r = parsePlan(plan, ['falco']);
    check(
      'P28',
      r.flatSteps === 1 && r.groups[0].steps[0].agentName === 'falco',
      '[GAP T2.1] agente non valido scartato silenziosamente, nessun log/warning emesso'
    );
  }

  {
    // Preambolo narrativo del modello prima del piano vero: righe non riconosciute
    // vengono saltate senza errori.
    const plan = 'Ecco il mio piano dettagliato per raggiungere l\'obiettivo:\n\nAGENTE: @falco — Task\nFINE';
    const r = parsePlan(plan, ['falco']);
    check('P29', r.flatSteps === 1, 'testo narrativo prima del piano → ignorato, piano comunque estratto');
  }

  {
    // Trattino normale invece di em-dash: la classe [—–-] include anche '-'.
    const r = parseAgentLine(['AGENTE: @falco - Task con trattino ASCII normale'], 0);
    check('P30', r?.name === 'falco' && r?.task === 'Task con trattino ASCII normale', 'trattino ASCII "-" al posto dell\'em-dash → riconosciuto');
  }

  {
    // PARALLELO senza chiusura "FINE PARALLELO": il blocco assorbe tutto il resto,
    // incluso un successivo AGENTE sequenziale che avrebbe dovuto essere separato.
    const plan =
      'PARALLELO:\n' +
      'AGENTE: @falco — Task A\n' +
      'AGENTE: @pippo — Task B\n' +
      'AGENTE: @overseer — Task C (doveva essere sequenziale dopo)\n' +
      'FINE';
    const r = parsePlan(plan, ['falco', 'pippo', 'overseer']);
    check(
      'P31',
      r.groups.length === 1 && r.groups[0].mode === 'parallel' && r.groups[0].steps.length === 3,
      '[GAP T2.1] PARALLELO senza "FINE PARALLELO" assorbe anche step successivi pensati come sequenziali'
    );
  }

  check('P32', parsePlan('', ['falco']).flatSteps === 0, 'contenuto vuoto → nessuno step, nessun crash');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
