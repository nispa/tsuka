import { AsyncLocalStorage } from 'async_hooks';

/**
 * Buffer dell'output console per branch (T3.2, PLANNING-QUALITA.md): durante un
 * blocco PARALLELO più agenti scrivono con console.log concorrentemente — senza
 * buffering l'output si interfoglia in modo illeggibile. Ogni branch accumula le
 * proprie righe in un buffer isolato (AsyncLocalStorage, non un contatore globale:
 * branch concorrenti nello stesso processo non si mescolano), che viene stampato
 * ("flush") in ordine solo a fine blocco.
 */
const logBufferStorage = new AsyncLocalStorage<string[]>();

/** Esegue `fn` accumulando in `buffer` ogni riga scritta con console.log durante
 * la sua closure asincrona, invece di stamparla subito. Richiede che
 * `installLogBuffering()` sia attivo, altrimenti non ha effetto. */
export function runWithLogBuffer<T>(buffer: string[], fn: () => Promise<T>): Promise<T> {
  return logBufferStorage.run(buffer, fn);
}

/**
 * Sostituisce temporaneamente console.log: se la chiamata avviene dentro un
 * `runWithLogBuffer` attivo, accoda la riga nel buffer del branch corrente
 * invece di stamparla; altrimenti si comporta normalmente (nessun cambio fuori
 * da un blocco parallelo). Ritorna una funzione di ripristino, da chiamare
 * sempre — anche in caso di errore — per non lasciare il patch attivo oltre il
 * blocco parallelo.
 */
export function installLogBuffering(): () => void {
  const original = console.log;
  console.log = (...args: any[]) => {
    const buffer = logBufferStorage.getStore();
    if (buffer) {
      buffer.push(args.map((a) => String(a)).join(' '));
    } else {
      original(...args);
    }
  };
  return () => { console.log = original; };
}

/** Stampa (con l'attuale console.log) tutte le righe di un buffer, in ordine. */
export function flushLogBuffer(buffer: string[]): void {
  for (const line of buffer) {
    console.log(line);
  }
}
