/**
 * Chat view for TSUKA TUI.
 * Displays formatted markdown chat history, thinking blocks, and tool executions.
 */

import chalk from 'chalk';
import { TuiState, TuiChatMessage } from '../types';
import { TuiScreen } from '../screen';
import { renderMarkdownToLines } from '../../cli/markdown';

/**
 * Lines of a live thought kept on screen while it streams. A running thought is shown
 * open — it is the part worth reading while waiting — but only its tail, so a long chain
 * of reasoning cannot push the rest of the conversation out of the viewport.
 */
const STREAMING_THOUGHT_TAIL_LINES = 12;

/** A thought is live while its message is streaming and no answer text has arrived yet. */
function isLiveThought(msg: TuiChatMessage): boolean {
  return !!msg.isStreaming && !msg.content;
}

/**
 * Expansion state of a thinking block: an explicit choice by the user always wins; a live
 * thought is open by default, so it can be read without clicking; a finished one follows
 * the global toggle (Ctrl+T).
 */
function isThinkingExpanded(msg: TuiChatMessage, state?: TuiState): boolean {
  if (msg.isThinkingExpanded !== undefined) return msg.isThinkingExpanded;
  if (isLiveThought(msg)) return true;
  return !!state?.expandAllThinking;
}

/** Range of lines, end exclusive. */
interface LineRange {
  start: number;
  end: number;
}

/** A rendered message plus where its thinking block sits inside the rendered lines. */
interface MessageLayout {
  lines: string[];
  thinking?: LineRange;
}

/**
 * The chat pane laid out once. Rendering and click hit-testing both read this, so a click
 * can no longer land on a different row than the one drawn.
 */
interface ChatLayout {
  lines: string[];
  /** First visible line, i.e. the scroll position already applied. */
  startLine: number;
  innerHeight: number;
  entries: Array<{ msg: TuiChatMessage; range: LineRange; thinking?: LineRange }>;
}

export class ChatView {
  static render(state: TuiState, width: number, height: number): string[] {
    const { lines, startLine, innerHeight } = ChatView.layout(state, width, height);
    const endLine = Math.min(lines.length, startLine + innerHeight);
    const visibleLines = lines.slice(startLine, endLine);

    let title = 'Conversation';
    if (state.isGenerating) {
      const gen = state.generationStatus;
      const phase = gen?.phase || 'reasoning';
      const agent = gen?.agentName ? `@${gen.agentName}` : `@${state.activeAiName}`;
      if (phase === 'reasoning') title = `Conversation (⚡ THINKING... ${agent})`;
      else if (phase === 'tool') title = `Conversation (🔧 TOOL: ${gen?.toolName || 'tool'} ${agent})`;
      else title = `Conversation (💬 GENERATING... ${agent})`;
    }

    return TuiScreen.drawBox(
      title,
      visibleLines,
      width,
      height,
      state.focus === 'chat',
      undefined,
      { total: lines.length, visible: innerHeight, offset: state.chatScrollOffset }
    );
  }

  /**
   * Builds the pane line by line and records where every message — and every thinking
   * block — ends up. Single source of truth: the hit-testers used to redo this arithmetic
   * on their own and drifted from what was drawn (trailing spacing line, "generating"
   * card, wrapped thought lines), so a click resolved to a different row than the one
   * under the cursor.
   */
  private static layout(state: TuiState, width: number, height: number): ChatLayout {
    const innerWidth = Math.max(10, width - 4);
    const innerHeight = Math.max(1, height - 2);
    const lines: string[] = [];
    const entries: ChatLayout['entries'] = [];

    if (state.messages.length === 0) {
      lines.push(...ChatView.renderWelcome(innerWidth));
    } else {
      for (const msg of state.messages) {
        const start = lines.length;
        const laid = ChatView.layoutMessage(msg, innerWidth, state);
        lines.push(...laid.lines);
        entries.push({
          msg,
          range: { start, end: lines.length },
          thinking: laid.thinking
            ? { start: start + laid.thinking.start, end: start + laid.thinking.end }
            : undefined
        });
        lines.push(''); // Spacing between messages
      }

      // If generating, render live in-progress activity card with explicit stop instructions
      if (state.isGenerating) {
        lines.push(...ChatView.renderGeneratingCard(state));
      }
    }

    // Handle scroll offset: by default (offset 0), view is pinned to bottom (newest messages)
    const totalLines = lines.length;
    let startLine = Math.max(0, totalLines - innerHeight - state.chatScrollOffset);
    if (state.chatScrollOffset >= totalLines - innerHeight) {
      startLine = 0;
    }

    return { lines, startLine, innerHeight, entries };
  }

