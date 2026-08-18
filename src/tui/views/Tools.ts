/**
 * Tools view for TSUKA TUI.
 * Displays real-time tool execution stream, arguments, outcomes and risk levels.
 */

import chalk from 'chalk';
import { TuiState } from '../types';
import { TuiScreen } from '../screen';

export class ToolsView {
  static render(state: TuiState, width: number, height: number): string[] {
    const rawLines: string[] = [];
    const innerWidth = Math.max(10, width - 4);
    const innerHeight = Math.max(1, height - 2);

    const query = (state.toolsFilter || '').toLowerCase().trim();

    // Top Filter Bar
    if (state.toolsFilter !== undefined && state.toolsFilter !== '') {
      rawLines.push(chalk.bold.hex('#38bdf8')('🔍 Filter: ') + chalk.white(`"${state.toolsFilter}"`) + chalk.gray(' (Type to refine, Backspace to delete, Esc to clear)'));
      rawLines.push(chalk.gray('─'.repeat(Math.min(innerWidth, 45))));
    } else {
      rawLines.push(chalk.gray('  Press / or type letters to search tools & executions • Esc to clear'));
      rawLines.push(chalk.gray('─'.repeat(Math.min(innerWidth, 45))));
    }

    const filteredTools = query
      ? state.activeTools.filter((t) =>
          t.name.toLowerCase().includes(query) ||
          (t.riskLevel && t.riskLevel.toLowerCase().includes(query)) ||
          (t.status && t.status.toLowerCase().includes(query)) ||
          (t.args && t.args.toLowerCase().includes(query)) ||
          (t.output && t.output.toLowerCase().includes(query))
        )
      : state.activeTools;

    if (filteredTools.length > 0) {
      rawLines.push(chalk.bold.hex('#818cf8')(`◆ TOOL EXECUTIONS (${filteredTools.length}${query ? ' matched' : ''})`));
      rawLines.push('');

      for (const t of filteredTools) {
        const icon = t.status === 'running' ? chalk.yellow('⏳ RUNNING') : t.status === 'completed' ? chalk.green('✔ SUCCESS') : chalk.red('✘ FAILED');
        const duration = t.completedAt ? chalk.gray(` (${t.completedAt - t.startedAt}ms)`) : '';
        const riskBadge = t.riskLevel === 'DANGEROUS' ? chalk.bgRed.white.bold(' DANGEROUS ') : t.riskLevel === 'RESTRICTED' ? chalk.bgYellow.black.bold(' RESTRICTED ') : '';

        rawLines.push(`${icon} ${chalk.bold.cyan(t.name)} ${riskBadge}${duration}`);

        if (t.args) {
          rawLines.push(chalk.gray(`  args: ${t.args.slice(0, innerWidth - 8)}`));
        }
        if (t.output) {
          const outPreview = t.output.trim().replace(/\r?\n/g, ' ').slice(0, innerWidth - 8);
          rawLines.push(chalk.white(`  out:  ${outPreview}`));
        }
        rawLines.push(chalk.gray('─'.repeat(Math.min(innerWidth, 30))));
      }
    } else if (state.activeTools.length > 0 && query) {
      rawLines.push(chalk.yellow(`  No active tool executions matching filter "${query}".`));
      rawLines.push('');
    } else {
      rawLines.push(chalk.gray('  No tool activity recorded yet in this session.'));
      rawLines.push(chalk.gray('  Execute a prompt requiring tools (e.g. read_file, list_dir).'));
      rawLines.push('');
    }

    const scrollOffset = Math.min(state.toolsScrollOffset, Math.max(0, rawLines.length - innerHeight));
    const visibleLines = rawLines.slice(scrollOffset, scrollOffset + innerHeight);

    const title = query ? `🛠️ Tools Inspector (Filter: "${query}")` : '🛠️ Tools Inspector (F2)';
    return TuiScreen.drawBox(
      title,
      visibleLines,
      width,
      height,
      state.focus === 'tools',
      undefined,
      { total: rawLines.length, visible: innerHeight, offset: scrollOffset }
    );
  }
}
