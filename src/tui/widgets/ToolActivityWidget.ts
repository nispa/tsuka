import chalk from 'chalk';
import { TuiState } from '../types';

export class ToolActivityWidget {
  static render(state: TuiState, width: number): string[] {
    const lines: string[] = [];
    lines.push(chalk.bold.hex('#2dd4bf')('◆ TOOL ACTIVITY'));
    if (state.activeTools.length === 0) {
      lines.push(chalk.gray('  (No tool calls yet)'));
    } else {
      for (const t of state.activeTools.slice(0, 5)) {
        const icon = t.status === 'running' ? chalk.yellow('⏳') : t.status === 'completed' ? chalk.green('✔') : chalk.red('✘');
        lines.push(`  ${icon} ${chalk.white(t.name)}`);
      }
    }
    return lines;
  }
}
