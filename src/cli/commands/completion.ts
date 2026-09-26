import {
  listAvailableCharacters,
  listAvailableItems,
  listAvailableRoles,
  listAvailableTeams,
  loadTrait,
} from '../../core/personas';
import { listThinkingTraces } from './continueSession';

/**
 * Argument completion shared by the CLI (readline Tab) and the TUI (suggestion menu).
 * One table, command → candidates: the two interfaces used to keep separate lists and
 * drifted (the TUI could complete `/team` but not `/agent`).
 */

export interface CompletionItem {
  /** Text inserted in place of the token being typed. */
  value: string;
  /** Short explanation shown next to the value in the TUI menu. */
  hint?: string;
  /** Other names the item also answers to while filtering (e.g. a character's aiName). */
  aliases?: string[];
}

/** Runtime lists only the running interface knows. */
export interface CompletionContext {
  models(): string[];
  providers(): string[];
}

function characterItems(prefix = ''): CompletionItem[] {
  return listAvailableCharacters().map((c) => ({
    value: `${prefix}${c.name}`,
    hint: `${c.aiName} — ${(c.roles ?? [c.role]).filter(Boolean).join(', ')}`,
    aliases: [`${prefix}${c.aiName}`],
  }));
}

function roleItems(prefix = ''): CompletionItem[] {
  return listAvailableRoles().map((r) => ({ value: `${prefix}${r.name}`, hint: r.displayName }));
}

/** Characters and roles addressable with `@`, characters first. */
export function mentionCompletions(): CompletionItem[] {
  const seen = new Set<string>();
  return [...characterItems('@'), ...roleItems('@')].filter((item) => !seen.has(item.value) && seen.add(item.value));
}

const fixed = (...values: string[]) => (): CompletionItem[] => values.map((value) => ({ value }));

const ARGUMENTS: Record<string, (ctx: CompletionContext) => CompletionItem[]> = {
  '/agent': () => characterItems(),
  '/team': () => listAvailableTeams().map((t) => ({ value: t.name, hint: `${t.mode ?? 'round-robin'} · ${t.members.join(', ')}` })),
  '/role': () => roleItems(),
  '/trait': () => listAvailableItems('traits', loadTrait).map((t) => ({ value: t.name, hint: t.displayName })),
  '/call': () => mentionCompletions(),
  '/models': (ctx) => ctx.models().map((value) => ({ value })),
  '/benchmark': (ctx) => ctx.models().map((value) => ({ value })),
  '/provider': (ctx) => ctx.providers().map((value) => ({ value })),
  '/continue': () => listThinkingTraces().map((t) => ({ value: t.filename })),
  '/sudo': fixed('on', 'off', 'status'),
  '/memory': fixed('clear'),
  '/effort': fixed('none', 'low', 'medium', 'high', 'xhigh', 'auto', 'ask'),
};

/** Candidates for the argument of `command` (empty when it takes none we can list). */
export function argumentCompletions(command: string, ctx: CompletionContext): CompletionItem[] {
  return ARGUMENTS[command.toLowerCase()]?.(ctx) ?? [];
}

/** Items whose value or alias starts with `token`, case-insensitively. */
export function filterCompletions(items: CompletionItem[], token: string): CompletionItem[] {
  const needle = token.toLowerCase();
  return items.filter((item) => [item.value, ...(item.aliases ?? [])].some((name) => name.toLowerCase().startsWith(needle)));
}
