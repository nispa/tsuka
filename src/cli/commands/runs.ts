import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import { getLatestWorkflowLogs } from './workflowLog';
import { logSink } from '../../core/logSink';

/**
 * `/runs` command: displays history and details of completed workflows/goals.
 */
export async function handleRuns(_ctx: CommandCtx, _arg: string): Promise<void> {
  const logs = getLatestWorkflowLogs(15);
  if (logs.length === 0) {
    CLITheme.warning('No workflows saved in workflow_logs/. Run a team (/team) or goal (/goal) to generate reports.');
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    logSink.log(chalk.bold(`\n📜 Workflow History (${logs.length} most recent):\n`));
    for (const log of logs) {
      const data = log.data;
      const isGoal = data.type === 'goal';
      const statusStr = (data.success || data.completed) ? chalk.green('✔ COMPLETED') : chalk.red('✘ FAILED');
      const date = (data.timestamp || '').replace('T', ' ').slice(0, 16);
      const title = isGoal ? `Goal: ${data.goal}` : `Team: ${data.displayName || data.team}`;
      logSink.log(`  ${chalk.cyan(date)}  ${statusStr}  ${chalk.bold(title)}`);
    }
    logSink.log('');
    return;
  }

  const choices = logs.map((log) => {
    const data = log.data;
    const isGoal = data.type === 'goal';
    const isOk = data.success || data.completed;
    const statusIcon = isOk ? '✔' : '✘';
    const date = (data.timestamp || '').replace('T', ' ').slice(0, 16);
    const title = isGoal ? `[GOAL] ${data.goal}` : `[TEAM: ${data.displayName || data.team}] ${data.task}`;
    const truncatedTitle = title.length > 60 ? title.slice(0, 60) + '…' : title;
    return {
      title: `${statusIcon} ${chalk.cyan(date)} ${truncatedTitle}`,
      value: log.file,
      description: `File: ${log.file} · ${isOk ? 'Success' : 'Failed / Incomplete'}`
    };
  });

  choices.push({ title: chalk.gray('── Close'), value: '__exit__', description: 'Close workflow history menu' });

  logSink.log('');
  const selectedFile = await InteractiveMenu.select<string>(
    `📜 Select a workflow to inspect (${logs.length} recent runs):`,
    choices
  );

  if (!selectedFile || selectedFile === '__exit__') return;

  const targetLog = logs.find((l) => l.file === selectedFile);
  if (!targetLog) return;

  const data = targetLog.data;
  const isGoal = data.type === 'goal';
  const isOk = data.success || data.completed;

  logSink.log(chalk.bold(`\n📋 Workflow Details: ${chalk.cyan(selectedFile)}`));
  logSink.log(`  • Type:       ${isGoal ? chalk.yellow('Goal Orchestrator') : chalk.blue(`Team (${data.mode || 'standard'})`)}`);
  logSink.log(`  • Target:     ${chalk.white(isGoal ? data.goal : data.task)}`);
  logSink.log(`  • Outcome:    ${isOk ? chalk.green('COMPLETED SUCCESSFULLY') : chalk.red('FAILED / INCOMPLETE')}`);
  logSink.log(`  • Date:       ${chalk.gray(data.timestamp)}`);

  if (isGoal && data.agents) {
    logSink.log(`  • Agents:     ${chalk.cyan(data.agents.join(', '))}`);
  } else if (data.members) {
    logSink.log(`  • Members:    ${chalk.cyan(data.members.join(', '))}`);
  }

  if (data.stats && Array.isArray(data.stats)) {
    logSink.log(chalk.bold('\n  Turn Statistics:'));
    for (const s of data.stats) {
      const tokOut = s.stats?.outputTokens || s.stats?.outTok || 0;
      const dur = s.stats?.durationMs ? `${(s.stats.durationMs / 1000).toFixed(1)}s` : '';
      logSink.log(`    - ${chalk.bold(s.name)}: ${chalk.green(tokOut)} tok out ${dur ? `(${dur})` : ''}`);
    }
  }

  if (data.blackboard && data.blackboard.length > 0) {
    logSink.log(chalk.bold(`\n  Blackboard (${data.blackboard.length} recorded notes):`));
    for (const note of data.blackboard) {
      const author = note.author ? chalk.yellow(`[${note.author}]`) : '';
      logSink.log(`    • ${chalk.cyan(note.key)} ${author}: ${chalk.white(note.value)}`);
    }
  }

  logSink.log('');
}
