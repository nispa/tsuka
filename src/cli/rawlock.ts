/**
 * Blocco del raw mode per l'intera sessione interattiva.
 *
 * Su Windows il passaggio raw→cooked (che readline fa a ogni close, prompts a
 * ogni menu, e l'interrupt a ogni disarm) può lasciare una ReadConsole cooked
 * pendente che libuv non riesce a cancellare: al ritorno in raw mode i tasti
 * finiscono nella lettura-zombie e l'input muore (niente eco, niente Ctrl+C,
 * niente Esc — il sintomo del "terminale bloccato col cursore che lampeggia").
 *
 * Soluzione (stessa strategia di Ink e simili): il raw mode viene acceso una
 * volta all'avvio e i successivi setRawMode(false) dei vari componenti vengono
 * ignorati — readline e prompts funzionano comunque in raw, dato che sono loro
 * stessi ad attivarlo quando servono. La console viene ripristinata (cooked)
 * solo all'uscita del processo, così la shell dell'utente resta pulita.
 *
 * Senza TTY è tutto no-op.
 */
export function lockRawMode(): void {
  if (!process.stdin.isTTY) return;

  const stdin = process.stdin;
  const realSetRawMode = stdin.setRawMode.bind(stdin);

  realSetRawMode(true);

  stdin.setRawMode = ((mode: boolean) => {
    if (mode) {
      // Riasserzione: no-op a livello libuv se il raw mode è già attivo
      realSetRawMode(true);
    }
    // I tentativi di tornare in cooked mode durante la sessione sono ignorati
    return stdin;
  }) as typeof stdin.setRawMode;

  const restore = () => {
    try { realSetRawMode(false); } catch {}
  };
  process.on('exit', restore);
}
