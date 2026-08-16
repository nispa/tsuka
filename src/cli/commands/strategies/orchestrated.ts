import chalk from 'chalk';
import { CommandCtx } from '../types';
import { CLITheme } from '../../ui';
import { StreamRenderer } from '../../stream';
import { GenerationInterrupt } from '../../interrupt';
import { resolveCharacter, CharacterConfig, RoleConfig, TraitConfig } from '../../shared';
import { ChatMessage, ToolCall, ProtocolSource } from '../../../core/types';
import { TeamRunConfig, ProtocolLogEntry, TeamResult, TeamStrategy, runMemberTurn, warnProtocolDegrade } from './common';
import { sanitizeToolCallArguments } from '../../../tools/jsonRepair';
import { runRoundRobin } from './roundRobin';
import { runDiscussionRound } from './hybrid';
import { logSink } from '../../../core/logSink';

// Orchestrator prompt generator

function buildOrchestratorPrompt(
  orchestratorChar: CharacterConfig,
  roleObj: RoleConfig,
  traitObj: TraitConfig,
  members: string[],
  task: string,
  round: number,
  maxRounds: number,
  teamMessages: ChatMessage[]
): string {
  const memberDescriptions = members
    .filter((m: string) => m !== orchestratorChar.name)
    .map((m: string) => {
      const c = resolveCharacter(m);
      return c ? `- ${c.aiName} (@${c.name}): role ${c.role}, trait ${c.trait}` : `- ${m}`;
    })
    .join('\n');

  const lastTurns = teamMessages
    .filter((m) => m.role === 'assistant')
    .slice(-4)
    .map((m) => {
      const preview = typeof m.content === 'string' ? m.content.slice(0, 200) : '';
      return preview;
    })
    .join('\n---\n');

  return `You are ${orchestratorChar.aiName}, the team coordinator.

TASK: "${task}"

TEAM MEMBERS (excluding you):
${memberDescriptions}

CURRENT PROGRESS (last interventions):
${lastTurns || '(no work done yet)'}

Round ${round}/${maxRounds}.

INSTRUCTIONS: Decide which team member should work next.
Analyze progress, each member's skills, and choose who can best advance the task.

Call the 'route_next' tool with the chosen member (or "FINE" if the task is solved) and a short reason.
If for any reason you cannot call the tool, fall back to responding EXCLUSIVELY with a single line instead:
AGENTE: @member_name
or, if the task is solved:
FINE
No other text. No explanations.`;
}

function resolveMemberName(raw: string, validMembers: string[]): string | null {
  const chosen = raw.replace(/^@/, '').toLowerCase();
  if (validMembers.includes(chosen)) {
    return chosen;
  }
  for (const m of validMembers) {
    const c = resolveCharacter(m);
    if (c && c.aiName.toLowerCase() === chosen) {
      return m;
    }
  }
  return null;
}

export function parseOrchestratorDecision(content: string, validMembers: string[]): { agent: string } | null {
  const agentMatch = content.match(/AGENTE:\s*@?(\w+)/i);
  if (agentMatch) {
    const resolved = resolveMemberName(agentMatch[1], validMembers);
    if (resolved) return { agent: resolved };
  }
  return null;
}

export function hasDoneSignal(content: string): boolean {
  return /^FINE\b/im.test(content.trim());
}

/** Extracts decision from `route_next` tool call in orchestrator response. */
function extractRouteNextCall(toolCalls: ToolCall[] | undefined, validMembers: string[]): { agent: string } | 'FINE' | null {
  if (!Array.isArray(toolCalls)) return null;
  for (const tc of toolCalls) {
    if (tc?.function?.name !== 'route_next') continue;
    try {
      const raw = tc.function.arguments;
      const args = typeof raw === 'string' ? sanitizeToolCallArguments(raw).parsed : raw;
      const rawAgent = String(args?.agent || '').trim();
      if (!rawAgent) continue;
      if (/^FINE$/i.test(rawAgent)) return 'FINE';
      const resolved = resolveMemberName(rawAgent, validMembers);
      if (resolved) return { agent: resolved };
    } catch {}
  }
  return null;
}

// Orchestrated team mode (dynamic routing)

