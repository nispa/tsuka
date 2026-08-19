import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import { StreamRenderer } from '../stream';
import { GenerationInterrupt } from '../interrupt';
import { MemoryStore } from '../../core/memory';
import { ContextTracker } from '../../core/contextTracker';
import { runMemberTurn, TurnStats } from './team';
import { ChatMessage } from '../../core/types';
import { estimateMessagesTokens } from '../../core/contextBudget';
import { createParallelBranches, mergeParallelWorkspaces } from '../../core/parallelWorkspace';
import { installLogBuffering, runWithLogBuffer, flushLogBuffer } from '../../core/logBuffer';
import { withWorkspaceOverride } from '../../tools/impl/utils';
import { Blackboard, BlackboardNote } from '../../core/blackboard';
import { WorkflowScope } from '../../core/workflowScope';
import { writeGoalLog } from './workflowLog';
import { withEffortPin } from '../../core/effortControl';
import { logSink } from '../../core/logSink';
import { CharacterConfig } from '../shared';
import { rolesOf, buildGoalOrchestratorPrompt } from './goalPrompts';
import { parsePlan } from './goalParsing';

export { formatAgentSignature, buildTeamBlueprints, buildGoalOrchestratorPrompt } from './goalPrompts';
export { parsePlan, parseAgentLine } from './goalParsing';

function getCharDisplayName(allCharacters: CharacterConfig[], agentName: string): string {
  const char = allCharacters.find((c) => c.name === agentName);
  return char ? char.aiName : agentName;
}

/**
 * Saves a fact to memory and trims the last assistant message if excessively long.
 */
function condenseAgentOutput(
  agentName: string,
  teamMessages: ChatMessage[],
  allCharacters: CharacterConfig[],
  maxTokens: number,
  maxKeepChars: number = 1500
): void {
  const displayName = getCharDisplayName(allCharacters, agentName);
  const before = estimateMessagesTokens(teamMessages);
  for (let i = teamMessages.length - 1; i >= 0; i--) {
    const msg = teamMessages[i];
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      const full = msg.content;
      MemoryStore.getInstance().addFact(`[Goal] ${displayName}: ${full.replace(/\s+/g, ' ').slice(0, 300).trim()}`, 'goal_orchestrator', {
        kind: 'run',
        summary: `Goal — ${displayName}'s output condensed`,
      });
      if (full.length > maxKeepChars) {
        const kept = full.slice(0, maxKeepChars).trim();
        msg.content = `${kept}\n\n[... output shortened. Complete details: recall_memory "Goal ${displayName}"]`;
      }
      break;
    }
  }
  const after = estimateMessagesTokens(teamMessages);
  const saved = before - after;
  if (saved > 0) {
    const pct = maxTokens > 0 ? Math.round((after / maxTokens) * 100) : 0;
    const savedStr = saved >= 1000 ? `${(saved / 1000).toFixed(1)}k` : `${saved}`;
    logSink.log(chalk.gray(`  💾 Compressed context: saved ~${savedStr} tok (~${after.toLocaleString()} tot, ${pct}% of limit)`));
  }
  CLITheme.contextBar(after, maxTokens, 'History context:');
}

