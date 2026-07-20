import chalk from 'chalk';
import { CLITheme } from './ui';
import { StatusLine } from './statusline';
import { AgentEvent } from '../core/agentEvents';
import { StreamChannel } from '../core/thinkParser';

/**
 * Orchestratore della resa a schermo di una risposta in streaming,
 * condiviso da chat principale, /call e /team.
 *
 * Ciclo di vita:
 *  - begin(): mostra la status line animata "Thinking…"
 *  - onDelta(reasoning): aggiorna solo la status line (contatore + coda dim)
 *  - onDelta(content):   ferma la status line e streamma il testo grezzo live
 *  - onAgentEvent():     ferma lo stream/status per stampare le righe tool
 *                        compatte (● nome(args) / └ esito) e riavvia lo status
 *  - finish():           cancella la zona streammata (ANSI) e la ridipinge
 *                        come pannello markdown definitivo + riga statistiche
 *
 * Strategia: streaming grezzo + repaint finale (niente markdown live: il parse
 * di markdown incompleto è instabile e il repaint oltre il viewport è
 * impossibile senza una vera TUI). Se la risposta supera l'altezza del
 * terminale si cancella solo la parte visibile. Senza TTY si stampa solo il
 * pannello finale.
 */

const isTTY = () => !!process.stdout.isTTY && process.env.TERM !== 'dumb';

export interface StreamRenderOptions {
  headerName: string;
  headerColor?: (s: string) => string;
  /** Se false, niente erase+repaint: lo stream grezzo resta com'è (default true). */
  finalPanel?: boolean;
  /** Mostra la coda del reasoning in dim nella status line (default true). */
  showReasoningTail?: boolean;
}

interface GenStats {
  durationMs: number;
  tokenCount: number;
  tokensPerSecond: number;
}

const ARGS_MAX_LEN = 60;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Riassume gli argomenti di un tool in una riga breve `chiave: valore, …`. */
export function summarizeToolArgs(args: any): string {
  if (args == null) return '';
  if (typeof args === 'string') return truncate(args.replace(/\s+/g, ' ').trim(), ARGS_MAX_LEN);
  try {
    const parts = Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    return truncate(parts.join(', '), ARGS_MAX_LEN);
  } catch {
    return '';
  }
}

/** Riassume il risultato di un tool: riga principale + eventuali righe extra (fonti). */
export function summarizeToolResult(name: string, args: any, output: string, success: boolean): string[] {
  if (!success) {
    const firstLine = (output || '').split('\n')[0].trim();
    return ['✘ ' + truncate(firstLine || 'fallito/rifiutato', 80)];
  }

  if (name === 'web_search') {
    const urlRegex = /\[.*?\]\((https?:\/\/[^\s\)]+)\)/g;
    const urls: string[] = [];
    let match;
    while ((match = urlRegex.exec(output)) !== null) {
      if (!urls.includes(match[1])) urls.push(match[1]);
    }
    if (urls.length > 0) {
      return [`${urls.length} fonti trovate`, ...urls.map((u) => '  • ' + u)];
    }
  }

  if (name === 'browse_url' && args?.url) {
    return ['pagina letta: ' + args.url];
  }

  const lines = (output || '').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return ['completato'];
  if (lines.length === 1) return [truncate(lines[0].trim(), 80)];
  return [`${lines.length} righe di output`];
}

export class StreamRenderer {
  private opts: StreamRenderOptions;
  private status = new StatusLine();
  private tokens = 0;
  private reasoningTail = '';
  private streaming = false;   // segmento di contenuto in corso
  private rowsPrinted = 0;     // righe terminale occupate dal segmento corrente
  private col = 0;             // colonna corrente entro la riga logica
  private segmentText = '';    // contenuto del segmento corrente (dopo l'ultimo tool)
  private fullText = '';       // tutto il contenuto della risposta
  private stats: GenStats | null = null;
  private begun = false;

  constructor(opts: StreamRenderOptions) {
    this.opts = opts;
  }

  begin(): void {
    this.begun = true;
    this.status.start('Thinking…');
  }

  onDelta(text: string, channel: StreamChannel = 'content'): void {
    if (channel === 'reasoning') {
      this.tokens++;
      if (this.opts.showReasoningTail !== false) {
        this.reasoningTail = (this.reasoningTail + text).replace(/\s+/g, ' ').slice(-160);
      }
      this.status.update({ tokens: this.tokens, hint: this.reasoningTail });
      return;
    }

    this.tokens++;
    this.fullText += text;
    this.segmentText += text;

    if (!isTTY()) return; // senza TTY niente stream grezzo: solo pannello finale

    if (!this.streaming) {
      this.status.stop();
      this.streaming = true;
      this.printHeader();
    }
    process.stdout.write(chalk.white(text));
    this.trackText(text);
  }

