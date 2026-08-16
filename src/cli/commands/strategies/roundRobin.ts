import chalk from 'chalk';
import { CommandCtx } from '../types';
import { GenerationInterrupt } from '../../interrupt';
import { ChatMessage } from '../../../core/types';
import { TeamRunConfig, ProtocolLogEntry, TeamResult, TeamStrategy, runMemberTurn } from './common';
import { runDiscussionRound } from './hybrid';
import { logSink } from '../../../core/logSink';

// ── Modalità round-robin (originale) ──

export async function runRoundRobin(
  ctx: CommandCtx,
  team: TeamRunConfig,
  task: string,
  maxRounds: number,
  interrupt: GenerationInterrupt,
  teamMessages: ChatMessage[],
  turnLog?: ProtocolLogEntry[]
): Promise<TeamResult> {
  let completed = false;
  let failed = false;
  let roundsDone = 0;
  const memberTurnCount = new Map<string, number>();
  const maxPerMember = team.maxRoundsPerMember ?? 0;

  outer:
  for (let round = 1; round <= maxRounds; round++) {
    roundsDone = round;
    logSink.log(chalk.bold.yellow(`\n═══ ROUND ${round}/${maxRounds} ═══`));

    for (const memberName of team.members) {
      // Limite turni per membro
      const turns = (memberTurnCount.get(memberName) ?? 0);
      if (maxPerMember > 0 && turns >= maxPerMember) {
        continue;
      }
      memberTurnCount.set(memberName, turns + 1);

      const result = await runMemberTurn(ctx, memberName, task, round, maxRounds, teamMessages, interrupt, round === 1, undefined, turnLog);
      if (result === 'completed') { completed = true; break outer; }
      if (result === 'failed') { failed = true; break outer; }
      if (result === 'interrupted') break outer;
    }

    // Discussione dopo ogni round se configurata
    if ((team.discussionRounds ?? 0) > 0 && !completed && !interrupt.aborted) {
      const discResult = await runDiscussionRound(ctx, team.members, task, round, teamMessages, interrupt, !!team.voting, turnLog);
      if (discResult === 'all_approve') { completed = true; break outer; }
      if (discResult === 'interrupted') break outer;
    }
  }

  return { completed, roundsDone, failed };
}

export const roundRobinStrategy: TeamStrategy = {
  run: ({ ctx, team, task, maxRounds, interrupt, teamMessages, turnLog }) =>
    runRoundRobin(ctx, team, task, maxRounds, interrupt, teamMessages, turnLog)
};
