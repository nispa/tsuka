import { listAvailableCharacters, listAvailableRoles, listAvailableTeams } from '../core/personas';
import { TUI_COMMANDS } from './commands/registry';

export interface InputCompletion {
  text: string;
  cursor: number;
  candidates: string[];
  changed: boolean;
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (prefix && !value.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

function optionsFor(textBeforeCursor: string, token: string): string[] {
  const tokens = textBeforeCursor.trimStart().split(/\s+/);
  const command = tokens[0]?.toLowerCase() || '';
  if (tokens.length === 1 && command.startsWith('/')) {
    return [...new Set(TUI_COMMANDS.flatMap((spec) => [spec.name, ...(spec.aliases || [])]))];
  }
  if (command === '/team' && tokens.length === 2) {
    return listAvailableTeams().map((team) => team.name);
  }
  if (command === '/call' && token.startsWith('@')) {
    const characters = listAvailableCharacters().map((character) => `@${character.name}`);
    const roles = listAvailableRoles().map((role) => `@${role.name}`);
    return [...new Set([...characters, ...roles])];
  }
  return [];
}

/** Completes only the token at the cursor; callers retain Tab for focus when no candidates exist. */
export function completeTuiInput(text: string, cursor: number): InputCompletion {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const tokenStart = Math.max(before.lastIndexOf(' ') + 1, before.lastIndexOf('\n') + 1);
  const token = before.slice(tokenStart);
  const candidates = optionsFor(before, token)
    .filter((candidate) => candidate.toLowerCase().startsWith(token.toLowerCase()))
    .sort();
  if (candidates.length === 0) return { text, cursor: safeCursor, candidates, changed: false };

  const replacement = candidates.length === 1 ? candidates[0] : commonPrefix(candidates);
  if (replacement.length <= token.length) return { text, cursor: safeCursor, candidates, changed: false };
  const completed = text.slice(0, tokenStart) + replacement + text.slice(safeCursor);
  return { text: completed, cursor: tokenStart + replacement.length, candidates, changed: true };
}
