import chalk from 'chalk';
import { CommandCtx } from '../types';
import { CLITheme } from '../../ui';
import { StreamRenderer } from '../../stream';
import { GenerationInterrupt } from '../../interrupt';
import { resolveCharacter, CharacterConfig, RoleConfig, TraitConfig } from '../../shared';
import { ChatMessage, ToolCall, ProtocolSource } from '../../../core/types';
import { TeamRunConfig, ProtocolLogEntry, TeamResult, TeamStrategy, runMemberTurn, warnProtocolDegrade } from './common';
import { runRoundRobin } from './roundRobin';
import { runDiscussionRound } from './hybrid';

// ── Helper: prompt per l'orchestrator ──

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
      return c ? `- ${c.aiName} (@${c.name}): ruolo ${c.role}, attitudine ${c.trait}` : `- ${m}`;
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

// ── Helper: parsing risposta orchestrator ──

/** Risolve un nome "grezzo" (nome tecnico o aiName, @ opzionale) al nome tecnico del membro, se valido. */
function resolveMemberName(raw: string, validMembers: string[]): string | null {
  const chosen = raw.replace(/^@/, '').toLowerCase();
  if (validMembers.includes(chosen)) {
    return chosen;
  }
  // Fallback: cerca per aiName
  for (const m of validMembers) {
    const c = resolveCharacter(m);
    if (c && c.aiName.toLowerCase() === chosen) {
      return m;
    }
  }
  return null;
}

export function parseOrchestratorDecision(content: string, validMembers: string[]): { agent: string } | null {
  // Cerca AGENTE: @nome
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

/** Estrae la decisione da una eventuale tool_call `route_next` nella risposta dell'orchestrator. */
function extractRouteNextCall(toolCalls: ToolCall[] | undefined, validMembers: string[]): { agent: string } | 'FINE' | null {
  if (!Array.isArray(toolCalls)) return null;
  for (const tc of toolCalls) {
    if (tc?.function?.name !== 'route_next') continue;
    try {
      const raw = tc.function.arguments;
      const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const rawAgent = String(args?.agent || '').trim();
      if (!rawAgent) continue;
      if (/^FINE$/i.test(rawAgent)) return 'FINE';
      const resolved = resolveMemberName(rawAgent, validMembers);
      if (resolved) return { agent: resolved };
    } catch {
      // Argomenti non parseabili: ignora, si ricade sulla regex
    }
  }
  return null;
}

// ── Modalità orchestrata (routing dinamico) ──

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
    CLITheme.error(`Team senza orchestrator configurato. Passaggio a modalità round-robin.`);
    return runRoundRobin(ctx, team, task, maxRounds, interrupt, teamMessages, turnLog);
  }
  const workerMembers = team.members.filter((m: string) => m !== orchestratorName);
  const allMemberNames = team.members.map((m: string) => m.toLowerCase());

  const orchestratorChar = resolveCharacter(orchestratorName);
  if (!orchestratorChar) {
    CLITheme.error(`Orchestrator '${orchestratorName}' non trovato. Passaggio a modalità round-robin.`);
    return runRoundRobin(ctx, team, task, maxRounds, interrupt, teamMessages, turnLog);
  }
  const orchestratorRole = ctx.loadRole(orchestratorChar.role);
  const orchestratorTrait = ctx.loadTrait(orchestratorChar.trait);

  // L'orchestrator usa solo tool di diagnostica (nessuna scrittura/esecuzione)
  const orchestratorTools = (orchestratorRole.allowedTools || []).filter((t: string) =>
    ['read_file', 'list_dir', 'grep_search', 'get_ps_info', 'web_search', 'browse_url', 'recall_memory'].includes(t)
  );
  // Tool di protocollo (T2.1): route_next è l'unico tool offerto nella chiamata di
  // routing, indipendentemente dal ruolo — non è un tool "libero" dell'orchestrator.
  const routeNextTools = ctx.registry.listForLLM(ctx.provider.getCurrentModel(), ['route_next']);

  outer:
  for (let round = 1; round <= maxRounds; round++) {
    roundsDone = round;
    console.log(chalk.bold.yellow(`\n═══ ROUND ${round}/${maxRounds} (Orchestrato) ═══`));
    seenThisRound.clear();

    while (true) {
      if (interrupt.aborted) break outer;

      // Costruisce prompt per l'orchestrator
      const orcSysPrompt = buildOrchestratorPrompt(
        orchestratorChar, orchestratorRole, orchestratorTrait,
        team.members, task, round, maxRounds, teamMessages
      );

      // Crea un agente orchestrator (history condivisa + prompt di coordinamento)
      const orcMessages: ChatMessage[] = [{ role: 'system', content: orcSysPrompt }];
      for (let i = 1; i < teamMessages.length; i++) {
        orcMessages.push(teamMessages[i]);
      }

      console.log(chalk.bold.cyan(`\n[ORCHESTRATOR: ${orchestratorChar.aiName} decide il prossimo turno]`));

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
        console.log();
      } catch (err: any) {
        renderer.abort();
        if (interrupt.aborted) break outer;
        CLITheme.error(`Errore nell'orchestrator: ${err.message}`);
        break; // passa al round successivo
      }

      // Decisione: tool call route_next → regex AGENTE:/FINE esistente → default
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
        outcome: doneSignal ? 'FINE' : decision ? `@${decision.agent}` : 'non riconosciuto'
      });

      if (doneSignal) {
        console.log(chalk.green.bold(`\n✔ ${orchestratorChar.aiName} ha dichiarato il compito COMPLETATO.`));
        completed = true;
        break outer;
      }

      if (!decision) {
        CLITheme.warning('Orchestrator: risposta non riconosciuta. Prossimo membro in ordine.');
        // Fallback: sceglie il primo worker non ancora chiamato in questo round
        let fallback = workerMembers.find((m: string) => !seenThisRound.has(m));
        if (!fallback) fallback = workerMembers[0];
        if (!fallback) {
          CLITheme.warning('Nessun worker disponibile.');
          break;
        }
        console.log(chalk.gray(`Fallback: ${fallback}\n`));
        const result = await runMemberTurn(ctx, fallback, task, round, maxRounds, teamMessages, interrupt, round === 1 && seenThisRound.size === 0, undefined, turnLog);
        if (result === 'completed') { completed = true; break outer; }
        if (result === 'failed') { failed = true; break outer; }
        if (result === 'interrupted') break outer;
        seenThisRound.add(fallback);
        continue;
      }

      const chosen = decision.agent;
      console.log(chalk.gray(`Scelto: @${chosen}\n`));

      // Loop detection: stesso agente due volte di fila
      if (seenThisRound.has(chosen)) {
        CLITheme.warning(`@${chosen} già chiamato in questo round. Forzo cambio.`);
        const alternatives = workerMembers.filter((m: string) => !seenThisRound.has(m));
        if (alternatives.length > 0) {
          const altResult = await runMemberTurn(ctx, alternatives[0], task, round, maxRounds, teamMessages, interrupt, round === 1 && seenThisRound.size === 0, undefined, turnLog);
          if (altResult === 'completed') { completed = true; break outer; }
          if (altResult === 'failed') { failed = true; break outer; }
          if (altResult === 'interrupted') break outer;
          seenThisRound.add(alternatives[0]);
        } else {
          break; // tutti chiamati, passa al round successivo
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

    // Discussione dopo ogni round se configurata
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
