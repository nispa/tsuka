import * as readline from 'readline';
import chalk from 'chalk';
import { StatusLine } from './statusline';

/**
 * Esc-key generation interrupt controller.
 * Puts stdin in raw mode during generation to capture keypresses immediately.
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

  abort(): void {
    this.controller.abort();
  }

  arm(): void {
    if (!process.stdin.isTTY) return;
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    this.keyHandler = (_str, key) => {
      if (!key) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'x')) {
        this.controller.abort();
      } else if (key.ctrl && key.name === 'c') {
        StatusLine.emergencyReset();
        console.log(chalk.yellow('\nExiting... Goodbye!'));
        process.exit(130);
      }
    };
    process.stdin.on('keypress', this.keyHandler);
  }

  /**
   * Rearms raw mode if another stdin consumer (e.g. prompts) closed or paused it.
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
      process.stdin.pause();
    }
  }
}
