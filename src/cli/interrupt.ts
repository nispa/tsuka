import * as readline from 'readline';
import chalk from 'chalk';
import { StatusLine } from './statusline';

/**
 * Interruzione della generazione con Esc, stile Claude Code.
 *
 * Mentre il modello genera, stdin viene messo in raw mode per intercettare
 * i tasti senza Enter: Esc abortisce la richiesta in corso (AbortController →
 * l'SDK OpenAI annulla il fetch, efficace anche su server bloccato), Ctrl+C
 * esce dall'applicazione (in raw mode il SIGINT non viene generato dal
 * terminale, quindi va emulato qui).
 *
 * Un'istanza per richiesta: arm() prima di lanciare l'agente, disarm() in
 * finally. Senza TTY tutte le operazioni sono no-op.
 */
export class GenerationInterrupt {
  private controller = new AbortController();
  private keyHandler: ((str: string, key: any) => void) | null = null;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  arm(): void {
    if (!process.stdin.isTTY) return;
    readline.emitKeypressEvents(process.stdin); // idempotente
    process.stdin.setRawMode(true);
    process.stdin.resume();

    this.keyHandler = (_str, key) => {
      if (!key) return;
      // Ctrl+X come alternativa a Esc: è un byte singolo, quindi scatta subito
      // (Esc è il prefisso delle sequenze escape e il parser lo emette con
      // ~500ms di ritardo per distinguerlo da frecce e altri tasti speciali)
      if (key.name === 'escape' || (key.ctrl && key.name === 'x')) {
        this.controller.abort();
      } else if (key.ctrl && key.name === 'c') {
        StatusLine.emergencyReset();
        console.log(chalk.yellow('\nUscita in corso... Arrivederci!'));
        process.exit(130);
      }
    };
    process.stdin.on('keypress', this.keyHandler);
  }

  /**
   * Riattiva l'intercettazione dei tasti se un altro consumatore di stdin l'ha
   * disattivata: i prompt di autorizzazione dei tool (`prompts`) alla chiusura
   * fanno setRawMode(false) + pause, lasciando il listener di Esc sordo per il
   * resto della generazione. Da chiamare a ogni evento dell'agente: idempotente
   * e a costo nullo quando il raw mode è già attivo.
   */
  rearm(): void {
    if (!this.keyHandler || !process.stdin.isTTY) return;
    if (!process.stdin.isRaw) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
  }

  disarm(): void {
    if (this.keyHandler) {
      process.stdin.off('keypress', this.keyHandler);
      this.keyHandler = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause(); // il prossimo readline/prompts lo riattiva
    }
  }
}
