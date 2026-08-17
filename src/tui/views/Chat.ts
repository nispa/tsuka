/**
 * Chat view for TSUKA TUI.
 * Displays formatted markdown chat history, thinking blocks, and tool executions.
 */

import chalk from 'chalk';
import { TuiState, TuiChatMessage } from '../types';
import { TuiScreen } from '../screen';
import { renderMarkdownToLines } from '../../cli/markdown';

export class ChatView {
  static render(state: TuiState, width: number, height: number): string[] {
    const innerWidth = Math.max(10, width - 4);
    const innerHeight = Math.max(1, height - 2);
    const allLines: string[] = [];

    if (state.messages.length === 0) {
      allLines.push('');
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
        allLines.push(
          '  ' +
          chalk.hex('#3178c6').bold(line.slice(0, 8)) +
          chalk.hex(colors[i]).bold(line.slice(8))
        );
      });
      allLines.push('');
      allLines.push(
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
      allLines.push(
        chalk.gray('  Multi-Agent Harness • ') +
        chalk.hex('#e879f9')('柄 (tsuka): the handle of a katana')
      );
      allLines.push(chalk.hex('#475569')('  ' + '─'.repeat(Math.min(innerWidth, 60))));
      allLines.push('');
      allLines.push(chalk.bold.hex('#fbbf24')('  🚀 Quick Actions & Slash Commands:'));
      allLines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/agent <name>') + chalk.gray('   - Switch character persona'));
      allLines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/team <name>') + chalk.gray('    - Run multi-agent team workflow'));
      allLines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/goal <prompt>') + chalk.gray('  - Autonomous goal decomposition'));
      allLines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/models') + chalk.gray('        - List & switch LLM models'));
      allLines.push(chalk.white('   • ') + chalk.hex('#38bdf8').bold('/tools') + chalk.gray('         - Inspect 27 native tools'));
      allLines.push('');
      allLines.push(chalk.hex('#94a3b8')('  Type your request below and press Enter to start...'));
      allLines.push('');
    } else {
      for (const msg of state.messages) {
        allLines.push(...ChatView.renderMessage(msg, innerWidth, state));
        allLines.push(''); // Spacing between messages
      }

      // If generating, render live in-progress activity card with explicit stop instructions
      if (state.isGenerating) {
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
        allLines.push('  ' + statusCard);
        allLines.push('');
      }
    }

