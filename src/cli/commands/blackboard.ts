import { CommandCtx } from './types';
import { getLatestWorkflowLogs } from './workflowLog';
import { CLITheme } from '../ui';
import chalk from 'chalk';

export async function handleBlackboard(_ctx: CommandCtx, arg: string): Promise<void> {
  const limit = parseInt(arg, 10) || 3;
  const logs = getLatestWorkflowLogs(limit);

  if (logs.length === 0) {
    CLITheme.warning('Nessun report di workflow (/goal o /team) trovato in workflow_logs/.');
    return;
  }

  console.log(chalk.bold(`\n📋 ULTIME NOTE BLACKBOARD DAI WORKFLOW (ultimi ${logs.length} run):\n`));

  for (const { file, data } of logs) {
    const isGoal = data.type === 'goal';
    const title = isGoal ? `🎯 GOAL: "${data.goal}"` : `👥 TEAM: ${data.displayName || data.team} — "${data.task}"`;
    const status = data.success !== undefined
      ? (data.success ? chalk.green('✔ COMPLETATO') : chalk.yellow('⚠ NON COMPLETATO'))
      : (data.completed ? chalk.green('✔ COMPLETATO') : chalk.yellow('DA CONTINUARE'));

    console.log(chalk.bold.cyan(`[${file}]`) + ` ${title} [${status}]`);
    console.log(chalk.gray(`  Data: ${data.timestamp}`));

    const notes = Array.isArray(data.blackboard) ? data.blackboard : [];
    if (notes.length === 0) {
      console.log(chalk.gray('  (Nessuna nota lasciata dagli agenti sulla blackboard in questo run)'));
    } else {
      for (const note of notes) {
        console.log(`  • ${chalk.cyan(`[${note.key}]`)} ${chalk.gray(`(@${note.author}):`)} ${note.value}`);
      }
    }
    console.log();
  }
}
