import chalk from 'chalk';
import { CLITheme } from './ui';
import { StatusLine } from './statusline';
import { AgentEvent } from '../core/agentEvents';
import { StreamChannel } from '../core/thinkParser';

/**
 * Screen rendering orchestrator for streaming responses,
 * shared across chat, /call, and /team workflows.
 */

const isTTY = () => !!process.stdout.isTTY && process.env.TERM !== 'dumb';

export interface StreamRenderOptions {
  headerName: string;
  headerColor?: (s: string) => string;
  /** If false, skips erase+repaint (raw stream preserved, default true). */
  finalPanel?: boolean;
  /** Shows reasoning tail in statusline (default true). */
  showReasoningTail?: boolean;
}

interface GenStats {
  durationMs: number;
  tokenCount: number;
  tokensPerSecond: number;
  promptTokens?: number;
  totalTokens?: number;
}

const ARGS_MAX_LEN = 60;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Summarizes tool arguments in a short key: value format. */
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

/** Summarizes tool result: main line and any optional extra source lines. */
export function summarizeToolResult(name: string, args: any, output: string, success: boolean): string[] {
  if (!success) {
    const firstLine = (output || '').split('\n')[0].trim();
    return ['✘ ' + truncate(firstLine || 'failed/rejected', 80)];
  }

  if (name === 'web_search') {
    const urlRegex = /\[.*?\]\((https?:\/\/[^\s\)]+)\)/g;
    const urls: string[] = [];
    let match;
    while ((match = urlRegex.exec(output)) !== null) {
      if (!urls.includes(match[1])) urls.push(match[1]);
    }
    if (urls.length > 0) {
      return [`${urls.length} source(s) found`, ...urls.map((u) => '  • ' + u)];
    }
  }

  if (name === 'browse_url' && args?.url) {
    return ['read page: ' + args.url];
  }

  const lines = (output || '').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return ['completed'];
  if (lines.length === 1) return [truncate(lines[0].trim(), 80)];
  return [`${lines.length} lines output`];
}

export class StreamRenderer {
  private opts: StreamRenderOptions;
  private status = new StatusLine();
  private tokens = 0;
  private reasoningTail = '';
  private streaming = false;
  private rowsPrinted = 0;
  private col = 0;
  private segmentText = '';
  private fullText = '';
  private stats: GenStats | null = null;
  private begun = false;
  private reasoningMode = false;

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
      this.reasoningMode = true;
      if (!this.streaming) {
        this.status.stop();
        this.streaming = true;
        this.printHeader();
      }
      process.stdout.write(chalk.dim(chalk.gray(text)));
      this.trackText(text);
      return;
    }

    if (this.reasoningMode) {
      this.reasoningMode = false;
      process.stdout.write('\n');
      this.trackText('\n');
    }

    this.tokens++;
    this.fullText += text;
    this.segmentText += text;

    if (!isTTY()) return;

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
        const prefix = ev.agentLabel ? chalk.magenta(`[@${ev.agentLabel}] `) : '';
        console.log(prefix + chalk.cyan('●') + ' ' + chalk.bold(ev.name) + chalk.gray(`(${args})`));
        break;
      }
      case 'tool_end': {
        const [head, ...extra] = summarizeToolResult(ev.name, ev.args, ev.output, ev.success);
        const prefix = ev.agentLabel ? chalk.magenta(`[@${ev.agentLabel}] `) : '';
        const mark = ev.success ? chalk.gray('└ ') + chalk.gray(head) : chalk.gray('└ ') + chalk.red(head);
        console.log('  ' + prefix + mark);
        for (const line of extra) {
          console.log('  ' + prefix + chalk.gray(line));
        }
        break;
      }
      case 'round_continue': {
        this.tokens = 0;
        this.reasoningTail = '';
        this.status.start('Processing results…');
        break;
      }
      case 'max_rounds': {
        CLITheme.warning(`Reached maximum limit of ${ev.limit} tool rounds. Stopping agent cycle.`);
        break;
      }
    }
  }

  setStats(stats: GenStats): void {
    this.stats = stats;
  }

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
      const ctx = this.stats.promptTokens ?? 0;
      const total = this.stats.totalTokens ?? (ctx + this.stats.tokenCount);
      console.log(
        chalk.gray(`[Out: ${chalk.cyan(this.stats.tokenCount)} tok | Ctx: ${chalk.cyan(ctx)} tok | Tot: ${chalk.cyan(total)} tok | ${chalk.yellow(this.stats.tokensPerSecond)} tok/s | ${chalk.cyan(durationSec)}s]`)
      );
    }
  }

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

  private endStreamSegment(printPending: boolean): void {
    if (this.streaming) {
      if (this.col > 0) process.stdout.write('\n');
      this.streaming = false;
    } else if (printPending && !isTTY() && this.segmentText.trim()) {
      console.log(`${this.opts.headerName} ❯ ${this.segmentText.trim()}`);
    }
    this.resetSegment();
  }

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

/** Default minimal agent event renderer. */
export function defaultAgentEventRenderer(ev: AgentEvent): void {
  const prefix = ev.agentLabel ? `[@${ev.agentLabel}] ` : '';
  switch (ev.type) {
    case 'tool_start':
      console.log(`${prefix}● ${ev.name}(${summarizeToolArgs(ev.args)})`);
      break;
    case 'tool_end':
      console.log(`  └ ${prefix}${ev.success ? 'ok' : 'failed'}`);
      break;
    case 'max_rounds':
      console.log(`${prefix}[Interrupted: reached limit of ${ev.limit} tool rounds]`);
      break;
  }
}
