import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { renderMarkdownToLines } from './markdown';
import { logSink } from '../core/logSink';

const TTY_WIDTH = () => Math.min(process.stdout.columns || 80, 100);

export class CLITheme {
  static banner() {
    console.clear();
    const w = TTY_WIDTH();
    const big = [
      '████████  ██████  ██    ██  ██    ██    ████  ',
      '   ██    ██       ██    ██  ██   ██    ██  ██ ',
      '   ██     ██████  ██    ██  ██████    ████████',
      '   ██          ██ ██    ██  ██   ██   ██    ██',
      '   ██    ██████    ██████   ██    ██  ██    ██',
    ];
    const colors = ['#e879f9', '#c084fc', '#818cf8', '#38bdf8', '#2dd4bf'];
    big.forEach((line, i) => {
      logSink.log(
        chalk.hex('#3178c6').bold(line.slice(0, 8)) +
        chalk.hex(colors[i]).bold(line.slice(8))
      );
    });
    logSink.log('');
    logSink.log(
      chalk.bold('  ' + chalk.hex('#3178c6')('T') + chalk.hex('#e879f9')('S') + chalk.hex('#c084fc')('U') + chalk.hex('#818cf8')('K') + chalk.hex('#38bdf8')('A') + ' ') +
      chalk.cyan.bold('•  TypeScript Unified Kit for Agents')
    );
    logSink.log(
      chalk.gray('  🤖 Environment:') + chalk.white(' Multi-Agent CLI Harness') +
      chalk.gray('  •  Engines:') + chalk.hex('#a855f7')(' Ollama') + chalk.gray(', ') + chalk.hex('#38bdf8')('OpenRouter') + chalk.gray(', ') + chalk.hex('#2dd4bf')('Unsloth')
    );
    logSink.log(chalk.gray('  ─'.repeat(Math.ceil(w / 2))));
    logSink.log(
      chalk.gray('  柄 (') + chalk.hex('#e879f9').bold('tsuka') + chalk.gray('): the handle of a katana — where the blade attaches.')
    );
    logSink.log('');
  }

  // Generic box container with title
  static box(title: string, lines: string[], color: (s: string) => string = chalk.cyan) {
    const w = TTY_WIDTH();
    const inner = w - 6;
    const bar = color('│');
    const top = color('┌') + color('─'.repeat(w - 2)) + color('┐');
    const bot = color('└') + color('─'.repeat(w - 2)) + color('┘');
    const row = (content: string, visualLen: number) =>
      bar + '  ' + content + ' '.repeat(Math.max(0, inner - visualLen)) + '  ' + bar;
    logSink.log(top);
    logSink.log(row(chalk.bold(color(title)), CLITheme.cleanLen(title)));
    for (const l of lines) {
      logSink.log(row(l, CLITheme.cleanLen(l)));
    }
    logSink.log(bot);
  }

  // Agent response panel
  static agentPanel(agentName: string, body: string) {
    const w = TTY_WIDTH();
    const inner = w - 2;
    const header = chalk.magenta.bold(`╭─ ${agentName} `) +
      chalk.magenta('─'.repeat(Math.max(0, w - agentName.length - 4)));
    logSink.log(header);

    let renderedLines: string[];
    try {
      renderedLines = renderMarkdownToLines(body, inner);
    } catch {
      renderedLines = CLITheme.wrap(body, inner).map((l) => chalk.white(l));
    }

    if (renderedLines.length === 0) renderedLines = [chalk.white('(no response)')];

    for (const ln of renderedLines) {
      logSink.log(ln);
    }
    logSink.log(chalk.magenta('╰') + chalk.magenta('─'.repeat(w - 1)));
  }

