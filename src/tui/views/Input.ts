/**
 * Input view for TSUKA TUI.
 * Renders the bottom command input box, cursor and status indicators (suggestions: CompletionMenu).
 */

import chalk from 'chalk';
import { TuiState } from '../types';
import { TuiScreen } from '../screen';
import { composingLabel } from './composingLabel';
import { PaneFramer } from '../layoutConfig';
import { PromptRow, cursorRow, promptTextWidth, wrapPrompt } from '../promptWrap';


export class InputView {
  static render(state: TuiState, width: number, height: number, framer?: PaneFramer): string[] {
    const lines: string[] = [];
    const innerWidth = Math.max(10, width - 4);
    const innerHeight = Math.max(1, height - 2);

    const { inputText, inputCursor } = state;
    const rawLines = inputText.split(/\r?\n/);
    const isMultiline = rawLines.length > 1;

    // Soft wrap (promptWrap.ts): a long line continues on the next row instead of running
    // off the pane. Real newlines keep their "│" marker; wrapped continuations are indented.
    const rows = wrapPrompt(inputText, promptTextWidth(width));
    const prefixFor = (row: PromptRow, focused: boolean): string => {
      if (!row.firstOfLine) return '  ';
      if (row.line > 0) return chalk.gray('│ ');
      return focused ? chalk.bold.cyan('❯ ') : chalk.cyan('❯ ');
    };

    if (state.focus === 'input') {
      const cursorAt = cursorRow(rows, inputCursor);
      // Scroll the visible window to keep the cursor row on screen.
      const startRow = cursorAt >= innerHeight ? cursorAt - innerHeight + 1 : 0;
      for (let r = startRow; r < Math.min(rows.length, startRow + innerHeight); r++) {
        const row = rows[r];
        const text = inputText.slice(row.start, row.end);
        let rendered = text;
        if (r === cursorAt) {
          const col = inputCursor - row.start;
          const under = text.slice(col, col + 1) || ' ';
          rendered = text.slice(0, col) + chalk.inverse(under) + text.slice(col + 1);
        }
        lines.push(TuiScreen.truncateOrPad(prefixFor(row, true) + rendered, innerWidth));
      }
    } else if (inputText) {
      for (const row of rows.slice(0, innerHeight)) {
        lines.push(TuiScreen.truncateOrPad(prefixFor(row, false) + inputText.slice(row.start, row.end), innerWidth));
      }
    } else {
      lines.push(TuiScreen.truncateOrPad(chalk.gray('❯ (Press Tab to focus input)'), innerWidth));
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
      const parallel = state.parallelAgents || [];
      if (parallel.length > 1) {
        title = `Prompt Input (⚡ PARALLEL ${parallel.length}: ${parallel.map((name) => `@${name}`).join(' · ')} | Esc or /stop to halt)`;
      } else if (phase === 'reasoning') {
        title = `Prompt Input (⚡ THINKING... ${agent} | Esc or /stop to halt)`;
      } else if (phase === 'composing') {
        title = `Prompt Input (🧩 COMPOSING: ${composingLabel(gen)} ${agent} | Esc or /stop to halt)`;
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
    const frame = framer?.(state.isGenerating ? 'busy' : 'input', state.focus === 'input');
    return TuiScreen.drawBox(title, lines, width, height, state.focus === 'input', borderColor, undefined, frame);
  }
}
