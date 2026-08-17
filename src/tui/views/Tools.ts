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

    if (state.activeTools.length === 0) {
      rawLines.push(chalk.gray('  No tool activity recorded yet.'));
      rawLines.push(chalk.gray('  Execute a prompt requiring tools (e.g. read_file, list_dir).'));
    } else {
      for (const t of state.activeTools) {
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
    }

    const scrollOffset = Math.min(state.toolsScrollOffset, Math.max(0, rawLines.length - innerHeight));
    const visibleLines = rawLines.slice(scrollOffset, scrollOffset + innerHeight);

    return TuiScreen.drawBox('Tool Inspector', visibleLines, width, height, state.focus === 'tools');
  }
}