export async function runOrchestrated(
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
  const seenThisRound = new Set<string>();
  const orchestratorName = team.orchestrator;
  if (!orchestratorName) {
    CLITheme.error(`Team missing configured orchestrator. Falling back to round-robin.`);
    return runRoundRobin(ctx, team, task, maxRounds, interrupt, teamMessages, turnLog);
  }
  const workerMembers = team.members.filter((m: string) => m !== orchestratorName);
  const allMemberNames = team.members.map((m: string) => m.toLowerCase());

  const orchestratorChar = resolveCharacter(orchestratorName);
  if (!orchestratorChar) {
    CLITheme.error(`Orchestrator '${orchestratorName}' not found. Falling back to round-robin.`);
    return runRoundRobin(ctx, team, task, maxRounds, interrupt, teamMessages, turnLog);
  }
  const orchestratorRole = ctx.loadRole(orchestratorChar.role);
  const orchestratorTrait = ctx.loadTrait(orchestratorChar.trait);

  const routeNextTools = ctx.registry.listForLLM(ctx.provider.getCurrentModel(), ['route_next']);

  outer:
  for (let round = 1; round <= maxRounds; round++) {
    roundsDone = round;
    logSink.log(chalk.bold.yellow(`\n═══ ROUND ${round}/${maxRounds} (Orchestrated) ═══`));
    seenThisRound.clear();

    while (true) {
      if (interrupt.aborted) break outer;

      const orcSysPrompt = buildOrchestratorPrompt(
        orchestratorChar, orchestratorRole, orchestratorTrait,
        team.members, task, round, maxRounds, teamMessages
      );

      const orcMessages: ChatMessage[] = [{ role: 'system', content: orcSysPrompt }];
      for (let i = 1; i < teamMessages.length; i++) {
        orcMessages.push(teamMessages[i]);
      }

      logSink.log(chalk.bold.cyan(`\n[ORCHESTRATOR: ${orchestratorChar.aiName} deciding next turn]`));

      const renderer = new StreamRenderer({ headerName: orchestratorChar.aiName, headerColor: chalk.cyan });
      renderer.begin();

      let decisionText = '';
      let decisionToolCalls: ToolCall[] | undefined;
      try {
        const response = await ctx.provider.chatWithTools(
          orcMessages,
          routeNextTools.length > 0 ? routeNextTools : undefined,
          (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
          interrupt.signal
        );
        renderer.finish();
        decisionText = response.content?.trim() || '';
        decisionToolCalls = response.toolCalls;
        logSink.log('');
      } catch (err: any) {
        renderer.abort();
        if (interrupt.aborted) break outer;
        CLITheme.error(`Error in orchestrator turn: ${err.message}`);
        break;
      }

      const toolDecision = extractRouteNextCall(decisionToolCalls, allMemberNames);
      let decision: { agent: string } | null = null;
      let doneSignal = false;
      let source: ProtocolSource;

      if (toolDecision) {
        source = 'tool_call';
        if (toolDecision === 'FINE') doneSignal = true;
        else decision = toolDecision;
      } else {
        source = hasDoneSignal(decisionText) || parseOrchestratorDecision(decisionText, allMemberNames) ? 'regex' : 'fallback';
        doneSignal = hasDoneSignal(decisionText);
        decision = doneSignal ? null : parseOrchestratorDecision(decisionText, allMemberNames);
        warnProtocolDegrade('route_next', orchestratorChar.aiName, source);
      }

      turnLog?.push({
        agent: orchestratorChar.aiName,
        role: 'orchestrator',
        protocol: source,
        outcome: doneSignal ? 'FINE' : decision ? `@${decision.agent}` : 'unrecognized'
      });

      if (doneSignal) {
        logSink.log(chalk.green.bold(`\n✔ ${orchestratorChar.aiName} declared task COMPLETED.`));
        completed = true;
        break outer;
      }

      if (!decision) {
        CLITheme.warning('Orchestrator: decision unrecognized. Picking next available member.');
        let fallback = workerMembers.find((m: string) => !seenThisRound.has(m));
        if (!fallback) fallback = workerMembers[0];
        if (!fallback) {
          CLITheme.warning('No workers available.');
          break;
        }
        logSink.log(chalk.gray(`Fallback: ${fallback}\n`));
        const result = await runMemberTurn(ctx, fallback, task, round, maxRounds, teamMessages, interrupt, round === 1 && seenThisRound.size === 0, undefined, turnLog);
        if (result === 'completed') { completed = true; break outer; }
        if (result === 'failed') { failed = true; break outer; }
        if (result === 'interrupted') break outer;
        seenThisRound.add(fallback);
        continue;
      }

      const chosen = decision.agent;
      logSink.log(chalk.gray(`Chosen: @${chosen}\n`));

      // Loop detection: prevent calling same agent multiple times consecutively in a round
      if (seenThisRound.has(chosen)) {
        CLITheme.warning(`@${chosen} already called in this round. Forcing switch.`);
        const alternatives = workerMembers.filter((m: string) => !seenThisRound.has(m));
        if (alternatives.length > 0) {
          const altResult = await runMemberTurn(ctx, alternatives[0], task, round, maxRounds, teamMessages, interrupt, round === 1 && seenThisRound.size === 0, undefined, turnLog);
          if (altResult === 'completed') { completed = true; break outer; }
          if (altResult === 'failed') { failed = true; break outer; }
          if (altResult === 'interrupted') break outer;
          seenThisRound.add(alternatives[0]);
        } else {
          break;
        }
      } else {
        const result = await runMemberTurn(ctx, chosen, task, round, maxRounds, teamMessages, interrupt, round === 1 && seenThisRound.size === 0, undefined, turnLog);
        if (result === 'completed') { completed = true; break outer; }
        if (result === 'failed') { failed = true; break outer; }
        if (result === 'interrupted') break outer;
        seenThisRound.add(chosen);
      }

      if (interrupt.aborted) break outer;
    }

    if ((team.discussionRounds ?? 0) > 0 && !completed && !interrupt.aborted) {
      const discResult = await runDiscussionRound(ctx, team.members, task, round, teamMessages, interrupt, !!team.voting, turnLog);
      if (discResult === 'all_approve') { completed = true; break outer; }
      if (discResult === 'interrupted') break outer;
    }
  }

  return { completed, roundsDone, failed };
}

export const orchestratedStrategy: TeamStrategy = {
  run: ({ ctx, team, task, maxRounds, interrupt, teamMessages, turnLog }) =>
    runOrchestrated(ctx, team, task, maxRounds, interrupt, teamMessages, turnLog)
};