  /** Splash screen shown while the conversation is still empty. */
  private static renderWelcome(innerWidth: number): string[] {
    const lines: string[] = [];
    lines.push('');
    // Beautiful ASCII gradient logo
    const bannerLines = [
      '████████  ██████  ██    ██  ██    ██    ████  ',
      '   ██    ██       ██    ██  ██   ██    ██  ██ ',
      '   ██     ██████  ██    ██  ██████    ████████',
      '   ██          ██ ██    ██  ██   ██   ██    ██',
      '   ██    ██████    ██████   ██    ██  ██    ██',
    ];
    const colors = ['#e879f9', '#c084fc', '#818cf8', '#38bdf8', '#2dd4bf'];
    bannerLines.forEach((line, i) => {
      lines.push(
        '  ' +
        chalk.hex('#3178c6').bold(line.slice(0, 8)) +
        chalk.hex(colors[i]).bold(line.slice(8))
      );
    });
    lines.push('');
    lines.push(
      '  ' +
      chalk.bold(
        chalk.hex('#3178c6')('T') +
        chalk.hex('#e879f9')('S') +
        chalk.hex('#c084fc')('U') +
        chalk.hex('#818cf8')('K') +
        chalk.hex('#38bdf8')('A') + ' '
      ) +
      chalk.hex('#38bdf8').bold('•  TypeScript Unified Kit for Agents')
    );
    lines.push(
      chalk.gray('  Multi-Agent Harness • ') +
      chalk.hex('#e879f9')('柄 (tsuka): the handle of a katana')
    );
    lines.push(chalk.hex('#475569')('  ' + '─'.repeat(Math.min(innerWidth, 60))));
    lines.push('');
    lines.push(chalk.bold.hex('#fbbf24')('  🚀 Quick Actions & Slash Commands:'));
    lines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/agent <name>') + chalk.gray('   - Switch character persona'));
    lines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/team <name>') + chalk.gray('    - Run multi-agent team workflow'));
    lines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/goal <prompt>') + chalk.gray('  - Autonomous goal decomposition'));
    lines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/models') + chalk.gray('        - List & switch LLM models'));
    lines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/tools') + chalk.gray('         - Inspect 30 native tools'));
    lines.push('');
    lines.push(chalk.hex('#94a3b8')('  Type your request below and press Enter to start...'));
    lines.push('');
    return lines;
  }

  /** Live activity card appended below the feed while a turn is running. */
  private static renderGeneratingCard(state: TuiState): string[] {
    const gen = state.generationStatus;
    const phase = gen?.phase || 'reasoning';
    const agent = gen?.agentName ? `@${gen.agentName}` : `@${state.activeAiName}`;
    let statusCard = '';
    if (phase === 'reasoning') {
      statusCard = chalk.bgHex('#ea580c').white.bold(` ⚡ THINKING... `) + ' ' + chalk.hex('#fdba74')(`${agent} is analyzing and reasoning...`) + ' ' + chalk.gray('(Press Esc or /stop to halt)');
    } else if (phase === 'tool') {
      statusCard = chalk.bgHex('#d97706').white.bold(` 🔧 TOOL EXECUTION `) + ' ' + chalk.hex('#fde047')(`${agent} is executing: ${chalk.bold(gen?.toolName || 'tool')}...`) + ' ' + chalk.gray('(Press Esc or /stop to halt)');
    } else if (phase === 'streaming') {
      statusCard = chalk.bgHex('#0284c7').white.bold(` 💬 WRITING RESPONSE `) + ' ' + chalk.hex('#7dd3fc')(`${agent} is generating response...`) + ' ' + chalk.gray('(Press Esc or /stop to halt)');
    } else {
      statusCard = chalk.bgHex('#7c3aed').white.bold(` ⏳ PROCESSING `) + ' ' + chalk.hex('#c4b5fd')(`${agent} is working...`) + ' ' + chalk.gray('(Press Esc or /stop to halt)');
    }
    return ['  ' + statusCard, ''];
  }