  static wrap(text: string, width: number): string[] {
    const words = text.split(' ');
    const out: string[] = [];
    let cur = '';
    for (const word of words) {
      if (CLITheme.cleanLen(cur + ' ' + word) > width && cur) {
        out.push(cur);
        cur = word;
      } else {
        cur = cur ? cur + ' ' + word : word;
      }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }

  static cleanLen(s: string): number {
    let len = 0;
    for (const ch of s.replace(/\x1b\[[0-9;]*m/g, '')) {
      const code = ch.codePointAt(0) || 0;
      if ((code >= 0xfe00 && code <= 0xfe0f) || code === 0x200d || code === 0x200b || code === 0x200c) {
        continue;
      }
      if (code >= 0x1f000 || (code >= 0x2500 && code <= 0x27bf) || (code >= 0x3000 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)) {
        len += 2;
      } else {
        len += 1;
      }
    }
    return len;
  }

  static success(msg: string) {
    logSink.log(chalk.green(`✔ ${msg}`));
  }

  static error(msg: string) {
    logSink.log(chalk.red(`✘ ${msg}`));
  }

  static warning(msg: string) {
    logSink.log(chalk.yellow(`⚠ ${msg}`));
  }

  static info(msg: string) {
    logSink.log(chalk.blue(`ℹ ${msg}`));
  }

  static badge(label: string, value: string, color: (s: string) => string = chalk.green) {
    logSink.log('  ' + chalk.gray('•') + ' ' + chalk.bold(label + ':') + ' ' + color(value));
  }

  /** Context window usage bar */
  static contextBar(used: number, total: number, label: string, suffix: string = ''): void {
    const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    const barW = 24;
    const filled = Math.round((pct / 100) * barW);
    const empty = barW - filled;
    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    const color = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
    const suffixStr = suffix ? ` ${suffix}` : '';
    logSink.log(`  ${chalk.gray(label)} ${bar} ${color(`${pct}%`)} ${chalk.gray(`(~${used.toLocaleString()} / ${total.toLocaleString()} tok)`)}${suffixStr}`);
  }

  static agentThought(agentName: string, thought: string) {
    logSink.log(
      chalk.magenta.bold(`\n[Thought from ${agentName}]: `) +
      chalk.italic.gray(thought)
    );
  }

  static agentAction(agentName: string, action: string) {
    logSink.log(
      chalk.cyan.bold(`[${agentName}] ➔ `) +
      chalk.white(action)
    );
  }

  static printModelChanged(oldModel: string, newModel: string) {
    logSink.log(
      chalk.yellow(`\n🔄 Model changed from `) +
      chalk.red(oldModel || 'none') +
      chalk.yellow(` to `) +
      chalk.green(newModel)
    );
  }

  static printDivider() {
    logSink.log(chalk.gray('─'.repeat(TTY_WIDTH())));
  }

  static help() {
    const w = TTY_WIDTH();
    const top = chalk.cyan('┌') + chalk.cyan('─'.repeat(w - 2)) + chalk.cyan('┐');
    const bot = chalk.cyan('└') + chalk.cyan('─'.repeat(w - 2)) + chalk.cyan('┘');
    logSink.log(top);
    const headTitle = 'Available commands';
    const headPad = Math.max(0, w - 4 - CLITheme.cleanLen(headTitle));
    logSink.log(chalk.cyan('│ ') + chalk.bold.cyan(headTitle) + ' '.repeat(headPad) + chalk.cyan(' │'));

    type HelpEntry = { section: string } | [string, string];
    const items: HelpEntry[] = [
      { section: '🚀 Execution & Multi-Agent' },
      ['/goal <goal>', 'Dynamic orchestration: decomposes and executes task'],
      ['/team [name]', 'Runs predefined multi-agent team or pipeline'],
      ['/call [@agents...]', 'Multi-agent conference / brainstorming call'],

      { section: '🧠 Model & Inference' },
      ['/models [name]', 'Lists available models or switches active model'],
      ['/provider [name]', 'Changes LLM provider (Ollama, Unsloth, OpenRouter)'],
      ['/effort [level|auto|ask]', 'Adjusts reasoning effort (none/low/med/xhigh)'],
      ['/benchmark [model|all]', 'Benchmarks model tier and speed (tok/s)'],

      { section: '🛠️  Agent & Tools' },
      ['/agent [name]', 'Selects or inspects active character/role'],
      ['/tools', 'Lists enabled tools per role, tier, and effort'],

      { section: '📊 Memory & History' },
      ['/context', 'Context window usage, tokens, and activity history'],
      ['/memory [clear|<id>]', 'Persistent shared memory store'],
      ['/blackboard', 'Workflow notes and blackboard state'],
      ['/runs', 'Workflow execution history and reports'],
      ['/continue [trace]', 'Resumes interrupted reasoning trace'],

      { section: '⚙️  Session' },
      ['/info', 'Displays active session configuration and server status'],
      ['/reset', 'Resets history, context, and permissions'],
      ['/clear · /exit', 'Clears screen · Exits REPL'],
    ];

    const cmdColW = 34;
    for (const item of items) {
      if ('section' in item) {
        const cleanSec = CLITheme.cleanLen(item.section);
        const padRight = Math.max(0, w - 4 - cleanSec);
        logSink.log(chalk.cyan('│ ') + chalk.bold.yellow(item.section) + chalk.gray(' ' + '─'.repeat(padRight)) + chalk.cyan('│'));
      } else {
        const [c, d] = item;
        const cleanC = CLITheme.cleanLen(c);
        const cleanD = CLITheme.cleanLen(d);
        const padC = Math.max(0, cmdColW - cleanC);
        const padD = Math.max(0, w - 4 - cmdColW - cleanD);
        const line = chalk.cyan('│ ') + chalk.cyan(c) + ' '.repeat(padC) + chalk.gray(d) + ' '.repeat(padD) + chalk.cyan(' │');
        logSink.log(line);
      }
    }
    logSink.log(bot);
    logSink.log(chalk.gray('  Tab completes commands & args · ↑/↓ navigates history · Esc interrupts generation'));
    logSink.log('');
  }

  static statusPanel(rows: { label: string; value: string; color?: (s: string) => string }[]) {
    const lines = rows.map(r => {
      const col = r.color || chalk.green;
      return r.label + ': ' + col(r.value);
    });
    CLITheme.box('Session Status', lines, chalk.blue);
  }

  static createSpinner(text: string) {
    return ora({
      text: chalk.cyan(text),
      color: 'cyan',
      spinner: 'dots'
    });
  }
}

export class InteractiveMenu {
  static async select<T>(
    message: string,
    items: Array<{ title: string; value: T; description?: string }>,
    initialValue?: T
  ): Promise<T | null> {
    let initialIndex = 0;
    if (initialValue !== undefined) {
      const idx = items.findIndex((item) => item.value === initialValue);
      if (idx !== -1) initialIndex = idx;
    }

    const response = await prompts({
      type: 'select',
      name: 'result',
      message: chalk.cyan.bold(message),
      choices: items.map((item) => ({
        title: item.title,
        value: item.value,
        description: item.description
      })),
      initial: initialIndex
    });

    return response.result !== undefined ? response.result : null;
  }
}
