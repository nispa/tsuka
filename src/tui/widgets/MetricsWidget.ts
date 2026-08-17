import chalk from 'chalk';
import { TuiState } from '../types';

export class MetricsWidget {
  static render(state: TuiState, width: number): string[] {
    const lines: string[] = [];
    lines.push(chalk.bold.hex('#818cf8')('◆ SESSION METRICS'));
    lines.push(chalk.white(`  Turns : ${chalk.bold.yellow(state.stats.turnCount)}`));
    lines.push(chalk.white(`  Tools : ${chalk.bold.yellow(state.stats.toolCallsCount)}`));
    lines.push(chalk.white(`  Tokens: ${chalk.bold.yellow(state.stats.usedTokens.toLocaleString())}`));
    return lines;
  }
}
