import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';

/**
 * Blackboard di run (T6.2, TASKS.md — FASE 2): stato condiviso di UN SINGOLO run
 * `/team` o `/goal`, non persistente. Confine netto con gli altri due livelli di
 * stato già presenti nel progetto — va rispettato anche nel codice, non solo nella
 * documentazione:
 *  - **history** = ciò che è stato detto (`teamMessages`, cronologia condivisa tra
 *    membri e round);
 *  - **memoria** = ciò che resta fra le sessioni (`MemoryStore`, `memory/memory.json`);
 *  - **blackboard** = stato di QUESTO run — decisioni prese, artefatti prodotti,
 *    punti aperti. Muore col run: non scrive mai in `MemoryStore`, non viene mai
 *    salvata su disco se non come `snapshot()` dentro il workflow log del run che
 *    l'ha prodotta (vedi `workflowLog.ts`).
 *
 * Isolamento fra run concorrenti: stesso problema (e stessa soluzione) già risolto
 * per la workspace jail (`withWorkspaceOverride`, `src/tools/impl/utils.ts`) e per
 * il buffer di log (`src/core/logBuffer.ts`) — il blocco `PARALLELO` di `/goal`
 * esegue branch con `Promise.all` nello stesso processo Node: un singleton o una
 * variabile globale mutabile verrebbero condivisi da tutti i branch di TUTTI i run
 * attivi. Si usa quindi `AsyncLocalStorage`: il `runId` del run corrente viaggia nel
 * contesto asincrono, non in una variabile globale.
 *
 * Nota sulla granularità dell'isolamento: dentro un blocco `PARALLELO` i branch
 * condividono la STESSA blackboard (sono la stessa run, solo eseguita in parallelo
 * per sotto-compiti indipendenti) — è quello che li rende utili come lavagna
 * comune. Sono run DIVERSI (chiamate distinte a `/team` o `/goal`, es. due
 * `handleGoal` lanciate in `Promise.all` come nel test di isolamento) a non doversi
 * vedere a vicenda. Questo perché `Blackboard.withRun` avvolge l'INTERO run (inclusi
 * i branch paralleli annidati, che ereditano il runId dal contesto esterno essendo
 * un'istanza `AsyncLocalStorage` diversa da `workspaceOverride`/`logBufferStorage` —
 * non si pestano i piedi a vicenda), mentre ogni run genera il proprio `runId` unico.
 */

export interface BlackboardNote {
  /** Chiave breve scelta da chi scrive (es. 'decisione-db', 'file-creato'). Non è
   * uno slot univoco: più note con la stessa key restano tutte, in ordine — la
   * blackboard è un registro di note, non una mappa chiave→valore con overwrite. */
  key: string;
  value: string;
  /** Chi ha scritto la nota (es. aiName del personaggio, o 'agente' se non disponibile). */
  author: string;
  timestamp: string; // ISO 8601
}

// Una blackboard per runId, viva finché il run non chiama Blackboard.endRun().
const runs = new Map<string, Blackboard>();

// Il runId attivo nel contesto asincrono corrente: impostato da Blackboard.withRun
// all'inizio di un workflow /team o /goal, letto da Blackboard.current() dentro
// l'esecuzione dei tool post_note/read_notes (src/tools/impl/postNote.ts,
// readNotes.ts). Nessun runId nel contesto (es. chat normale, fuori da un
// workflow) → Blackboard.current() ritorna null: i due tool non sono comunque
// offerti fuori da team/goal (vedi strategies/common.ts), ma il controllo resta
// come rete di sicurezza esplicita — mai una scrittura silenziosa altrove.
const currentRunId = new AsyncLocalStorage<string>();

export class Blackboard {
  readonly runId: string;
  private notes: BlackboardNote[] = [];

  private constructor(runId: string) {
    this.runId = runId;
  }

  /** Genera un runId univoco per un nuovo workflow /team o /goal. */
  static newRunId(): string {
    return crypto.randomUUID();
  }

  /** Ottiene (creandola alla prima richiesta) la blackboard del run indicato. */
  static forRun(runId: string): Blackboard {
    let bb = runs.get(runId);
    if (!bb) {
      bb = new Blackboard(runId);
      runs.set(runId, bb);
    }
    return bb;
  }

  /**
   * Esegue `fn` con `runId` come blackboard attiva per tutta la sua closure
   * asincrona, branch paralleli annidati inclusi (stessa API di
   * `withWorkspaceOverride`). Il run chiamante DEVE liberare la blackboard con
   * `Blackboard.endRun(runId)` a fine esecuzione (tipicamente in un `finally`).
   */
  static withRun<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    return currentRunId.run(runId, fn);
  }

  /** Blackboard del run attivo nel contesto asincrono corrente, se presente
   * (fuori da un `withRun` attivo — es. chat normale — ritorna null). */
  static current(): Blackboard | null {
    const runId = currentRunId.getStore();
    return runId ? Blackboard.forRun(runId) : null;
  }

  /** Libera la blackboard di un run concluso: non deve sopravvivere al run (è lo
   * stato di QUESTO run, non memoria persistente) — evita anche un accumulo senza
   * fine in `runs` in una sessione REPL con molti /team e /goal lanciati in serie. */
  static endRun(runId: string): void {
    runs.delete(runId);
  }

  /** Scrive una nota. Non deduplica per key: post ripetuti sotto la stessa key
   * restano tutti (storico delle note, non un valore che si sovrascrive). */
  post(key: string, value: string, author: string): BlackboardNote {
    const note: BlackboardNote = { key, value, author, timestamp: new Date().toISOString() };
    this.notes.push(note);
    return note;
  }

  /** Note in ordine di scrittura, filtrate per prefisso di key (case-insensitive)
   * se `prefix` è specificato; tutte le note altrimenti. */
  read(prefix?: string): BlackboardNote[] {
    if (!prefix) return this.notes.slice();
    const needle = prefix.toLowerCase();
    return this.notes.filter((n) => n.key.toLowerCase().startsWith(needle));
  }

  /** Tutte le note del run, in ordine di scrittura. */
  list(): BlackboardNote[] {
    return this.notes.slice();
  }

  /** Copia immutabile delle note per l'inclusione nel workflow log (`workflowLog.ts`). */
  snapshot(): BlackboardNote[] {
    return this.notes.map((n) => ({ ...n }));
  }
}
