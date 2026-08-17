import chalk from 'chalk';
import { TuiState } from '../types';

export class QuickKeysWidget {
  static render(state: TuiState, width: number): string[] {
    const lines: string[] = [];
    lines.push(chalk.bold.hex('#fbbf24')('◆ QUICK KEYS'));
    lines.push(chalk.gray('  F1..F7   : Tabs & Layout'));
    lines.push(chalk.gray('  Tab      : Switch Panes'));
    lines.push(chalk.gray('  ↑/↓      : Scroll / Hist'));
    lines.push(chalk.gray('  Esc      : Stop Agent'));
    lines.push(chalk.gray('  F12      : Help & Slash'));
    return lines;
  }
}
