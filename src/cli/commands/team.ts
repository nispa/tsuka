import prompts from 'prompts';
import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import { GenerationInterrupt } from '../interrupt';
import { ChatMessage } from '../../core/types';
import { TeamStrategy, ProtocolLogEntry, TurnStats, seedTeamMessages, runMemberTurn, hasCompletionMarker } from './strategies/common';
import { runRoundRobin, roundRobinStrategy } from './strategies/roundRobin';
import { runOrchestrated, orchestratedStrategy, parseOrchestratorDecision, hasDoneSignal } from './strategies/orchestrated';
import { runPipeline, pipelineStrategy } from './strategies/pipeline';
import { runDiscussionRound, hasUnanimousApproval } from './strategies/hybrid';
import { writeWorkflowLog } from './workflowLog';
import { Blackboard } from '../../core/blackboard';
import { WorkflowScope } from '../../core/workflowScope';
import { logSink } from '../../core/logSink';

/**
 * `/team` dispatcher: loads team JSON configuration, selects `TeamStrategy` based on mode,
 * and delegates execution.
 */
export {
  runRoundRobin, runOrchestrated, runPipeline, runDiscussionRound,
  runMemberTurn, hasCompletionMarker, hasUnanimousApproval,
  parseOrchestratorDecision, hasDoneSignal
};
export type { TurnStats, ProtocolLogEntry };

export async function handleTeam(ctx: CommandCtx, arg: string, directTask?: string): Promise<void> {
  const availableTeams = ctx.listAvailableItems('teams', ctx.loadTeam);
  if (availableTeams.length === 0) {
    CLITheme.warning('No teams configured in teams/ directory.');
    return;
  }

  let selectedTeamName = arg.toLowerCase().trim();
  if (!selectedTeamName) {
    logSink.log('');
    const selected = await InteractiveMenu.select<string>(
      'Select team to activate (use arrow keys):',
      availableTeams.map((t) => ({ title: `${t.displayName} - ${t.description}`, value: t.name })),
      availableTeams[0].name
    );
    if (!selected) return;
    selectedTeamName = selected;
  }

  const team = ctx.loadTeam(selectedTeamName);
  if (!team) {
    CLITheme.error(`Team '${selectedTeamName}' not found.`);
    return;
  }

  let task = (directTask || '').trim();
  if (!task) {
    if (process.env.TSUKA_TUI || (ctx as any).isTui) {
      CLITheme.warning('Usage: /team <team_name> "<task description>"');
      return;
    }
    logSink.log('');
    const taskResp = await prompts({
      type: 'text',
      name: 'task',
      message: chalk.cyan.bold('Describe the task for the Team ❯'),
    });
    task = taskResp.task?.trim() || '';
  }

  if (!task) {
    CLITheme.warning('Operation canceled: no task specified.');
    return;
  }

  return WorkflowScope.withScope('team', async () => {
    const maxRounds = ctx.configManager.getTeamMaxRounds();
    const modeLabel = team.mode === 'orchestrated' ? 'Orchestrated' : team.mode === 'pipeline' ? 'Pipeline' : 'Round-robin';
    const hybridInfo = (team.discussionRounds ?? 0) > 0 ? ` + ${team.discussionRounds} discussion round(s)` : '';
    logSink.log(chalk.bold('\n🚀 [COLLABORATIVE TEAM WORKFLOW LAUNCHED]'));
    logSink.log(`Team:        ${chalk.green(team.displayName)}`);
    logSink.log(`Mode:        ${chalk.cyan(modeLabel)}${hybridInfo}`);
    logSink.log(`Members:     ${team.members.map((m: string) => chalk.cyan(m)).join(', ')}`);
    if (team.orchestrator && team.mode === 'orchestrated') {
      logSink.log(`Orchestrator: ${chalk.magenta(team.orchestrator)}`);
    }
    logSink.log(`Task:        "${chalk.yellow(task)}"`);
    logSink.log(`Max rounds:  ${chalk.cyan(maxRounds)} (early stop on task completion)\n`);

    const teamMessages: ChatMessage[] = seedTeamMessages(task);

    const interrupt = new GenerationInterrupt();
    interrupt.arm();

    const turnLog: ProtocolLogEntry[] = [];
    const strategy: TeamStrategy = team.mode === 'pipeline'
      ? pipelineStrategy
      : team.mode === 'orchestrated' && team.orchestrator
      ? orchestratedStrategy
      : roundRobinStrategy;

    const runId = Blackboard.newRunId();
    let completed = false, failed = false, roundsDone = 0;
    let blackboardSnapshot: ReturnType<Blackboard['snapshot']> = [];
    try {
      const result = await Blackboard.withRun(runId, () =>
        strategy.run({ ctx, team, task, maxRounds, interrupt, teamMessages, turnLog })
      );
      completed = result.completed;
      roundsDone = result.roundsDone;
      failed = !!result.failed;
      blackboardSnapshot = Blackboard.forRun(runId).snapshot();
    } finally {
      interrupt.disarm();
      Blackboard.endRun(runId);
    }

    logSink.log(chalk.bold('🚀 [COLLABORATIVE TEAM WORKFLOW CONCLUDED]\n'));
    writeWorkflowLog({ team, task, completed, failed, roundsDone, teamMessages, turnLog, blackboard: blackboardSnapshot });

    const finalReport = completed
      ? `The team (${team.members.join(', ')}) COMPLETED the task: "${task}" in ${roundsDone} round(s).
      Inspect workspace files to verify output or request details about the process.`
      : failed
      ? `The team (${team.members.join(', ')}) declared the task FAILED after ${roundsDone} round(s): "${task}".
      A team member signaled an inability to solve the task with available tools: inspect workspace files and consider relaunching with adjusted instructions.`
      : `The team (${team.members.join(', ')}) worked for ${maxRounds} round(s) on: "${task}" without declaring completion.
      Workspace changes may be partial: consider checking files and relaunching if needed.`;

    if (completed) {
      CLITheme.success(`Task resolved by team in ${roundsDone} round(s).`);
    } else if (failed) {
      CLITheme.error(`Team declared task FAILED after ${roundsDone} round(s).`);
    } else {
      CLITheme.warning(`Reached limit of ${maxRounds} round(s) without declared completion.`);
    }

    ctx.agent.current.getMessages().push({ role: 'user', content: `Team work completed for: "${task}"` });
    ctx.agent.current.getMessages().push({ role: 'assistant', content: finalReport });
  });
}
