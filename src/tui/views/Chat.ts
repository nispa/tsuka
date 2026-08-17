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
        allLines.push(...ChatView.renderMessage(msg, innerWidth));
        allLines.push(''); // Spacing between messages
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

    const title = state.isGenerating ? 'Conversation (Streaming...)' : 'Conversation';
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

  private static renderMessage(msg: TuiChatMessage, innerWidth: number): string[] {
    const lines: string[] = [];
    const timeStr = msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const contentWidth = Math.max(6, innerWidth - 4);

    if (msg.role === 'user') {
      const header = chalk.bold.yellow(`👤 You`) + chalk.gray(` [${timeStr}]`);
      lines.push(header);
      const textLines = renderMarkdownToLines(msg.content, contentWidth);
      for (const l of textLines) {
        lines.push('  ' + l);
      }
    } else if (msg.role === 'assistant') {
      const author = msg.authorName ? `${msg.authorName}` : 'Tsuka';
      const header = chalk.bold.cyan(`🤖 ${author}`) + chalk.gray(` [${timeStr}]`);
      lines.push(header);

      // Render thinking block if present
      if (msg.thinkingContent && msg.thinkingContent.trim()) {
        const title = msg.isStreaming ? '💭 Reasoning / Thinking Stream...' : '💭 Chain of Thought / Reasoning';
        lines.push('  ' + chalk.bold.hex('#c084fc')(`┌─ ${title} `) + chalk.hex('#64748b')('─'.repeat(Math.max(0, contentWidth - title.length - 2))));
        
        const maxThinkWidth = Math.max(4, contentWidth - 4);
        const rawLines = msg.thinkingContent.trim().split(/\r?\n/);
        for (const r of rawLines) {
          if (!r.trim()) {
            lines.push('  ' + chalk.hex('#64748b')('│ '));
            continue;
          }
          // Wrap words to fit inner box
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
      } else if (msg.isStreaming && !msg.content) {
        lines.push('  ' + chalk.bold.hex('#e879f9')('💭 Agent is thinking & planning...'));
      }

      // Render tool calls attached to message
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          const statusIcon = tc.status === 'running' ? chalk.yellow('⏳') : tc.status === 'completed' ? chalk.green('✔') : chalk.red('✘');
          lines.push(`  ${statusIcon} ${chalk.bold.magenta('[tool]')} ${chalk.white(tc.name)}`);
          if (tc.output) {
            const preview = tc.output.slice(0, 100).replace(/\r?\n/g, ' ');
            lines.push(chalk.gray(`     └─ output: ${preview}${tc.output.length > 100 ? '…' : ''}`));
          }
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
