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
    return lines;
  }
}
