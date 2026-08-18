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
  { cmd: '/stop', desc: 'Stop running agent activity / reasoning / tools' },
  { cmd: '/reset', desc: 'Reset conversation session context' },
  { cmd: '/clear', desc: 'Clear screen messages' },
  { cmd: '/info', desc: 'Show system configuration summary' },
  { cmd: '/exit', desc: 'Exit TSUKA' },
];

export class InputView {
  static render(state: TuiState, width: number, height: number): string[] {
    const lines: string[] = [];
    const innerWidth = Math.max(10, width - 4);
    const innerHeight = Math.max(1, height - 2);

    const { inputText, inputCursor } = state;
    const rawLines = inputText.split(/\r?\n/);
    const isMultiline = rawLines.length > 1;

    if (state.focus === 'input') {
      // Find line and column of cursor
      let runningChars = 0;
      let cursorLine = 0;
      let cursorCol = 0;

      for (let l = 0; l < rawLines.length; l++) {
        const lineLen = rawLines[l].length;
        if (inputCursor <= runningChars + lineLen) {
          cursorLine = l;
          cursorCol = inputCursor - runningChars;
          break;
        }
        runningChars += lineLen + 1; // +1 for the newline
      }

      // Calculate vertical window of lines
      let startLine = 0;
      if (cursorLine >= innerHeight) {
        startLine = cursorLine - innerHeight + 1;
      }
      const endLine = Math.min(rawLines.length, startLine + innerHeight);

      for (let l = startLine; l < endLine; l++) {
        const lineStr = rawLines[l] ?? '';
        const linePrefix = l === 0 ? chalk.bold.cyan('❯ ') : chalk.gray('│ ');

        let renderedLine = '';
        if (l === cursorLine) {
          const before = lineStr.slice(0, cursorCol);
          const under = lineStr.slice(cursorCol, cursorCol + 1) || ' ';
          const after = lineStr.slice(cursorCol + 1);
          renderedLine = before + chalk.inverse(under) + after;
        } else {
          renderedLine = lineStr;
        }

        lines.push(TuiScreen.truncateOrPad(linePrefix + renderedLine, innerWidth));
      }
    } else {
      const displayLines = inputText
        ? rawLines.slice(0, innerHeight).map((l, i) => (i === 0 ? chalk.cyan('❯ ') : chalk.gray('│ ')) + l)
        : [chalk.gray('❯ (Press Tab to focus input)')];
      for (const d of displayLines) {
        lines.push(TuiScreen.truncateOrPad(d, innerWidth));
      }
    }

    // Fill blank lines if fewer than innerHeight
    while (lines.length < innerHeight) {
      lines.push(TuiScreen.truncateOrPad('', innerWidth));
    }

    // Slash command suggestion or active generation title
    const isSlash = inputText.startsWith('/') && state.focus === 'input' && !isMultiline;
    let title = isMultiline ? `Prompt Input (${rawLines.length} lines • Shift+Enter: newline • Enter: send)` : 'Prompt Input';

    if (state.isGenerating) {
      const gen = state.generationStatus;
      const phase = gen?.phase || 'reasoning';
      const agent = gen?.agentName ? `@${gen.agentName}` : `@${state.activeAiName}`;
      if (phase === 'reasoning') {
        title = `Prompt Input (⚡ THINKING... ${agent} | Esc or /stop to halt)`;
      } else if (phase === 'tool') {
        title = `Prompt Input (🔧 TOOL EXECUTION: ${gen?.toolName || 'tool'} ${agent} | Esc or /stop to halt)`;
      } else if (phase === 'streaming') {
        title = `Prompt Input (💬 GENERATING RESPONSE... ${agent} | Esc or /stop to halt)`;
      } else {
        title = `Prompt Input (⏳ PROCESSING... ${agent} | Esc or /stop to halt)`;
      }
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
