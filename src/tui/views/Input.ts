/**
 * Input view for TSUKA TUI.
 * Renders the bottom command input box, cursor, status indicators, and slash suggestions.
 */

import chalk from 'chalk';
import { TuiState } from '../types';
import { TuiScreen } from '../screen';

const SLASH_COMMANDS = [
  { cmd: '/agent', desc: 'Switch active Character or Persona' },
  { cmd: '/role', desc: 'Switch active Role' },
  { cmd: '/trait', desc: 'Switch active Trait' },
  { cmd: '/team', desc: 'Run multi-agent Team workflow' },
  { cmd: '/goal', desc: 'Decompose and solve complex goal' },
  { cmd: '/call', desc: 'Start conference debate between agents' },
  { cmd: '/tools', desc: 'Inspect available tools and security tiers' },
  { cmd: '/models', desc: 'List and switch LLM backend models' },
  { cmd: '/provider', desc: 'Configure LLM provider endpoint' },
  { cmd: '/effort', desc: 'Set reasoning effort (low, medium, xhigh, auto)' },
  { cmd: '/memory', desc: 'Query and manage persistent memory facts' },
  { cmd: '/blackboard', desc: 'Inspect current session run notes' },
  { cmd: '/context', desc: 'Show context token breakdown & limits' },
  { cmd: '/benchmark', desc: 'Run capability benchmark fingerprinting' },
  { cmd: '/reset', desc: 'Reset conversation session context' },
  { cmd: '/clear', desc: 'Clear screen messages' },
  { cmd: '/info', desc: 'Show system configuration summary' },
  { cmd: '/exit', desc: 'Exit TSUKA' },
];

export class InputView {
  static render(state: TuiState, width: number, height: number): string[] {
    const lines: string[] = [];
    const innerWidth = Math.max(10, width - 4);

    // Text & cursor
    const { inputText, inputCursor } = state;
    const prefix = chalk.bold.cyan('❯ ');
    
    let renderedInput = '';
    if (state.focus === 'input') {
      const before = inputText.slice(0, inputCursor);
      const under = inputText.slice(inputCursor, inputCursor + 1) || ' ';
      const after = inputText.slice(inputCursor + 1);
      renderedInput = before + chalk.inverse(under) + after;
    } else {
      renderedInput = inputText || chalk.gray('(Press Tab to focus input)');
    }

    const contentLine = prefix + renderedInput;
    lines.push(TuiScreen.truncateOrPad(contentLine, innerWidth));

    // Optional slash command suggestion popover right above or inside
    const isSlash = inputText.startsWith('/') && state.focus === 'input';
    let title = 'Prompt Input';
    if (state.isGenerating) {
      title = 'Prompt Input (⏳ Agent working... Type & Enter to queue | Esc to stop)';
    } else if (isSlash) {
      title = 'Slash Commands';
    }

    const borderColor = state.isGenerating ? (s: string) => chalk.hex('#fbbf24')(s) : undefined;
    return TuiScreen.drawBox(title, lines, width, height, state.focus === 'input', borderColor);
  }

  static getMatchingSlashCommands(text: string): Array<{ cmd: string; desc: string }> {
    if (!text.startsWith('/')) return [];
    const query = text.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.toLowerCase().startsWith(query));
  }
}
