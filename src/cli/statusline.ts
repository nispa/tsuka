import chalk from 'chalk';
import { CLITheme } from './ui';

/**
 * Animated status line displayed at the bottom of the terminal during LLM generation:
 * e.g., `◐ Thinking… (2.4s · 87 tok) · reasoning hint`.
 *
 * Implemented manually without external spinner libraries to avoid interleaving conflicts
 * with live streaming output.
 */

const FRAMES = ['◐', '◓', '◑', '◒'];
const FRAME_INTERVAL_MS = 100;

const isTTY = () => !!process.stdout.isTTY && process.env.TERM !== 'dumb';

/** Returns visual tail of a string taking at most maxCols terminal columns. */
function visualTail(s: string, maxCols: number): string {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) {
    const candidate = s[i] + out;
    if (CLITheme.cleanLen(candidate) > maxCols) break;
    out = candidate;
  }
  return out;
}

export class StatusLine {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private startedAt = 0;
  private label = '';
  private tokens = 0;
  private hint = '';

  private static active: StatusLine | null = null;

  start(label: string): void {
    if (!isTTY()) return;
    this.stop();
    this.label = label;
    this.tokens = 0;
    this.hint = '';
    this.frame = 0;
    this.startedAt = Date.now();
    StatusLine.active = this;
    process.stdout.write('\x1b[?25l'); // hide cursor
    this.render();
    this.timer = setInterval(() => this.render(), FRAME_INTERVAL_MS);
  }

  /** Updates displayed fields; redrawn on next frame tick. */
  update(fields: { label?: string; tokens?: number; hint?: string }): void {
    if (fields.label !== undefined) this.label = fields.label;
    if (fields.tokens !== undefined) this.tokens = fields.tokens;
    if (fields.hint !== undefined) this.hint = fields.hint;
  }

  stop(): void {
    const wasActive = this.timer !== null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (StatusLine.active === this) StatusLine.active = null;
    if (wasActive) {
      process.stdout.write('\r\x1b[2K\x1b[?25h'); // clear line and restore cursor
    }
  }

  isActive(): boolean {
    return this.timer !== null;
  }

  /** Emergency terminal reset (SIGINT/exit): clears line and shows cursor. */
  static emergencyReset(): void {
    if (StatusLine.active) {
      StatusLine.active.stop();
    } else if (isTTY()) {
      process.stdout.write('\x1b[?25h');
    }
  }

  private render(): void {
    const cols = process.stdout.columns || 80;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const spinner = chalk.magenta(FRAMES[this.frame++ % FRAMES.length]);
    let line = spinner + ' ' + chalk.gray(`${this.label} (${elapsed}s · ${this.tokens} tok · esc/ctrl+x interrupts)`);

    if (this.hint) {
      const used = CLITheme.cleanLen(line) + 3;
      const room = cols - used - 2;
      if (room > 8) {
        line += chalk.gray(' · ') + chalk.dim(visualTail(this.hint, room));
      }
    }

    process.stdout.write('\r\x1b[2K' + line);
  }
}

process.on('exit', () => {
  if (isTTY()) process.stdout.write('\x1b[?25h');
});
