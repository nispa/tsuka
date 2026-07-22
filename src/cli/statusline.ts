import chalk from 'chalk';
import { CLITheme } from './ui';

/**
 * Riga di stato animata a fondo output durante la generazione del modello,
 * in stile Claude Code: `◐ Thinking… (2.4s · 87 tok) · coda del reasoning`.
 *
 * Implementata a mano (non con ora): l'interval interno di ora confligge con
 * le write manuali interleaved dello streaming. La riga si ridisegna con
 * `\r + clear-line` e non va mai a capo (troncata alla larghezza del terminale),
 * così un singolo clear la rimuove sempre in modo pulito.
 *
 * In assenza di TTY (output redirezionato) tutte le operazioni sono no-op.
 */

const FRAMES = ['◐', '◓', '◑', '◒'];
const FRAME_INTERVAL_MS = 100;

const isTTY = () => !!process.stdout.isTTY && process.env.TERM !== 'dumb';

/** Coda visuale di una stringa che occupa al massimo maxCols colonne. */
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
    process.stdout.write('\x1b[?25l'); // nasconde il cursore
    this.render();
    this.timer = setInterval(() => this.render(), FRAME_INTERVAL_MS);
  }

  /** Aggiorna i campi mostrati; il ridisegno avviene al prossimo frame dell'interval. */
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
      process.stdout.write('\r\x1b[2K\x1b[?25h'); // pulisce la riga e ripristina il cursore
    }
  }

  isActive(): boolean {
    return this.timer !== null;
  }

  /** Ripristino d'emergenza del terminale (SIGINT/exit): pulisce la riga e mostra il cursore. */
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
    let line = spinner + ' ' + chalk.gray(`${this.label} (${elapsed}s · ${this.tokens} tok · esc/ctrl+x interrompe)`);

    if (this.hint) {
      const used = CLITheme.cleanLen(line) + 3; // ' · ' di separazione
      const room = cols - used - 2;
      if (room > 8) {
        line += chalk.gray(' · ') + chalk.dim(visualTail(this.hint, room));
      }
    }

    process.stdout.write('\r\x1b[2K' + line);
  }
}

// Garanzia finale: il cursore torna visibile anche su uscite impreviste
process.on('exit', () => {
  if (isTTY()) process.stdout.write('\x1b[?25h');
});