  onAgentEvent(ev: AgentEvent): void {
    this.status.stop();
    this.endStreamSegment(true);

    switch (ev.type) {
      case 'tool_start': {
        const args = summarizeToolArgs(ev.args);
        console.log(chalk.cyan('●') + ' ' + chalk.bold(ev.name) + chalk.gray(`(${args})`));
        break;
      }
      case 'tool_end': {
        const [head, ...extra] = summarizeToolResult(ev.name, ev.args, ev.output, ev.success);
        const mark = ev.success ? chalk.gray('└ ') + chalk.gray(head) : chalk.gray('└ ') + chalk.red(head);
        console.log('  ' + mark);
        for (const line of extra) {
          console.log('  ' + chalk.gray(line));
        }
        break;
      }
      case 'round_continue': {
        this.tokens = 0;
        this.reasoningTail = '';
        this.status.start('Elaborazione risultati…');
        break;
      }
      case 'max_rounds': {
        CLITheme.warning(`Raggiunto il limite di ${ev.limit} cicli di tool. Interruzione del ciclo agentico.`);
        break;
      }
    }
  }

  setStats(stats: GenStats): void {
    this.stats = stats; // conserva solo l'ultimo round: stampato da finish()
  }

  /** Chiusura normale: sostituisce lo stream grezzo con il pannello markdown. */
  finish(): void {
    this.status.stop();

    const body = (this.segmentText || this.fullText).trim();

    if (this.opts.finalPanel !== false && body) {
      this.eraseSegment();
      CLITheme.agentPanel(this.opts.headerName, body);
    } else {
      this.endStreamSegment(true);
    }

    if (this.stats) {
      const durationSec = (this.stats.durationMs / 1000).toFixed(2);
      console.log(
        chalk.gray(`[Velocità: ${chalk.yellow(this.stats.tokensPerSecond)} tok/s | Totale: ${chalk.cyan(this.stats.tokenCount)} token | Tempo: ${chalk.cyan(durationSec)}s]`)
      );
    }
  }

  /** Chiusura per errore/interruzione: pulisce lo status e lascia lo stream com'è. */
  abort(): void {
    this.status.stop();
    this.endStreamSegment(false);
  }

  getFullText(): string {
    return this.fullText;
  }

  private printHeader(): void {
    const color = this.opts.headerColor || chalk.magenta;
    const header = `${this.opts.headerName} ❯ `;
    process.stdout.write(chalk.bold(color(header)));
    this.trackText(header);
  }

  private resetSegment(): void {
    this.rowsPrinted = 0;
    this.col = 0;
    this.segmentText = '';
  }

  /**
   * Termina il segmento di stream corrente andando a capo e azzerando il
   * tracking. In non-TTY il segmento intermedio non è mai stato stampato:
   * con printPending viene emesso in chiaro (una volta sola).
   */
  private endStreamSegment(printPending: boolean): void {
    if (this.streaming) {
      if (this.col > 0) process.stdout.write('\n');
      this.streaming = false;
    } else if (printPending && !isTTY() && this.segmentText.trim()) {
      console.log(`${this.opts.headerName} ❯ ${this.segmentText.trim()}`);
    }
    this.resetSegment();
  }

  /**
   * Cancella dal terminale il segmento streammato (per il repaint markdown).
   * Modello "deferred wrap": il cursore resta a fine riga finché non arriva
   * un altro carattere, quindi il wrap scatta oltre `cols`, non a `cols`.
   * Se il segmento supera l'altezza del viewport, cancella solo la parte
   * visibile: la parte scrollata resta (limite intrinseco senza TUI).
   */
  private eraseSegment(): void {
    if (isTTY() && this.streaming) {
      const viewportRows = (process.stdout.rows || 24) - 3;
      const up = Math.min(this.rowsPrinted, Math.max(0, viewportRows));
      if (up > 0) {
        process.stdout.write(`\x1b[${up}F\x1b[0J`);
      } else {
        process.stdout.write('\r\x1b[2K\x1b[0J');
      }
      this.streaming = false;
    }
    this.resetSegment();
  }

  /** Aggiorna il conteggio righe/colonna del testo emesso (per l'erase finale). */
  private trackText(text: string): void {
    const cols = process.stdout.columns || 80;
    const segments = text.split('\n');
    for (let i = 0; i < segments.length; i++) {
      if (i > 0) {
        this.rowsPrinted++;
        this.col = 0;
      }
      const w = CLITheme.cleanLen(segments[i]);
      if (w === 0) continue;
      const newCol = this.col + w;
      const wraps = Math.floor(Math.max(0, newCol - 1) / cols);
      this.rowsPrinted += wraps;
      this.col = newCol - wraps * cols;
    }
  }
}

/**
 * Renderer di default per gli eventi agente quando nessun handler è fornito
 * (test, usi programmatici): output minimale su console.
 */
export function defaultAgentEventRenderer(ev: AgentEvent): void {
  switch (ev.type) {
    case 'tool_start':
      console.log(`● ${ev.name}(${summarizeToolArgs(ev.args)})`);
      break;
    case 'tool_end':
      console.log(`  └ ${ev.success ? 'ok' : 'fallito'}`);
      break;
    case 'max_rounds':
      console.log(`[Interruzione: raggiunto il limite di ${ev.limit} cicli di tool]`);
      break;
  }
}
