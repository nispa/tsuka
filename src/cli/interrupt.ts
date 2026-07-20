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
      if (key.name === 'escape') {
        this.controller.abort();
      } else if (key.ctrl && key.name === 'c') {
        StatusLine.emergencyReset();
        console.log(chalk.yellow('\nUscita in corso... Arrivederci!'));
        process.exit(130);
      }
    };
    process.stdin.on('keypress', this.keyHandler);
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
