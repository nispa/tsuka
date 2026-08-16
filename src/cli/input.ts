import * as readline from 'readline';
import * as fs from 'fs';
import chalk from 'chalk';
import { homePath } from '../core/apphome';

/**
 * Main REPL input handler based on Node.js native readline.
 * Supports up/down arrow history persistence (.tsuka_history).
 */

const HISTORY_FILE = homePath('.tsuka_history');
const MAX_HISTORY = 100;

export interface CompletionSource {
  commands: string[];
  /** Argument completion options for commands (e.g. '/agent' -> characters). */
  argumentsFor?: (command: string) => string[];
  /** Mention completion options (e.g. '@geordi', '@developer'). */
  mentions?: () => string[];
}

let completionSource: CompletionSource | null = null;

export function setCompletionSource(source: CompletionSource): void {
  completionSource = source;
}

/** Exported for testing. Readline completer tuple: [candidates, matchingSubstring]. */
export function completeLine(line: string): [string[], string] {
  if (!completionSource) return [[], line];

  const parts = line.split(' ');
  const last = parts[parts.length - 1];

  // 1. @mention completion anywhere on the line
  if (last.startsWith('@')) {
    const allMentions = completionSource.mentions?.() ?? [];
    const hits = allMentions.filter((m) => m.toLowerCase().startsWith(last.toLowerCase()));
    return [hits, last];
  }

  // 2. Slash commands completion
  if (line.startsWith('/')) {
    if (parts.length === 1) {
      const hits = completionSource.commands.filter((c) => c.startsWith(line));
      return [hits, line];
    }

    const command = parts[0].toLowerCase();
    const options = completionSource.argumentsFor?.(command) ?? [];
    const hits = options.filter((o) => o.toLowerCase().startsWith(last.toLowerCase()));
    return [hits, last];
  }

  return [[], line];
}

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
    fs.writeFileSync(HISTORY_FILE, [...history].reverse().join('\n') + '\n', 'utf-8');
  } catch {}
}

function addToHistory(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (history[0] === trimmed) return;
  history.unshift(trimmed);
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  saveHistory();
}

/**
 * Prompts user for single-line input. Resolves undefined on Ctrl+C or Ctrl+D.
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

    rl.on('SIGINT', () => finish(undefined));
    rl.on('close', () => finish(undefined));
  });
}
