import chalk from 'chalk';
import { TuiState, TuiSpawnedAgent } from '../types';

/** Past subagents listed under the active one before the list is folded into "+N more". */
const MAX_LISTED_SUBAGENTS = 5;

/** Compact elapsed time of a subagent run. */
function formatDuration(agent: TuiSpawnedAgent): string {
  const end = agent.completedAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - agent.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

function statusIcon(agent: TuiSpawnedAgent): string {
  if (agent.status === 'completed') return chalk.green('✔');
  if (agent.status === 'failed') return chalk.red('✘');
  return chalk.yellow('⚡');
}

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

    lines.push(...PersonaWidget.renderSubagents(state, width));
    return lines;
  }

  /**
   * Roster of the subagents of this session: the running one in full, the ones that
   * already returned as a list with what they cost. The running one used to replace the
   * list entirely, so the tokens spent by the previous subagents disappeared from the
   * screen as soon as the next one started (T18.6).
   */
  private static renderSubagents(state: TuiState, width: number): string[] {
    const history = state.spawnedAgentsHistory || [];
    const active = state.activeSpawnedAgent;
    if (history.length === 0 && !active) return [];

    const lines: string[] = [];
    const totalTokens = history.reduce((sum, a) => sum + (a.usedTokens || 0), 0);
    lines.push('');
    lines.push(
      chalk.bold.hex('#c084fc')(`◆ SUBAGENTS (${history.length}`) +
      (totalTokens > 0 ? chalk.hex('#c084fc')(` · ${totalTokens.toLocaleString()} tok`) : '') +
      chalk.bold.hex('#c084fc')(')')
    );

    if (active) {
      lines.push(...PersonaWidget.renderActiveBox(active, width));
    }

    const past = history.filter((a) => a.id !== active?.id);
    for (const sub of past.slice(0, MAX_LISTED_SUBAGENTS)) {
      const tok = sub.usedTokens > 0 ? `${sub.usedTokens.toLocaleString()} tok` : '—';
      const name = `@${sub.name}`;
      const meta = `${tok} · ${formatDuration(sub)}`;
      // Name and figures share the row: the name gives way first when the sidebar is narrow.
      const room = Math.max(6, width - 8 - meta.length);
      const shownName = name.length > room ? name.slice(0, Math.max(3, room - 1)) + '…' : name;
      lines.push(
        `  ${statusIcon(sub)} ` +
        chalk.hex('#38bdf8')(shownName.padEnd(room, ' ')) +
        chalk.gray(meta)
      );
    }

    const hidden = past.length - MAX_LISTED_SUBAGENTS;
    if (hidden > 0) {
      lines.push(chalk.gray(`    … +${hidden} more`));
    }

    return lines;
  }

  /** The subagent currently running, with the detail the list cannot carry. */
  private static renderActiveBox(sub: TuiSpawnedAgent, width: number): string[] {
    const lines: string[] = [];
    const boxW = Math.max(14, width - 4);
    lines.push(chalk.hex('#818cf8')('  ┌─ 🤖 SPAWNED SUBAGENT ') + chalk.hex('#475569')('─'.repeat(Math.max(2, boxW - 24))));
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
    lines.push(chalk.hex('#818cf8')('  │ ') + chalk.gray(`Time  : ${formatDuration(sub)}`));

    lines.push(chalk.hex('#818cf8')('  └') + chalk.hex('#475569')('─'.repeat(boxW)));
    return lines;
  }
}
