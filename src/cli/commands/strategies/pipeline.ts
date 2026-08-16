import chalk from 'chalk';
import { CommandCtx } from '../types';
import { CLITheme } from '../../ui';
import { GenerationInterrupt } from '../../interrupt';
import { resolveCharacter } from '../../shared';
import { ChatMessage } from '../../../core/types';
import { runLoop } from '../../../core/loop';
import { TeamRunConfig, ProtocolLogEntry, TeamResult, TeamStrategy, runMemberTurn } from './common';
import { logSink } from '../../../core/logSink';

// ── Modalità pipeline (catena di montaggio) ──

export async function runPipeline(
  ctx: CommandCtx,
  team: TeamRunConfig,
  task: string,
  interrupt: GenerationInterrupt,
  teamMessages: ChatMessage[],
  turnLog?: ProtocolLogEntry[]
): Promise<TeamResult> {
  logSink.log(chalk.bold.yellow(`\n═══ PIPELINE: ${team.members.length} stazioni ═══`));

  for (let i = 0; i < team.members.length; i++) {
    if (interrupt.aborted) break;
    const memberName = team.members[i];
    const memberChar = resolveCharacter(memberName);
    if (!memberChar) {
      CLITheme.warning(`Stazione '${memberName}' non trovata. Saltata.`);
      continue;
    }
    logSink.log(chalk.bold.blue(`\n[STAZIONE ${i + 1}/${team.members.length}: ${memberChar.displayName}]`));

    // Inietta descrizione stazione nella history
    const desc = i === 0
      ? `You are first in the pipeline. Work on the initial task.`
      : `You receive work from the previous station. Analyze, refine, and pass it on.`;
    teamMessages.push({ role: 'user', content: `[Pipeline stazione ${i + 1} - ${memberChar.aiName}]: ${desc}` });

    const stationConfig = team.stations?.[memberName];
    const acceptance = stationConfig?.acceptance || (i === team.members.length - 1 ? team.acceptance : undefined);
    const maxAttempts = stationConfig?.maxAttempts || team.maxAttempts;

    if (acceptance) {
      const loopRes = await runLoop({
        task,
        maxAttempts: maxAttempts ?? 3,
        acceptance,
        agentLabel: memberChar.aiName,
        permissionManager: ctx.permissionManager,
        provider: ctx.provider,
        executeAttempt: async (prompt, attemptIdx) => {
          if (attemptIdx > 0) {
            teamMessages.push({
              role: 'user',
              content: `[Pipeline stazione ${i + 1} - ${memberChar.aiName} Tentativo ${attemptIdx + 1}]:\n${prompt}`
            });
          }
          const turnOutcome = await runMemberTurn(ctx, memberName, prompt, i + 1, team.members.length, teamMessages, interrupt, i === 0 && attemptIdx === 0, undefined, turnLog);
          const lastMsg = teamMessages[teamMessages.length - 1];
          const answer = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
          const issues = turnOutcome === 'failed' ? ['La stazione ha dichiarato il compito FALLITO.'] : [];
          return { answer, issues };
        }
      });

      if (loopRes.outcome === 'success') {
        if (i === team.members.length - 1) {
          logSink.log(chalk.green.bold(`\n✔ Pipeline completata da ${memberChar.aiName}.`));
          return { completed: true, roundsDone: i + 1 };
        }
        continue;
      } else {
        logSink.log(chalk.red.bold(`\n✘ Pipeline interrotta alla stazione ${i + 1} (${memberChar.aiName}): verifiche non superate (${loopRes.outcome}).`));
        return { completed: false, roundsDone: i + 1, failed: true };
      }
    } else {
      const result = await runMemberTurn(ctx, memberName, task, i + 1, team.members.length, teamMessages, interrupt, i === 0, undefined, turnLog);
      if (result === 'completed') {
        logSink.log(chalk.green.bold(`\n✔ Pipeline completata da ${memberChar.aiName}.`));
        return { completed: true, roundsDone: i + 1 };
      }
      if (result === 'failed') {
        logSink.log(chalk.red.bold(`\n✘ Pipeline interrotta: ${memberChar.aiName} ha dichiarato il compito FALLITO alla stazione ${i + 1}.`));
        return { completed: false, roundsDone: i + 1, failed: true };
      }
      if (result === 'interrupted') break;
    }
  }

  return { completed: false, roundsDone: team.members.length };
}

export const pipelineStrategy: TeamStrategy = {
  run: ({ ctx, team, task, interrupt, teamMessages, turnLog }) =>
    runPipeline(ctx, team, task, interrupt, teamMessages, turnLog)
};