    // Handle scroll offset: by default (offset 0), view is pinned to bottom (newest messages)
    const totalLines = allLines.length;
    let startLine = Math.max(0, totalLines - innerHeight - state.chatScrollOffset);
    if (state.chatScrollOffset >= totalLines - innerHeight) {
      startLine = 0;
    }
    const endLine = Math.min(totalLines, startLine + innerHeight);
    const visibleLines = allLines.slice(startLine, endLine);

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
      { total: totalLines, visible: innerHeight, offset: state.chatScrollOffset }
    );
  }

  /**
   * Identifies which chat message is at a given visual terminal line inside the chat view.
   */
  static getMessageAtRow(state: TuiState, width: number, height: number, clickedRow: number): TuiChatMessage | undefined {
    if (state.messages.length === 0) return undefined;
    const innerWidth = Math.max(10, width - 4);
    const innerHeight = Math.max(1, height - 2);

    const messageLineRanges: Array<{ msg: TuiChatMessage; start: number; end: number }> = [];
    let lineCursor = 0;
    for (const msg of state.messages) {
      const msgLines = ChatView.renderMessage(msg, innerWidth, state);
      const start = lineCursor;
      const end = lineCursor + msgLines.length;
      messageLineRanges.push({ msg, start, end });
      lineCursor = end + 1; // spacing line
    }

    const totalLines = lineCursor > 0 ? lineCursor - 1 : 0;
    let startLine = Math.max(0, totalLines - innerHeight - state.chatScrollOffset);
    if (state.chatScrollOffset >= totalLines - innerHeight) {
      startLine = 0;
    }

    const targetLine = startLine + clickedRow;
    const match = messageLineRanges.find((r) => targetLine >= r.start && targetLine < r.end);
    return match ? match.msg : undefined;
  }

  /**
   * Determines if the clicked row lands specifically on a message's thinking header or thinking block,
   * rather than on regular response text. This preserves standard text selection / copy-pasting.
   */
  static getThinkingHeaderAtRow(state: TuiState, width: number, height: number, clickedRow: number): TuiChatMessage | undefined {
    if (state.messages.length === 0) return undefined;
    const innerWidth = Math.max(10, width - 4);
    const innerHeight = Math.max(1, height - 2);

    const thinkingLineRanges: Array<{ msg: TuiChatMessage; start: number; end: number }> = [];
    let lineCursor = 0;

    for (const msg of state.messages) {
      const msgLines = ChatView.renderMessage(msg, innerWidth, state);
      const msgStart = lineCursor;

      if (msg.thinkingContent && msg.thinkingContent.trim()) {
        const isExpanded = msg.isThinkingExpanded !== undefined ? msg.isThinkingExpanded : !!state.expandAllThinking;
        const thinkStart = msgStart + 1; // 1 line after author header
        let thinkLen = 1;
        if (isExpanded) {
          const rawLines = msg.thinkingContent.trim().split(/\r?\n/);
          thinkLen = 1 + (msg.isStreaming && !msg.content ? Math.min(10, rawLines.length) : rawLines.length) + 1;
        }
        thinkingLineRanges.push({ msg, start: thinkStart, end: thinkStart + thinkLen });
      }

      lineCursor += msgLines.length + 1;
    }

    const totalLines = lineCursor > 0 ? lineCursor - 1 : 0;
    let startLine = Math.max(0, totalLines - innerHeight - state.chatScrollOffset);
    if (state.chatScrollOffset >= totalLines - innerHeight) {
      startLine = 0;
    }

    const targetLine = startLine + clickedRow;
    const match = thinkingLineRanges.find((r) => targetLine >= r.start && targetLine < r.end);
    return match ? match.msg : undefined;
  }

  private static renderMessage(msg: TuiChatMessage, innerWidth: number, state?: TuiState): string[] {
    const lines: string[] = [];
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
        const isExpanded = msg.isThinkingExpanded !== undefined ? msg.isThinkingExpanded : !!state?.expandAllThinking;

        if (msg.isStreaming && !msg.content) {
          // Streaming active thought
          if (isExpanded) {
            const title = `💭 Thinking… (${tokens} tok) ▾`;
            lines.push('  ' + chalk.bold.hex('#c084fc')(`┌─ ${title} `) + chalk.hex('#64748b')('─'.repeat(Math.max(0, contentWidth - title.length - 2))));
            const maxThinkWidth = Math.max(4, contentWidth - 4);
            const rawLines = msg.thinkingContent.trim().split(/\r?\n/);
            for (const r of rawLines.slice(-10)) {
              if (!r.trim()) {
                lines.push('  ' + chalk.hex('#64748b')('│ '));
                continue;
              }
              const words = r.replace(/\t/g, '  ').split(' ');
              let cur = '';
              for (const w of words) {
                if (cur.length + 1 + w.length > maxThinkWidth) {
                  lines.push('  ' + chalk.hex('#64748b')('│ ') + chalk.hex('#cbd5e1').italic(cur));
                  cur = w;
                } else {
                  cur = cur ? cur + ' ' + w : w;
                }
              }
              if (cur) {
                lines.push('  ' + chalk.hex('#64748b')('│ ') + chalk.hex('#cbd5e1').italic(cur));
              }
            }
            lines.push('  ' + chalk.hex('#64748b')('└' + '─'.repeat(Math.max(8, contentWidth + 2))));
          } else {
            const cleanTail = msg.thinkingContent.replace(/\s+/g, ' ').trim().slice(-45);
            lines.push(
              '  ' +
              chalk.hex('#c084fc')('💭 ') +
              chalk.bold.hex('#e879f9')('Thinking… ') +
              chalk.hex('#a855f7')(`(${tokens} tok) `) +
              chalk.gray.italic(`"${cleanTail}"`)
            );
          }
        } else {
          // Completed reasoning
          if (isExpanded) {
            const title = `💭 Chain of Thought (${tokens} tok) ▾ [Click / Ctrl+T]`;
            lines.push('  ' + chalk.bold.hex('#c084fc')(`┌─ ${title} `) + chalk.hex('#64748b')('─'.repeat(Math.max(0, contentWidth - title.length - 2))));
            const maxThinkWidth = Math.max(4, contentWidth - 4);
            const rawLines = msg.thinkingContent.trim().split(/\r?\n/);
            for (const r of rawLines) {
              if (!r.trim()) {
                lines.push('  ' + chalk.hex('#64748b')('│ '));
                continue;
              }
              const words = r.replace(/\t/g, '  ').split(' ');
              let cur = '';
              for (const w of words) {
                if (cur.length + 1 + w.length > maxThinkWidth) {
                  lines.push('  ' + chalk.hex('#64748b')('│ ') + chalk.hex('#cbd5e1').italic(cur));
                  cur = w;
                } else {
                  cur = cur ? cur + ' ' + w : w;
                }
              }
              if (cur) {
                lines.push('  ' + chalk.hex('#64748b')('│ ') + chalk.hex('#cbd5e1').italic(cur));
              }
            }
            lines.push('  ' + chalk.hex('#64748b')('└' + '─'.repeat(Math.max(8, contentWidth + 2))));
          } else {
            lines.push(
              '  ' +
              chalk.hex('#c084fc')('💭 ') +
              chalk.bold.hex('#e879f9')('Thought ') +
              chalk.hex('#a855f7')(`(${tokens} tok) `) +
              chalk.hex('#64748b')('▸ [Click / Ctrl+T]')
            );
          }
        }
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
      lines.push('  ' + chalk.hex('#FFA500')(msg.content));
    } else if (msg.role === 'tool') {
      lines.push(chalk.gray(`  🔧 [tool result] ${msg.content.slice(0, innerWidth)}`));
    }

    return lines;
  }
}
