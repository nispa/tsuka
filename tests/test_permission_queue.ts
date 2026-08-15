/**
 * Test della coda di permessi (T3.1, PLANNING-QUALITA.md).
 *
 * Bug: `PermissionManager` è condiviso tra gli agenti di un blocco PARALLELO di
 * /goal (Promise.all in goal.ts): due richieste RESTRICTED concorrenti facevano
 * partire due `InteractiveMenu.select()` in parallelo, sovrapponendo due prompt
 * sullo stesso stdin. Fix: promise-chain interna a `PermissionManager` — le
 * richieste che generano un prompt (RESTRICTED/DANGEROUS) si accodano, un
 * agente alla volta, nell'ordine di arrivo (vedi `enqueuePrompt` in
 * `src/safety/permissions.ts`).
 *
 * Qui si mocka `InteractiveMenu.select` (il punto in cui PermissionManager
 * delega la scelta per il ramo RESTRICTED) per controllare manualmente quando
 * ogni prompt "si risolve", e si osserva se il secondo viene invocato solo
 * dopo che il primo è stato risolto — senza il fix, `selectCalls` salirebbe a 2
 * ancora prima che il primo prompt sia stato risolto.
 *
 * Esecuzione: npx tsx tests/test_permission_queue.ts
 */
import { PermissionManager } from '../src/safety/permissions';
import { InteractiveMenu } from '../src/cli/ui';

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

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function nextTick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
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
  console.log('=== Test Coda Permessi (T3.1) ===\n');

  const originalSelect = InteractiveMenu.select;

  // T1: due richieste RESTRICTED concorrenti → prompt serializzati (uno alla volta, in ordine)
  {
    let selectCalls = 0;
    const d1 = deferred<string>();
    const d2 = deferred<string>();

    (InteractiveMenu as any).select = async (..._args: any[]) => {
      selectCalls++;
      return selectCalls === 1 ? d1.promise : d2.promise;
    };

    const pm = new PermissionManager();

    const p1 = pm.checkPermission('write_file', 'file A', 'RESTRICTED', 'Falco');
    const p2 = pm.checkPermission('write_file', 'file B', 'RESTRICTED', 'Piccione');

    // Lascia scorrere i microtask: senza la coda, entrambe le chiamate a
    // InteractiveMenu.select partirebbero già ora (selectCalls sarebbe 2).
    await nextTick();
    const callsBeforeFirstResolve = selectCalls;

    d1.resolve('yes'); // risolve il primo prompt
    await nextTick();
    const callsAfterFirstResolve = selectCalls;

    d2.resolve('yes'); // risolve il secondo prompt
    const [r1, r2] = await Promise.all([p1, p2]);

    check('PQ1a', callsBeforeFirstResolve === 1, `solo il primo prompt è partito prima che il primo si risolvesse (select chiamato ${callsBeforeFirstResolve} volta/e, atteso 1)`);
    check('PQ1b', callsAfterFirstResolve === 2, `il secondo prompt parte solo dopo che il primo si è risolto (select chiamato ${callsAfterFirstResolve} volte, atteso 2)`);
    check('PQ1c', r1 === true && r2 === true, `entrambe le richieste approvate (r1=${r1}, r2=${r2})`);

    InteractiveMenu.select = originalSelect;
  }

  // T2: il prompt mostra quale agente sta chiedendo (requesterLabel)
  {
    (InteractiveMenu as any).select = async () => 'yes';
    const pm = new PermissionManager();

    const { logs } = await captureLogs(() => pm.checkPermission('delete_file', 'x.txt', 'RESTRICTED', 'Overseer'));

    check('PQ2', logs.some((l) => l.includes('Overseer')), 'il nome del richiedente compare nel log del prompt RESTRICTED');

    InteractiveMenu.select = originalSelect;
  }

  // T3: nessun cambio per il caso singolo — una sola richiesta RESTRICTED si comporta come prima
  {
    (InteractiveMenu as any).select = async () => 'yes';
    const pm = new PermissionManager();

    const approved = await pm.checkPermission('write_file', 'solo.txt', 'RESTRICTED');
    check('PQ3a', approved === true, 'richiesta singola approvata normalmente (nessun cambio di comportamento)');

    // SAFE non genera prompt e non passa dalla coda: deve risolversi comunque a true
    const safeApproved = await pm.checkPermission('read_file', 'y.txt', 'SAFE');
    check('PQ3b', safeApproved === true, "riskLevel SAFE resta sempre approvato, senza prompt né coda");

    InteractiveMenu.select = originalSelect;
  }

  // T4: "Approva sempre" concesso durante la prima richiesta in coda si applica anche alla seconda
  {
    let selectCalls = 0;
    const d1 = deferred<string>();

    (InteractiveMenu as any).select = async (..._args: any[]) => {
      selectCalls++;
      if (selectCalls === 1) return d1.promise;
      // La seconda richiesta non dovrebbe MAI arrivare a un prompt: 'always' è
      // già stato impostato dalla prima prima che la seconda venga eseguita.
      return 'no';
    };

    const pm = new PermissionManager();
    const p1 = pm.checkPermission('write_file', 'file A', 'RESTRICTED', 'Falco');
    const p2 = pm.checkPermission('write_file', 'file B', 'RESTRICTED', 'Piccione');

    await nextTick();
    d1.resolve('always');

    const [r1, r2] = await Promise.all([p1, p2]);
    check('PQ4a', r1 === true, "prima richiesta approvata con 'always'");
    check('PQ4b', r2 === true, "'always' impostato dalla prima richiesta si applica alla seconda, in coda, senza un secondo prompt");
    check('PQ4c', selectCalls === 1, `solo un prompt mostrato in tutto (select chiamato ${selectCalls} volta/e, atteso 1)`);

    InteractiveMenu.select = originalSelect;
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
