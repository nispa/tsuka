import * as readline from 'readline';
import * as fs from 'fs';
import chalk from 'chalk';
import { homePath } from '../core/apphome';

/**
 * Input principale della REPL basato sul readline nativo di Node:
 * a differenza di `prompts` supporta la history navigabile con frecce su/giù.
 * La history è persistita su file (.tsuka_history) e sopravvive tra sessioni.
 *
 * I menu interattivi (select/multiselect) restano su `prompts`: qui viene
 * creata un'istanza readline per singola domanda, chiusa subito dopo, così
 * i due sistemi non si contendono mai stdin.
 */

const HISTORY_FILE = homePath('.tsuka_history');
const MAX_HISTORY = 100;

/**
 * Autocompletamento con Tab: comandi slash e, per alcuni comandi, i loro
 * argomenti (es. i nomi dei modelli per /use). La sorgente è registrata
 * dalla REPL all'avvio con setCompletionSource, così questo modulo non
 * dipende dalla mappa dei comandi né dallo stato della sessione.
 */
export interface CompletionSource {
  commands: string[];
  /** Opzioni di completamento per l'argomento di un dato comando (es. '/use' → modelli). */
  argumentsFor?: (command: string) => string[];
}

let completionSource: CompletionSource | null = null;

export function setCompletionSource(source: CompletionSource): void {
  completionSource = source;
}

/** Esportata per i test. Formato readline: [candidati, sottostringa da sostituire]. */
export function completeLine(line: string): [string[], string] {
  if (!completionSource || !line.startsWith('/')) return [[], line];

  const parts = line.split(' ');
  if (parts.length === 1) {
    // Completa il nome del comando
    const hits = completionSource.commands.filter((c) => c.startsWith(line));
    return [hits, line];
  }

  // Completa l'ultima parola come argomento del comando
  const command = parts[0].toLowerCase();
  const last = parts[parts.length - 1];
  const options = completionSource.argumentsFor?.(command) ?? [];
  const hits = options.filter((o) => o.toLowerCase().startsWith(last.toLowerCase()));
  return [hits, last];
}

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
      completer: interactive ? completeLine : undefined,
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
