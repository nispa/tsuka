import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { renderMarkdownToLines } from './markdown';

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
      console.log(
        chalk.hex('#3178c6').bold(line.slice(0, 8)) +
        chalk.hex(colors[i]).bold(line.slice(8))
      );
    });
    console.log();
    console.log(
      chalk.bold('  ' + chalk.hex('#3178c6')('T') + chalk.hex('#e879f9')('S') + chalk.hex('#c084fc')('U') + chalk.hex('#818cf8')('K') + chalk.hex('#38bdf8')('A') + ' ') +
      chalk.cyan.bold('•  TypeScript Unified Kit for Agents')
    );
    console.log(
      chalk.gray('  🤖 Environment:') + chalk.white(' Multi-Agent CLI Harness') +
      chalk.gray('  •  Engines:') + chalk.hex('#a855f7')(' Ollama') + chalk.gray(', ') + chalk.hex('#38bdf8')('OpenRouter') + chalk.gray(', ') + chalk.hex('#2dd4bf')('Unsloth')
    );
    console.log(chalk.gray('  ─'.repeat(Math.ceil(w / 2))));
    console.log(
      chalk.gray('  柄 (') + chalk.hex('#e879f9').bold('tsuka') + chalk.gray('): l\'impugnatura della katana — a cui si attacca la lama.')
    );
    console.log();
  }

  // ── Box generico con titolo ──
  static box(title: string, lines: string[], color: (s: string) => string = chalk.cyan) {
    const w = TTY_WIDTH();
    // Larghezza utile: w meno 2 bordi e 2 spazi di margine per lato
    const inner = w - 6;
    const bar = color('│');
    const top = color('┌') + color('─'.repeat(w - 2)) + color('┐');
    const bot = color('└') + color('─'.repeat(w - 2)) + color('┘');
    const row = (content: string, visualLen: number) =>
      bar + '  ' + content + ' '.repeat(Math.max(0, inner - visualLen)) + '  ' + bar;
    console.log(top);
    console.log(row(chalk.bold(color(title)), CLITheme.cleanLen(title)));
    for (const l of lines) {
      console.log(row(l, CLITheme.cleanLen(l)));
    }
    console.log(bot);
  }

  // ── Pannello agente (risposta) ──
  static agentPanel(agentName: string, body: string) {
    const w = TTY_WIDTH();
    const inner = w - 2;
    const header = chalk.magenta.bold(`╭─ ${agentName} `) +
      chalk.magenta('─'.repeat(Math.max(0, w - agentName.length - 4)));
    console.log(header);

    let renderedLines: string[];
    try {
      renderedLines = renderMarkdownToLines(body, inner);
    } catch {
      renderedLines = CLITheme.wrap(body, inner).map((l) => chalk.white(l));
    }

    if (renderedLines.length === 0) renderedLines = [chalk.white('(nessuna risposta)')];

    for (const ln of renderedLines) {
      console.log(ln);
    }
    console.log(chalk.magenta('╰') + chalk.magenta('─'.repeat(w - 1)));
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
    // Lunghezza visuale: gli emoji/wide char occupano 2 colonne nel terminale.
    let len = 0;
    for (const ch of s.replace(/\x1b\[[0-9;]*m/g, '')) {
      const code = ch.codePointAt(0) || 0;
      // Range emoji e CJK wide (stimato): ≥ U+1F000 o nella fascia wide CJK
      if (code >= 0x1f000 || (code >= 0x2500 && code <= 0x27bf) || (code >= 0x3000 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef)) {
        len += 2;
      } else {
        len += 1;
      }
    }
    return len;
  }

  static success(msg: string) {
    console.log(chalk.green(`✔ ${msg}`));
  }

  static error(msg: string) {
    console.log(chalk.red(`✘ ${msg}`));
  }

  static warning(msg: string) {
    console.log(chalk.yellow(`⚠ ${msg}`));
  }

  static info(msg: string) {
    console.log(chalk.blue(`ℹ ${msg}`));
  }

  static badge(label: string, value: string, color: (s: string) => string = chalk.green) {
    console.log('  ' + chalk.gray('•') + ' ' + chalk.bold(label + ':') + ' ' + color(value));
  }

  static agentThought(agentName: string, thought: string) {
    console.log(
      chalk.magenta.bold(`\n[Pensiero di ${agentName}]: `) +
      chalk.italic.gray(thought)
    );
  }

  static agentAction(agentName: string, action: string) {
    console.log(
      chalk.cyan.bold(`[${agentName}] ➔ `) +
      chalk.white(action)
    );
  }

  static printModelChanged(oldModel: string, newModel: string) {
    console.log(
      chalk.yellow(`\n🔄 Modello cambiato da `) +
      chalk.red(oldModel || 'nessuno') +
      chalk.yellow(` a `) +
      chalk.green(newModel)
    );
  }

  static printDivider() {
    console.log(chalk.gray('─'.repeat(TTY_WIDTH())));
  }

  static help() {
    const w = TTY_WIDTH();
    const top = chalk.cyan('┌') + chalk.cyan('─'.repeat(w - 2)) + chalk.cyan('┐');
    const bot = chalk.cyan('└') + chalk.cyan('─'.repeat(w - 2)) + chalk.cyan('┘');
    console.log(top);
    console.log(chalk.cyan('│ ') + chalk.bold.cyan('Comandi disponibili') + ' '.repeat(Math.max(0, w - 22)) + chalk.cyan('│'));
    const cmds = [
      ['/help', 'Mostra questo messaggio di aiuto'],
      ['/models', 'Elenca i modelli disponibili su Ollama/Provider'],
      ['/use <modello>', 'Seleziona un modello per la chat'],
      ['/benchmark [modello|all]', 'Misura le capacità del modello'],
      ['/provider <ollama|openrouter|unsloth>', 'Cambia il provider attivo'],
      ['/character', 'Seleziona un personaggio preset (menu)'],
      ['/rename-char <nome>', 'Rinomina il personaggio attivo'],
      ['/team', 'Workflow di team a turni (menu)'],
      ['/goal <obiettivo>', 'Orchestrazione dinamica: sceglie agenti e coordina'],
      ['/role', 'Seleziona il ruolo dell\'agente (menu)'],
      ['/trait', 'Seleziona l\'attitudine (menu)'],
      ['/search-engine', 'Seleziona il motore di ricerca'],
      ['/effort [livello|auto|ask]', 'Pin globale del reasoning_effort (sessione)'],
      ['/memory', 'Menu memoria (leggi/recupera/elimina)'],
      ['/forget <id|all>', 'Elimina un ricordo o tutta la memoria'],
      ['/reset', 'Resetta la sessione (cronologia e permessi)'],
      ['/info', 'Mostra modello corrente e server attivo'],
      ['/clear', 'Pulisce lo schermo'],
      ['/exit', 'Esci dall\'applicazione'],
    ];
    const cmdColW = 38;
    for (const [c, d] of cmds) {
      const cleanC = CLITheme.cleanLen(c);
      const cleanD = CLITheme.cleanLen(d);
      const padC = Math.max(0, cmdColW - cleanC);
      const padD = Math.max(0, w - 4 - cmdColW - cleanD);
      const line = chalk.cyan('│ ') + chalk.cyan(c) + ' '.repeat(padC) + chalk.gray(d) + ' '.repeat(padD) + chalk.cyan(' │');
      console.log(line);
    }
    console.log(bot);
    console.log(chalk.gray('  Tab completa comandi e argomenti · ↑/↓ naviga la history · Esc/Ctrl+X interrompe la generazione'));
    console.log();
  }

  static statusPanel(rows: { label: string; value: string; color?: (s: string) => string }[]) {
    const lines = rows.map(r => {
      const col = r.color || chalk.green;
      return r.label + ': ' + col(r.value);
    });
    CLITheme.box('Stato Sessione', lines, chalk.blue);
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