  /**
   * Identifies which chat message is at a given visual terminal line inside the chat view.
   */
  static getMessageAtRow(state: TuiState, width: number, height: number, clickedRow: number): TuiChatMessage | undefined {
    if (state.messages.length === 0) return undefined;
    const { startLine, entries } = ChatView.layout(state, width, height);
    const targetLine = startLine + clickedRow;
    return entries.find((e) => targetLine >= e.range.start && targetLine < e.range.end)?.msg;
  }

  /**
   * Determines if the clicked row lands specifically on a message's thinking header or thinking block,
   * rather than on regular response text. This preserves standard text selection / copy-pasting.
   */
  static getThinkingHeaderAtRow(state: TuiState, width: number, height: number, clickedRow: number): TuiChatMessage | undefined {
    if (state.messages.length === 0) return undefined;
    const { startLine, entries } = ChatView.layout(state, width, height);
    const targetLine = startLine + clickedRow;
    return entries.find((e) => !!e.thinking && targetLine >= e.thinking.start && targetLine < e.thinking.end)?.msg;
  }

  /**
   * Renders an expanded thought inside its box. `tailLines`, when given, keeps only the
   * last N lines: that is the live case, where the text keeps growing under the reader.
   */
  private static renderThoughtBlock(content: string, contentWidth: number, title: string, tailLines?: number): string[] {
    const out: string[] = [];
    out.push('  ' + chalk.bold.hex('#c084fc')(`┌─ ${title} `) + chalk.hex('#64748b')('─'.repeat(Math.max(0, contentWidth - title.length - 2))));

    const maxThinkWidth = Math.max(4, contentWidth - 4);
    const rawLines = content.trim().split(/\r?\n/);
    const shown = tailLines !== undefined ? rawLines.slice(-tailLines) : rawLines;

    for (const r of shown) {
      if (!r.trim()) {
        out.push('  ' + chalk.hex('#64748b')('│ '));
        continue;
      }
      const words = r.replace(/\t/g, '  ').split(' ');
      let cur = '';
      for (const w of words) {
        if (cur.length + 1 + w.length > maxThinkWidth) {
          out.push('  ' + chalk.hex('#64748b')('│ ') + chalk.hex('#cbd5e1').italic(cur));
          cur = w;
        } else {
          cur = cur ? cur + ' ' + w : w;
        }
      }
      if (cur) {
        out.push('  ' + chalk.hex('#64748b')('│ ') + chalk.hex('#cbd5e1').italic(cur));
      }
    }

    out.push('  ' + chalk.hex('#64748b')('└' + '─'.repeat(Math.max(8, contentWidth + 2))));
    return out;
  }

  private static layoutMessage(msg: TuiChatMessage, innerWidth: number, state?: TuiState): MessageLayout {
    const lines: string[] = [];
    let thinking: LineRange | undefined;
    const dateObj = msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp || Date.now());
    const timeStr = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const contentWidth = Math.max(6, innerWidth - 4);

