import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

/**
 * Input principale della REPL basato sul readline nativo di Node:
 * a differenza di `prompts` supporta la history navigabile con frecce su/giù.
 * La history è persistita su file (.tsuka_history) e sopravvive tra sessioni.
 *
 * I menu interattivi (select/multiselect) restano su `prompts`: qui viene
 * creata un'istanza readline per singola domanda, chiusa subito dopo, così
 * i due sistemi non si contendono mai stdin.
 */

const HISTORY_FILE = path.resolve(process.cwd(), '.tsuka_history');
const MAX_HISTORY = 100;

// History in memoria, dal più recente al più vecchio (formato readline)
let history: string[] = loadHistory();

function loadHistory(): string[] {
  try {
    return fs
      .readFileSync(HISTORY_FILE, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(-MAX_HISTORY)
      .reverse();
  } catch {
    return [];
  }
}

function saveHistory(): void {
  try {
    // Su file dal più vecchio al più recente (ordine naturale di lettura)
    fs.writeFileSync(HISTORY_FILE, [...history].reverse().join('\n') + '\n', 'utf-8');
  } catch {
    // History non persistita: non bloccare la REPL per un errore di I/O
  }
}

function addToHistory(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (history[0] === trimmed) return; // niente duplicati consecutivi
  history.unshift(trimmed);
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  saveHistory();
}

/**
 * Pone la domanda e risolve con la riga inserita.
 * Risolve `undefined` su Ctrl+C o Ctrl+D (stessa semantica di `prompts`).
 */
export function askInput(message: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const interactive = !!(process.stdin.isTTY && process.stdout.isTTY);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: interactive,
      history: interactive ? [...history] : undefined,
      historySize: MAX_HISTORY,
      removeHistoryDuplicates: true,
    });

    let settled = false;
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };

    rl.question(chalk.cyan.bold(message) + ' ', (answer) => {
      addToHistory(answer);
      finish(answer);
    });

    rl.on('SIGINT', () => finish(undefined)); // Ctrl+C durante l'input
    rl.on('close', () => finish(undefined));  // Ctrl+D / stdin esaurito
  });
}