export async function handleGoal(ctx: CommandCtx, arg: string): Promise<void> {
  const goal = arg.trim();
  if (!goal) {
    CLITheme.error('Please specify a goal. Example: /goal "Build a website and deploy it"');
    return;
  }

  return WorkflowScope.withScope('goal', async () => {
    const allCharacters = ctx.listAvailableCharacters();
    if (allCharacters.length === 0) {
      CLITheme.warning('No characters available. Use /character to create one.');
      return;
    }

    logSink.log(chalk.bold('\n🎯 [GOAL ORCHESTRATOR]'));
    logSink.log(`Goal:       "${chalk.yellow(goal)}"`);
    logSink.log(`Agents:     ${allCharacters.map((c) => chalk.cyan(`@${c.name}`)).join(', ')}\n`);

    const sysPrompt = buildGoalOrchestratorPrompt(allCharacters, goal);
    const orcMessages: ChatMessage[] = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: `Plan team for: "${goal}"` }
    ];

    const interrupt = new GenerationInterrupt();
    interrupt.arm();

    logSink.log(chalk.bold.cyan('[ORCHESTRATOR] Analyzing goal and planning team...\n'));

    const planRenderer = new StreamRenderer({ headerName: 'Goal Orchestrator', headerColor: chalk.magenta });
    planRenderer.begin();

    const orchestratorEffort = withEffortPin('low');

    let planText = '';
    try {
      const response = await ctx.provider.chatWithTools(
        orcMessages,
        undefined,
        (chunk, channel) => planRenderer.onDelta(chunk, channel ?? 'content'),
        interrupt.signal,
        {
          reasoningEffort: orchestratorEffort,
          creativity: 'precise'
        }
      );
      planRenderer.finish();
      planText = response.content?.trim() || '';
      logSink.log('');
    } catch (err: any) {
      planRenderer.abort();
      if (interrupt.aborted) { CLITheme.warning('Goal interrupted (Esc).'); interrupt.disarm(); return; }
      CLITheme.error(`Orchestrator error: ${err.message}`);
      interrupt.disarm();
      return;
    }

    if (!/AGENTE:/i.test(planText) && /^FINE\b/im.test(planText)) {
      CLITheme.info('The orchestrator determined this goal does not require a multi-agent team.');
      CLITheme.info('You can continue the conversation with the default agent.\n');
      interrupt.disarm();
      return;
    }

    const { groups, flatSteps } = parsePlan(planText, allCharacters, ctx.configManager.isParallelExecutionEnabled());

    if (groups.length === 0) {
      CLITheme.warning('No direct AGENTE: format found in plan. Recovering mentioned agents...');
      
      const mentionedNames = new Set<string>();
      for (const c of allCharacters) {
        const pattern = new RegExp(`@?\\b${c.name.replace(/_/g, '[_\\s-]?')}\\b`, 'i');
        if (pattern.test(planText)) {
          mentionedNames.add(c.name);
        }
      }

      if (mentionedNames.size > 0) {
        for (const name of mentionedNames) {
          groups.push({ mode: 'sequential', steps: [{ agentName: name, task: `Execute task related to goal: ${goal}` }], label: name });
        }
      } else {
        const devChar = allCharacters.find((c) => rolesOf(c).includes('developer')) || allCharacters[0];
        const supervisorChar = allCharacters.find((c) => rolesOf(c).includes('supervisor')) || allCharacters[1] || allCharacters[0];
        CLITheme.warning(`No specific agents detected: assigning to default pair (@${devChar.name} + @${supervisorChar.name}).`);

        groups.push({ mode: 'sequential', steps: [{ agentName: devChar.name, task: `Develop goal: ${goal}` }], label: devChar.name });
        if (supervisorChar && supervisorChar.name !== devChar.name) {
          groups.push({ mode: 'sequential', steps: [{ agentName: supervisorChar.name, task: `Verify and validate work` }], label: supervisorChar.name });
        }
      }
    }

    logSink.log(chalk.bold('\n📋 EXECUTION PLAN'));
    let stepCounter = 1;
    for (const group of groups) {
      if (group.mode === 'parallel') {
        logSink.log(`  ⚡ ${chalk.yellow('PARALLEL')}:`);
        for (const s of group.steps) {
          logSink.log(`     ${stepCounter}. ${chalk.cyan(getCharDisplayName(allCharacters, s.agentName))} — ${chalk.gray(s.task)}`);
          stepCounter++;
        }
      } else {
        logSink.log(`  ${stepCounter}. ${chalk.cyan(getCharDisplayName(allCharacters, group.steps[0].agentName))} — ${chalk.gray(group.steps[0].task)}`);
        stepCounter++;
      }
    }
    logSink.log('');

    const maxTokens = ctx.configManager.getMaxHistoryTokens();
    const teamMessages: ChatMessage[] = [
      { role: 'system', content: '' },
      { role: 'user', content: `GOAL TO ACHIEVE: "${goal}"` }
    ];

    const CTX_OVERHEAD = 2000;
    let lastPromptTokens = 0;

    let completed = false;
    let reworkAttempted = false;
    let overallStep = 0;
    const agentStats: { name: string; stats: TurnStats }[] = [];

    let isAuto = true;
    if (process.stdin.isTTY && !process.env.TSUKA_TUI && !(ctx as any).isTui) {
      const autoModeChoice = await InteractiveMenu.select<string>(
        'Execution mode for this goal:',
        [
          { title: '⚡ Autonomous — Allow file modifications and workspace searches without prompts', value: 'auto' },
          { title: '🛡️  Supervised — Prompt for confirmation on every file creation/edit', value: 'supervised' }
        ],
        'auto'
      );
      isAuto = autoModeChoice === 'auto';
    }

    const prevAllowWrite = ctx.permissionManager.isAllowAllWrite();
    if (isAuto) {
      ctx.permissionManager.setAllowAllWrite(true);
      logSink.log(chalk.green('✔ Autonomous mode enabled for this goal (workspace file writes auto-approved).'));
      logSink.log(chalk.gray('  Workspace jail remains enforced; DANGEROUS commands still require confirmation.\n'));
    } else {
      logSink.log(chalk.yellow('✔ Supervised mode enabled: confirmation requested for each file.\n'));
    }

    const runId = Blackboard.newRunId();
    let blackboardNotes: BlackboardNote[] = [];
    const condenseLimit = ctx.configManager.getGoalCondensedHistoryCharLimit();
    try {
      await Blackboard.withRun(runId, async () => {
        for (let g = 0; g < groups.length; g++) {
          if (interrupt.aborted) break;
          const group = groups[g];

          if (group.mode === 'parallel') {
            const ctxEstimate = estimateMessagesTokens(teamMessages) + CTX_OVERHEAD;
            CLITheme.contextBar(ctxEstimate, maxTokens, 'Estimated context (parallel group):');

            logSink.log(chalk.bold.yellow(`\n═══ PARALLEL GROUP ${g + 1}/${groups.length} ═══`));
            for (const s of group.steps) {
              logSink.log(`  ⚡ ${chalk.cyan(getCharDisplayName(allCharacters, s.agentName))}: ${chalk.gray(s.task)}`);
            }
            logSink.log('');

            const branches = createParallelBranches(group.steps.map((s) => getCharDisplayName(allCharacters, s.agentName)));

            const restoreConsole = installLogBuffering();
            const spinner = CLITheme.createSpinner(`${group.steps.length} agents working in parallel...`);
            spinner.start();

            let parallelResults: Array<{ result: string; localHistory: ChatMessage[]; agentName: string; buffer: string[] }>;
            try {
              parallelResults = await Promise.all(group.steps.map(async (step, idx) => {
                const branch = branches[idx];
                const buffer: string[] = [];
                return runWithLogBuffer(buffer, () => withWorkspaceOverride(branch.root, async () => {
                  const localHistory = [...teamMessages];
                  localHistory.push({ role: 'user', content: `[Parallel task for @${step.agentName}]: ${step.task}\n\nInstructions: Inspect workspace files (list_dir, read_file) to see work done by previous agents. Execute your task with tools. End with a detailed summary of what you did, files created/modified, and what the next agent needs.` });
                  const ref: { s: TurnStats | null } = { s: null };
                  const result = await runMemberTurn(
                    ctx, step.agentName, goal,
                    overallStep + idx + 1, flatSteps, localHistory, interrupt, overallStep === 0 && idx === 0,
                    (stats) => { ref.s = stats; }
                  );
                  if (ref.s) {
                    agentStats.push({ name: step.agentName, stats: ref.s });
                    lastPromptTokens = Math.max(lastPromptTokens, ref.s.promptTokens);
                    ContextTracker.getInstance().addEntry({
                      timestamp: new Date().toISOString(),
                      agentName: getCharDisplayName(allCharacters, step.agentName),
                      tokenCount: ref.s.tokenCount,
                      promptTokens: ref.s.promptTokens,
                      action: step.task.length > 60 ? step.task.slice(0, 60) + '…' : step.task
                    });
                  }
                  return { result, localHistory, agentName: step.agentName, buffer };
                }));
              }));
            } finally {
              restoreConsole();
              spinner.stop();
            }

            for (const pr of parallelResults) {
              flushLogBuffer(pr.buffer);
            }

            const mergeResult = mergeParallelWorkspaces(branches, ctx.configManager.getWorkspaceRoot());
            if (mergeResult.merged.length > 0) {
              logSink.log(chalk.gray(`  📁 Merged workspace files: ${mergeResult.merged.join(', ')}`));
            }
            if (mergeResult.conflicts.length > 0) {
              CLITheme.warning(`Conflicts in parallel block: ${mergeResult.conflicts.length} files written differently — left untouched in workspace:`);
              for (const c of mergeResult.conflicts) {
                logSink.log(chalk.yellow(`    • ${c.relativePath} — conflicting writes by: ${c.labels.join(', ')}`));
              }
            }

            if (lastPromptTokens > 0) {
              CLITheme.contextBar(lastPromptTokens, maxTokens, 'Peak context (LLM prompt):');
            }

            for (const pr of parallelResults) {
              const newMsgs = pr.localHistory.slice(teamMessages.length);
              teamMessages.push(...newMsgs);
              if (pr.result === 'completed') completed = true;
            }
            for (const pr of parallelResults) {
              condenseAgentOutput(pr.agentName, teamMessages, allCharacters, maxTokens, condenseLimit);
            }
            overallStep += group.steps.length;

          } else {
            const step = group.steps[0];
            const char = allCharacters.find((c) => c.name === step.agentName);
            if (!char) continue;

            overallStep++;
            const ctxEstimate = lastPromptTokens > 0
              ? lastPromptTokens
              : estimateMessagesTokens(teamMessages) + CTX_OVERHEAD;
            CLITheme.contextBar(ctxEstimate, maxTokens, `Context before ${char.aiName}:`);

            logSink.log(chalk.bold.yellow(`\n═══ STEP ${overallStep}/${flatSteps}: ${char.aiName} ═══`));
            logSink.log(chalk.gray(`Task: ${step.task}`));

            teamMessages.push({ role: 'user', content: `[Task for @${step.agentName}]: ${step.task}\n\nInstructions: Analyze the history for previous colleagues' work. Inspect workspace files (list_dir, read_file) to read existing work. Then execute your specific task with your tools. End with a detailed summary: what you did, files created/modified, and what the next agent needs.` });

            const ref: { s: TurnStats | null } = { s: null };
            const result = await runMemberTurn(
              ctx, step.agentName, goal,
              overallStep, flatSteps, teamMessages, interrupt, overallStep === 1,
              (stats) => { ref.s = stats; }
            );
            if (ref.s) {
              agentStats.push({ name: step.agentName, stats: ref.s });
              lastPromptTokens = ref.s.promptTokens;
              ContextTracker.getInstance().addEntry({
                timestamp: new Date().toISOString(),
                agentName: char.aiName,
                tokenCount: ref.s.tokenCount,
                promptTokens: ref.s.promptTokens,
                action: step.task.length > 60 ? step.task.slice(0, 60) + '…' : step.task
              });
              CLITheme.contextBar(lastPromptTokens, maxTokens, `Peak context (${char.aiName}):`);
            }

            condenseAgentOutput(step.agentName, teamMessages, allCharacters, maxTokens, condenseLimit);

            if (result === 'completed') completed = true;

            const isSupervisor = rolesOf(char).includes('supervisor');
            if (isSupervisor && (result === 'failed' || result === 'continue') && !reworkAttempted && g > 0) {
              reworkAttempted = true;
              const lastAssistantMsg = teamMessages[teamMessages.length - 1]?.content || '';
              logSink.log(chalk.bold.yellow(`\n[SUPERVISOR VERDICT: REWORK REQUIRED]`));
              logSink.log(chalk.gray(`Supervisor identified issues. Launching rework cycle for previous step...`));

              const prevGroup = groups[g - 1];
              if (prevGroup && prevGroup.steps.length > 0) {
                const targetStep = prevGroup.steps[0];
                const targetChar = allCharacters.find((c) => c.name === targetStep.agentName);
                if (targetChar) {
                  overallStep++;
                  logSink.log(chalk.bold.yellow(`\n═══ REWORK STEP: ${targetChar.aiName} ═══`));
                  const reworkPrompt = `[SUPERVISOR-DIRECTED REWORK for @${targetStep.agentName}]:\n` +
                    `Supervisor noted issues in prior review:\n${lastAssistantMsg}\n\n` +
                    `Fix the issues indicated and re-run the task.`;
                  teamMessages.push({ role: 'user', content: reworkPrompt });

                  await runMemberTurn(
                    ctx, targetStep.agentName, goal,
                    overallStep, flatSteps + 2, teamMessages, interrupt, false
                  );
                  condenseAgentOutput(targetStep.agentName, teamMessages, allCharacters, maxTokens, condenseLimit);

                  overallStep++;
                  logSink.log(chalk.bold.yellow(`\n═══ POST-REWORK SUPERVISOR REVIEW ═══`));
                  teamMessages.push({ role: 'user', content: `[Post-rework supervisor review]: Verify if issues from @${targetStep.agentName} have been resolved.` });
                  const finalOverseerOutcome = await runMemberTurn(
                    ctx, step.agentName, goal,
                    overallStep, flatSteps + 2, teamMessages, interrupt, false
                  );
                  if (finalOverseerOutcome === 'completed') completed = true;
                  condenseAgentOutput(step.agentName, teamMessages, allCharacters, maxTokens, condenseLimit);
                }
              }
            }

            if (result === 'interrupted') break;
          }
        }
      });
    } finally {
      try {
        blackboardNotes = Blackboard.forRun(runId).snapshot();
      } catch {}
      ctx.permissionManager.setAllowAllWrite(prevAllowWrite);
      Blackboard.endRun(runId);
    }

    interrupt.disarm();

    if (agentStats.length > 0) {
      logSink.log(chalk.bold('\n📊 AGENT STATS SUMMARY'));
      logSink.log(`  ${'Agent'.padEnd(16)}  ${'Out tok'.padStart(7)}  ${'Ctx tok'.padStart(8)}  ${'Tot tok'.padStart(7)}  ${'Time'.padStart(7)}  ${'Speed'.padStart(10)}`);
      let totalOut = 0, totalCtx = 0, totalAll = 0, totalMs = 0;
      for (const { name, stats } of agentStats) {
        const displayName = getCharDisplayName(allCharacters, name);
        const sec = (stats.durationMs / 1000).toFixed(1);
        const ctx = stats.promptTokens || 0;
        const tot = stats.totalTokens || (ctx + stats.tokenCount);
        logSink.log(`  ${chalk.cyan(displayName.padEnd(16))}  ${chalk.yellow(String(stats.tokenCount).padStart(7))}  ${chalk.gray(String(ctx).padStart(8))}  ${chalk.gray(String(tot).padStart(7))}  ${chalk.gray(`${sec}s`.padStart(7))}  ${chalk.gray(`${stats.tokensPerSecond} tok/s`.padStart(10))}`);
        totalOut += stats.tokenCount;
        totalCtx = Math.max(totalCtx, ctx);
        totalAll += tot;
        totalMs += stats.durationMs;
      }
      if (agentStats.length > 1) {
        const totalSec = (totalMs / 1000).toFixed(1);
        logSink.log(`  ${chalk.bold('TOTAL'.padEnd(16))}  ${chalk.bold.yellow(String(totalOut).padStart(7))}  ${chalk.bold.gray(String(totalCtx).padStart(8))}  ${chalk.bold.gray(String(totalAll).padStart(7))}  ${chalk.bold.gray(`${totalSec}s`.padStart(7))}`);
      }
      logSink.log('');
    }

    if (blackboardNotes.length > 0) {
      logSink.log(chalk.bold('📋 SHARED BLACKBOARD NOTES (RUN)'));
      for (const note of blackboardNotes) {
        logSink.log(`  • ${chalk.cyan(`[${note.key}]`)} ${chalk.gray(`(@${note.author}):`)} ${note.value}`);
      }
      logSink.log('');
    }

    logSink.log(chalk.bold('\n🎯 [END GOAL]\n'));

    const agentNames = groups.flatMap((g) => g.steps.map((s) => s.agentName));
    if (completed) {
      CLITheme.success(`Goal achieved successfully in ${flatSteps} steps.`);
    } else {
      CLITheme.warning(`Goal incomplete (${flatSteps} steps processed).`);
    }

    const logFile = writeGoalLog({
      goal,
      success: completed,
      agents: agentNames,
      stats: agentStats,
      blackboard: blackboardNotes
    });
    if (logFile) {
      logSink.log(chalk.gray(`  📄 Goal report saved to: workflow_logs/${logFile}`));
    }

    const summary = completed
      ? `Goal Orchestrator completed goal: "${goal}" in ${flatSteps} steps (${agentNames.join(' → ')}).`
      : `Goal Orchestrator worked on goal: "${goal}" (incomplete). Team: ${agentNames.join(' → ')}.`;
    ctx.agent.current.getMessages().push({ role: 'user', content: `Goal: "${goal}"` });
    ctx.agent.current.getMessages().push({ role: 'assistant', content: summary });
  });
}
