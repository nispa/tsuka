/**
 * Suite di test per il RunController (src/core/loop.ts).
 * Verifica i 4 scenari di accettazione di T6.3:
 * (a) Tentativo 1 fallisce acceptance, tentativo 2 la passa -> 2 iterazioni, outcome success.
 * (b) Acceptance sempre fallita -> stop a maxAttempts, outcome failed.
 * (c) Due tentativi identici -> outcome no_progress prima di maxAttempts.
 * (d) Il testo delle issues del tent. 1 compare nel prompt del tent. 2.
 *
 * Esecuzione: npx tsx tests/test_loop.ts
 */
import { runLoop, calculateAttemptSignature } from '../src/core/loop';
import { Blackboard } from '../src/core/blackboard';

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
  console.log('=== Test T6.3 — RunController ===\n');

  // --- Scenario A: Tentativo 1 fallisce l'acceptance, tentativo 2 la passa ---
  {
    let attemptCount = 0;
    const res = await runLoop({
      task: 'Crea la funzione sum(a, b)',
      maxAttempts: 3,
      executeAttempt: async (_prompt, attemptIndex) => {
        attemptCount++;
        if (attemptIndex === 0) {
          return {
            answer: 'Ho creato la funzione sum ma mancano dei parametri',
            issues: ['La signature della funzione non accetta 2 parametri']
          };
        }
        return {
          answer: 'Ho corretto la funzione sum(a, b)',
          issues: []
        };
      }
    });

    check('T6.3-A-iterations', res.attemptsCount === 2, `Esattamente 2 iterazioni eseguite (ricevute: ${res.attemptsCount})`);
    check('T6.3-A-outcome', res.outcome === 'success', `Esito uguale a 'success' (ricevuto: ${res.outcome})`);
  }

  // --- Scenario B: Acceptance sempre fallita -> stop a maxAttempts ---
  {
    let attemptCount = 0;
    const res = await runLoop({
      task: 'Risolvi il problema X',
      maxAttempts: 3,
      executeAttempt: async (_prompt, attemptIndex) => {
        attemptCount++;
        return {
          answer: `Tentativo ${attemptIndex + 1}: provata soluzione`,
          issues: [`Errore di sintassi ${attemptIndex + 1}`],
          modifiedFiles: [`file_${attemptIndex}.ts`] // firme diverse ad ogni giro
        };
      }
    });

    check('T6.3-B-max-attempts-stop', res.attemptsCount === 3, `Si ferma esattamente a maxAttempts=3 (ricevuti: ${res.attemptsCount})`);
    check('T6.3-B-outcome-failed', res.outcome === 'failed', `Esito finale uguale a 'failed' (ricevuto: ${res.outcome})`);
  }

  // --- Scenario C: Due tentativi identici -> no_progress prima di maxAttempts ---
  {
    let attemptCount = 0;
    const res = await runLoop({
      task: 'Genera il file config',
      maxAttempts: 5,
      executeAttempt: async (_prompt, _attemptIndex) => {
        attemptCount++;
        return {
          answer: 'Risposta identica sia al turno 1 che al turno 2',
          issues: ['Qualche problema visibile'],
          modifiedFiles: ['same_file.ts']
        };
      }
    });

    check('T6.3-C-no-progress-early-stop', res.attemptsCount === 2, `Rileva lo stallo alla 2a iterazione (ricevute: ${res.attemptsCount})`);
    check('T6.3-C-outcome-no-progress', res.outcome === 'no_progress', `Esito uguale a 'no_progress' (ricevuto: ${res.outcome})`);
  }

  // --- Scenario D: Le issues del tentativo 1 compaiono nel prompt del tentativo 2 ---
  {
    let promptTurn2 = '';
    const res = await runLoop({
      task: 'Scrivi un modulo auth.ts',
      maxAttempts: 2,
      executeAttempt: async (prompt, attemptIndex) => {
        if (attemptIndex === 1) {
          promptTurn2 = prompt;
          return { answer: 'auth.ts completato con successo', issues: [] };
        }
        return {
          answer: 'auth.ts prima versione',
          issues: ['Manca il controllo del token JWT nell header Authorization'],
          modifiedFiles: ['auth_v1.ts']
        };
      }
    });

    check(
      'T6.3-D-issues-in-prompt',
      promptTurn2.includes('Manca il controllo del token JWT nell header Authorization'),
      'Le issues del tent. 1 compaiono esplicitamente nel prompt del tent. 2'
    );
    check('T6.3-D-outcome-success', res.outcome === 'success', 'Esito finale success');
  }

  // --- Test di supporto per calculateAttemptSignature ---
  {
    const sig1 = calculateAttemptSignature('Hello world', ['fileA.ts', 'fileB.ts']);
    const sig2 = calculateAttemptSignature('Hello   world\n', ['fileB.ts', 'fileA.ts']);
    check('T6.3-signature-normalization', sig1 === sig2, 'La firma gestisce correttamente spazi e ordine dei file');
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
