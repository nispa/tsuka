import chalk from 'chalk';
import { TuiState } from '../types';

export class MetricsWidget {
  static render(state: TuiState, width: number): string[] {
    const lines: string[] = [];
    lines.push(chalk.bold.hex('#818cf8')('◆ SESSION METRICS'));
    lines.push(chalk.white(`  Turns : ${chalk.bold.yellow(state.stats.turnCount)}`));
    lines.push(chalk.white(`  Tools : ${chalk.bold.yellow(state.stats.toolCallsCount)}`));
    const subTokens = state.stats.subagentUsedTokens || 0;
    const tokensLabel = subTokens > 0
      ? `${chalk.bold.yellow(state.stats.usedTokens.toLocaleString())} ${chalk.gray(`(+ ${chalk.hex('#c084fc')(subTokens.toLocaleString() + ' sub')})`)}`
      : chalk.bold.yellow(state.stats.usedTokens.toLocaleString());

    lines.push(chalk.white(`  Active: ${tokensLabel} tok`));

    const totalBurned = state.stats.totalSessionTokens || state.stats.usedTokens;
    if (totalBurned > state.stats.usedTokens) {
      lines.push(chalk.white(`  Burned: ${chalk.hex('#c084fc')(`${totalBurned.toLocaleString()} tok`)}`));
    }
    return lines;
  }
}
