/**
 * Sink di logging iniettabile per core/tools (debito tecnico T-"23 console.*
 * nel core", docs/architecture.md §14-15). `agentEvents.ts` dichiara che il
 * core non deve stampare direttamente — ma molte classi che stampano
 * (`MemoryStore`, `ConfigManager`, `ToolRegistry`, `RunController`, i tool
 * stessi) non girano dentro un `Agent.run()` e non hanno un `AgentEventHandler`
 * a disposizione: instradarle su `AgentEvent` avrebbe richiesto cambiare la
 * firma pubblica di mezza codebase. Questo modulo dà loro un punto di uscita
 * unico e sostituibile, come alternativa più leggera indicata nella stessa nota
 * di debito ("instradarli su AgentEvent o su un sink iniettato").
 *
 * Default: identico al comportamento precedente (stampa su console) — nessuna
 * differenza visibile per chi non fa nulla. Chi vuole intercettare (una UI
 * diversa dalla CLI, un test che vuole silenzio) chiama `setLogSink()` una
 * volta all'avvio. Il default richiama `console.*` non catturato per
 * riferimento ma per lookup a ogni chiamata, quindi resta compatibile con
 * `logBuffer.ts`, che sostituisce temporaneamente `console.log` per bufferizzare
 * l'output dei branch paralleli di `/goal`.
 */

export interface LogSink {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const defaultSink: LogSink = {
  log: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
};

let activeSink: LogSink = defaultSink;

/** Sostituisce il sink attivo (es. per instradare su una UI diversa dalla CLI). */
export function setLogSink(sink: LogSink): void {
  activeSink = sink;
}

/** Ripristina il comportamento di default (stampa su console). Utile nei test. */
export function resetLogSink(): void {
  activeSink = defaultSink;
}

/** Punto di logging da usare al posto di `console.*` in core/tools. */
export const logSink = {
  log: (message: string) => activeSink.log(message),
  warn: (message: string) => activeSink.warn(message),
  error: (message: string) => activeSink.error(message),
};
