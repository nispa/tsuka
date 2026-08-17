import chalk from 'chalk';
import { TuiState } from '../types';

export class PersonaWidget {
  static render(state: TuiState, width: number): string[] {
    const lines: string[] = [];
    lines.push(chalk.bold.hex('#e879f9')('◆ ACTIVE AGENT'));
    lines.push(chalk.white(`  Name  : ${chalk.bold.hex('#38bdf8')(state.activeAiName)}`));
    lines.push(chalk.white(`  Role  : ${chalk.hex('#2dd4bf')(state.activeCharacterRole)}`));
    lines.push(chalk.white(`  Trait : ${chalk.hex('#c084fc')(state.activeCharacterTrait)}`));

    const eff = state.activeReasoningEffort || 'none';
    const effortColor = eff === 'xhigh' || eff === 'high' ? chalk.bold.hex('#e879f9') : eff === 'medium' ? chalk.bold.yellow : chalk.bold.green;
    const srcHint = state.activeEffortSource ? chalk.gray(` (${state.activeEffortSource})`) : '';
    lines.push(chalk.white(`  Effort: ${effortColor(eff)}${srcHint}`));

    if (state.characterRecommendedEffort && state.activeEffortSource !== 'persona') {
      lines.push(chalk.gray(`  Rec.  : ${state.characterRecommendedEffort} (persona)`));
    }
    if (state.activeTeam) {
      lines.push(chalk.white(`  Team  : ${chalk.bold.hex('#fbbf24')(state.activeTeam)}`));
    }

    if (state.activeSpawnedAgent) {
      const sub = state.activeSpawnedAgent;
      const boxW = Math.max(14, width - 4);
      const topBorder = chalk.hex('#818cf8')('  ┌─ 🤖 SPAWNED SUBAGENT ') + chalk.hex('#475569')('─'.repeat(Math.max(2, boxW - 24)));
      lines.push('');
      lines.push(topBorder);
      lines.push(chalk.hex('#818cf8')('  │ ') + chalk.white(`Name  : ${chalk.bold.hex('#38bdf8')(sub.name)}`));
      lines.push(chalk.hex('#818cf8')('  │ ') + chalk.white(`Role  : ${chalk.hex('#2dd4bf')(sub.role)}`));

      let statusBadge = chalk.yellow('⚡ Working...');
      if (sub.status === 'completed') statusBadge = chalk.green('✔ Done');
      else if (sub.status === 'failed') statusBadge = chalk.red('✘ Failed');

      if (sub.currentTool) {
        statusBadge += chalk.gray(` (${sub.currentTool})`);
      }
      lines.push(chalk.hex('#818cf8')('  │ ') + chalk.white(`Status: ${statusBadge}`));

      if (sub.task) {
        const snippet = sub.task.length > 22 ? sub.task.slice(0, 20) + '…' : sub.task;
        lines.push(chalk.hex('#818cf8')('  │ ') + chalk.gray(`Task  : "${snippet}"`));
      }

      if (sub.usedTokens > 0) {
        lines.push(chalk.hex('#818cf8')('  │ ') + chalk.white(`Tokens: ${chalk.bold.hex('#c084fc')(`${sub.usedTokens.toLocaleString()} tokens`)}`));
      }

      const bottomBorder = chalk.hex('#818cf8')('  └') + chalk.hex('#475569')('─'.repeat(boxW));
      lines.push(bottomBorder);
    }

    return lines;
  }
}
