import { CommandCtx } from './types';
import { getLatestWorkflowLogs } from './workflowLog';
import { CLITheme } from '../ui';
import chalk from 'chalk';

export async function handleBlackboard(_ctx: CommandCtx, arg: string): Promise<void> {
  const limit = parseInt(arg, 10) || 3;
  const logs = getLatestWorkflowLogs(limit);

  if (logs.length === 0) {
    CLITheme.warning('No workflow reports (/goal or /team) found in workflow_logs/.');
    return;
  }

  console.log(chalk.bold(`\n📋 RECENT BLACKBOARD NOTES (last ${logs.length} run(s)):\n`));

  for (const { file, data } of logs) {
    const isGoal = data.type === 'goal';
    const title = isGoal ? `🎯 GOAL: "${data.goal}"` : `👥 TEAM: ${data.displayName || data.team} — "${data.task}"`;
    const status = data.success !== undefined
      ? (data.success ? chalk.green('✔ COMPLETED') : chalk.yellow('⚠ NOT COMPLETED'))
      : (data.completed ? chalk.green('✔ COMPLETED') : chalk.yellow('TO CONTINUE'));

    console.log(chalk.bold.cyan(`[${file}]`) + ` ${title} [${status}]`);
    console.log(chalk.gray(`  Date: ${data.timestamp}`));

    const notes = Array.isArray(data.blackboard) ? data.blackboard : [];
    if (notes.length === 0) {
      console.log(chalk.gray('  (No notes left on blackboard during this run)'));
    } else {
      for (const note of notes) {
        console.log(`  • ${chalk.cyan(`[${note.key}]`)} ${chalk.gray(`(@${note.author}):`)} ${note.value}`);
      }
    }
    console.log();
  }
}
