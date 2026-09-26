import { KeyPressEvent } from '../screen';
import { TuiStore } from '../store';
import { TuiState } from '../types';
import { TUI_COMMANDS } from '../commands/registry';
import {
  CompletionContext,
  CompletionItem,
  argumentCompletions,
  filterCompletions,
  mentionCompletions,
} from '../../cli/commands/completion';
import type { CompletionMenuView } from '../layoutEngines/types';

/**
 * Live suggestions for the prompt: slash commands, their arguments (agents, teams,
 * roles, ...) and `@` mentions, from the table shared with the CLI. While suggestions
 * are open ↑/↓ choose, Tab completes with the chosen one and Esc closes them; Enter is
 * never taken over, so a typed line is always sent as typed.
 */

export interface Suggestions {
  /** Where the token being completed starts in the input text. */
  tokenStart: number;
  token: string;
  items: CompletionItem[];
  /** Completing a command name adds a space, ready for its argument. */
  appendSpace: boolean;
}

/** Selection and dismissal apply to one input state: typing anything resets them. */
function inputKey(state: TuiState): string {
  return `${state.inputCursor}\u0000${state.inputText}`;
}

export function computeSuggestions(text: string, cursor: number, ctx: CompletionContext): Suggestions | undefined {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const tokenStart = Math.max(before.lastIndexOf(' ') + 1, before.lastIndexOf('\n') + 1);
  const token = before.slice(tokenStart);
  const tokens = before.trimStart().split(/\s+/);
  const command = tokens[0] ?? '';

  let items: CompletionItem[] = [];
  let appendSpace = false;
  if (token.startsWith('@')) {
    items = mentionCompletions();
  } else if (tokens.length === 1 && command.startsWith('/')) {
    const seen = new Set<string>();
    items = TUI_COMMANDS.flatMap((spec) => [spec.name, ...(spec.aliases ?? [])].map((value) => ({ value, hint: spec.description })))
      .filter((item) => !seen.has(item.value) && seen.add(item.value));
    appendSpace = true;
  } else if (tokens.length === 2 && command.startsWith('/')) {
    items = argumentCompletions(command, ctx);
  }

  const matches = filterCompletions(items, token).sort((a, b) => a.value.localeCompare(b.value));
  // Nothing to offer, or the token already is the one possible completion.
  if (matches.length === 0 || (matches.length === 1 && matches[0].value === token)) return undefined;
  return { tokenStart, token, items: matches, appendSpace };
}

export class CompletionMenu {
  private cachedKey?: string;
  private cached?: Suggestions;

  constructor(private readonly ctx: CompletionContext) {}

  /** Memoized per input state: the candidate lists are read from disk. */
  suggestions(state: TuiState): Suggestions | undefined {
    const key = inputKey(state);
    if (key !== this.cachedKey) {
      this.cachedKey = key;
      this.cached = computeSuggestions(state.inputText, state.inputCursor, this.ctx);
    }
    return this.cached;
  }

  /** What to draw, or undefined when the menu is closed. */
  view(state: TuiState): CompletionMenuView | undefined {
    if (state.focus !== 'input' || state.activeModal) return undefined;
    const suggestions = this.suggestions(state);
    if (!suggestions) return undefined;
    const own = state.completion?.key === inputKey(state) ? state.completion : undefined;
    if (own?.dismissed) return undefined;
    return { items: suggestions.items, index: Math.min(own?.index ?? 0, suggestions.items.length - 1) };
  }

  /** Handles ↑/↓/Tab/Esc while the menu is open; false lets the key through. */
  handleKey(key: KeyPressEvent, state: TuiState, store: TuiStore): boolean {
    const view = this.view(state);
    if (!view || key.ctrl || key.meta) return false;
    const key0 = inputKey(state);
    const count = view.items.length;

    if (key.name === 'up' || key.name === 'down') {
      const index = (view.index + (key.name === 'down' ? 1 : count - 1)) % count;
      store.setState({ completion: { key: key0, index, dismissed: false } });
      return true;
    }
    if (key.name === 'escape') {
      store.setState({ completion: { key: key0, index: view.index, dismissed: true } });
      return true;
    }
    if (key.name === 'tab') {
      const suggestions = this.suggestions(state)!;
      const chosen = view.items[view.index].value + (suggestions.appendSpace ? ' ' : '');
      const cursor = Math.min(state.inputCursor, state.inputText.length);
      const text = state.inputText.slice(0, suggestions.tokenStart) + chosen + state.inputText.slice(cursor);
      store.setInputText(text, suggestions.tokenStart + chosen.length);
      return true;
    }
    return false;
  }
}