    if (msg.role === 'user') {
      const queueBadge = msg.isQueued
        ? chalk.bold.bgHex('#d97706').hex('#ffffff')(` ⏳ IN QUEUE (#${msg.queuePosition || 1}) `) + ' '
        : '';
      const header = chalk.bold.yellow(`👤 You`) + ' ' + queueBadge + chalk.gray(`[${timeStr}]`);
      lines.push(header);
      const textLines = renderMarkdownToLines(msg.content, contentWidth);
      for (const l of textLines) {
        if (msg.isQueued) {
          lines.push('  ' + chalk.hex('#fef08a')(l));
        } else {
          lines.push('  ' + l);
        }
      }
    } else if (msg.role === 'assistant') {
      const author = msg.authorName ? `${msg.authorName}` : 'Tsuka';
      const header = chalk.bold.cyan(`🤖 ${author}`) + chalk.gray(` [${timeStr}]`);
      lines.push(header);

      // Render thinking block if present
      if (msg.thinkingContent && msg.thinkingContent.trim()) {
        const tokens = msg.thinkingTokens || Math.max(1, Math.round(msg.thinkingContent.length / 3.8));
        const live = isLiveThought(msg);
        const expanded = isThinkingExpanded(msg, state);
        const thinkStart = lines.length;

        if (expanded) {
          const title = live
            ? `💭 Thinking… (${tokens} tok) ▾ [Click / Ctrl+T]`
            : `💭 Chain of Thought (${tokens} tok) ▾ [Click / Ctrl+T]`;
          lines.push(
            ...ChatView.renderThoughtBlock(
              msg.thinkingContent,
              contentWidth,
              title,
              live ? STREAMING_THOUGHT_TAIL_LINES : undefined
            )
          );
        } else if (live) {
          const cleanTail = msg.thinkingContent.replace(/\s+/g, ' ').trim().slice(-45);
          lines.push(
            '  ' +
            chalk.hex('#c084fc')('💭 ') +
            chalk.bold.hex('#e879f9')('Thinking… ') +
            chalk.hex('#a855f7')(`(${tokens} tok) `) +
            chalk.gray.italic(`"${cleanTail}"`)
          );
        } else {
          lines.push(
            '  ' +
            chalk.hex('#c084fc')('💭 ') +
            chalk.bold.hex('#e879f9')('Thought ') +
            chalk.hex('#a855f7')(`(${tokens} tok) `) +
            chalk.hex('#64748b')('▸ [Click / Ctrl+T]')
          );
        }

        thinking = { start: thinkStart, end: lines.length };
      } else if (msg.isStreaming && !msg.content) {
        const effort = state?.activeReasoningEffort;
        if (effort === 'none') {
          lines.push('  ' + chalk.bold.hex('#38bdf8')('⏳ Processing (LLM query / tool execution)...'));
        } else {
          lines.push('  ' + chalk.bold.hex('#e879f9')('💭 Thinking & planning response...'));
        }
      }

      // Render compact single-line tool calls attached to message
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          const statusIcon = tc.status === 'running' ? chalk.yellow('⏳') : tc.status === 'completed' ? chalk.green('✔') : chalk.red('✘');

          let shortArgs = '';
          if (tc.args) {
            try {
              const parsed = typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args;
              const val = parsed.path || parsed.file || parsed.command || parsed.query || parsed.url || (typeof parsed === 'object' ? Object.values(parsed)[0] : parsed);
              if (val !== undefined) {
                const valStr = typeof val === 'string' ? val : JSON.stringify(val);
                shortArgs = chalk.cyan(` (${valStr.length > 28 ? valStr.slice(0, 25) + '…' : valStr})`);
              }
            } catch {
              const trimmed = tc.args.replace(/\s+/g, ' ').trim();
              if (trimmed && trimmed !== '{}') {
                shortArgs = chalk.cyan(` (${trimmed.length > 28 ? trimmed.slice(0, 25) + '…' : trimmed})`);
              }
            }
          }

          let resultSummary = '';
          if (tc.status === 'running') {
            resultSummary = chalk.yellow(' running…');
          } else if (tc.output) {
            const outClean = tc.output.trim().replace(/\r?\n/g, ' ');
            const preview = outClean.length > 35 ? outClean.slice(0, 32) + '…' : outClean;
            resultSummary = chalk.gray(` → ${preview}`);
          }

          lines.push(`  ${statusIcon} ${chalk.bold.magenta(tc.name)}${shortArgs}${resultSummary}`);
        }
      }

      // Render markdown response content
      if (msg.content && msg.content.trim()) {
        const textLines = renderMarkdownToLines(msg.content, contentWidth);
        for (const l of textLines) {
          lines.push('  ' + l);
        }
      }
    } else if (msg.role === 'system') {
      const header = chalk.bold.hex('#FF9F43')(`⚙️ System Notification`) + chalk.gray(` [${timeStr}]`);
      lines.push(header);
      const textLines = renderMarkdownToLines(msg.content || '', contentWidth);
      for (const l of textLines) {
        lines.push('  ' + chalk.hex('#FFA500')(l));
      }
    } else if (msg.role === 'tool') {
      lines.push(chalk.gray(`  🔧 [tool result] ${msg.content.slice(0, innerWidth)}`));
    }

    return { lines, thinking };
  }
}
