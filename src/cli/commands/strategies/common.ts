import chalk from 'chalk';
import { CommandCtx } from '../types';
import { CLITheme } from '../../ui';
import { StreamRenderer } from '../../stream';
import { GenerationInterrupt } from '../../interrupt';
import { loadSystemPrompt, resolveCharacter } from '../../shared';
import { Agent, resolveReasoningEffort } from '../../../core/agent';
import { resolveToolSet } from '../../../core/toolSet';
import { withEffortPin, logEffortDivergence } from '../../../core/effortControl';
import { setCurrentSenderName, dequeueMessages, formatPendingMessages } from '../../../core/messageQueue';
import { ContextTracker } from '../../../core/contextTracker';
import { sanitizeToolCallArguments } from '../../../tools/jsonRepair';
import { ChatMessage, TurnOutcome, ProtocolSource, TeamConfig } from '../../../core/types';
import { logSink } from '../../../core/logSink';

/**
 * Shared team strategy utilities (T4.2):
 * `runMemberTurn`, status protocol resolution (report_status/STATO: marker),
 * and shared strategy types (`TeamStrategy`, `TeamResult`).
 */

export type TeamRunConfig = Partial<TeamConfig> & Pick<TeamConfig, 'members'>;

export interface TeamResult {
  completed: boolean;
  roundsDone: number;
  failed?: boolean;
}

export interface TeamRunArgs {
  ctx: CommandCtx;
  team: TeamRunConfig;
  task: string;
  maxRounds: number;
  interrupt: GenerationInterrupt;
  teamMessages: ChatMessage[];
  turnLog?: ProtocolLogEntry[];
}

export interface TeamStrategy {
  run(args: TeamRunArgs): Promise<TeamResult>;
}

/** Initial shared history for a team workflow. */
export function seedTeamMessages(task: string): ChatMessage[] {
  return [
    { role: 'system', content: '' },
    { role: 'user', content: `GROUP TASK TO SOLVE: "${task}"` }
  ];
}

/**
 * Checks for completion status marker across generated messages in a turn.
 */
export function hasCompletionMarker(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'assistant' && typeof m.content === 'string' && /(^|\n)\s*STATO:\s*COMPLETATO/i.test(m.content)
  );
}

/**
 * Accepts text-only assistant response if it declares any valid protocol status marker.
 */
export function hasAnyStatusMarker(content: string): boolean {
  return /(^|\n)\s*STATO:\s*(COMPLETATO|DA_CONTINUARE|FALLITO)/i.test(content || '');
}

export interface ProtocolLogEntry {
  agent: string;
  role: 'member' | 'orchestrator' | 'vote';
  protocol: ProtocolSource;
  outcome: string;
}

/** Extracts last valid `report_status` tool_call from assistant messages. */
function extractReportStatusCall(messages: ChatMessage[]): { status: string; summary: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      if (tc?.function?.name !== 'report_status') continue;
      try {
        const raw = tc.function.arguments;
        const args = typeof raw === 'string' ? sanitizeToolCallArguments(raw).parsed : raw;
        const status = String(args?.status || '').trim().toUpperCase();
        if (status === 'COMPLETATO' || status === 'DA_CONTINUARE' || status === 'FALLITO') {
          return { status, summary: String(args?.summary || '') };
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Resolves member turn outcome: tool_call report_status -> regex STATO: -> default (continue).
 */
function resolveTurnStatus(messages: ChatMessage[]): { status: 'completed' | 'failed' | 'continue'; source: ProtocolSource } {
  const toolCall = extractReportStatusCall(messages);
  if (toolCall) {
    const status = toolCall.status === 'COMPLETATO' ? 'completed' : toolCall.status === 'FALLITO' ? 'failed' : 'continue';
    return { status, source: 'tool_call' };
  }
  if (hasCompletionMarker(messages)) {
    return { status: 'completed', source: 'regex' };
  }
  return { status: 'continue', source: 'fallback' };
}

/** Warns in UI about protocol degradation below tool_call level. */
export function warnProtocolDegrade(toolName: string, agentLabel: string, source: ProtocolSource): void {
  const detail = source === 'regex' ? 'using text marker regex' : 'no valid signal, falling back to default';
  CLITheme.warning(`Protocol: '${agentLabel}' did not invoke '${toolName}' — ${detail}.`);
}

export interface TurnStats {
  durationMs: number;
  tokenCount: number;
  tokensPerSecond: number;
  promptTokens: number;
  totalTokens: number;
}

export async function runMemberTurn(
  ctx: CommandCtx,
  memberName: string,
  task: string,
  round: number,
  maxRounds: number,
  teamMessages: ChatMessage[],
  interrupt: GenerationInterrupt,
  isFirstRound: boolean,
  onTurnStats?: (stats: TurnStats) => void,
  turnLog?: ProtocolLogEntry[]
): Promise<TurnOutcome> {
  const memberChar = resolveCharacter(memberName);
  if (!memberChar) {
    CLITheme.warning(`Team member '${memberName}' not found. Skipped.`);
    return 'continue';
  }

  const roleObj = ctx.loadRole(memberChar.role);
  const traitObj = ctx.loadTrait(memberChar.trait);

  const cascadedEffort = resolveReasoningEffort(undefined, memberChar, roleObj, ctx.configManager.getDefaultReasoningEffort());
  const reasoningEffort = withEffortPin(cascadedEffort);

  let sysPrompt = loadSystemPrompt(roleObj, traitObj, ctx.provider.getCurrentModel(), ctx.registry, memberChar, task, reasoningEffort);
  sysPrompt += `\n\n[COLLABORATIVE CONTEXT]: You are working on a team task: "${task}".
    This is your active work turn (round ${round}/${maxRounds}). Analyze the task and what previous colleagues did (inspect workspace files and history if needed).
    Use your tools (read, write, edit, search, commands) to advance or complete the work YOURSELF. 'spawn_agent' is for splitting off an INDEPENDENT sub-task while you keep working on the rest — never for handing off this entire assigned task verbatim: that is not delegation, it is skipping your turn. If spawn_agent rejects your call for being too long, that is a signal to do the work directly, not to retry the same call.
    After execution, write a text summary explaining what you did and what the next colleague should do (if applicable). Stay faithful to your personality.

WORK STATUS PROTOCOL (mandatory): ALWAYS end your intervention by calling the 'report_status' tool with your status, a summary, and (if useful) a hint for the next colleague. If for any reason you cannot call the tool, fall back to writing exactly one of these lines instead:
- "STATO: COMPLETATO" — only if the group task is definitively solved and no more work turns are needed;
- "STATO: DA_CONTINUARE" — if more work is needed from you or colleagues;
- "STATO: FALLITO" — if the task cannot be solved with the means available.
Do NOT declare COMPLETATO unless you have concretely verified (with tools) that the work is finished.
Do NOT declare FALLITO just because the blackboard or a tool call was empty/unhelpful: your task is the one stated above, not whatever the blackboard contains. Only use FALLITO when you attempted the actual work with your tools and it could not be done.

SHARED BLACKBOARD (optional): this run has a shared blackboard, separate from the message history. Use 'read_notes' at the start of your turn to see decisions, artifacts or open points colleagues left for THIS run, and 'post_note' to leave your own before finishing — it is NOT persistent memory, it disappears when the run ends. An EMPTY blackboard is normal (e.g. you are the first to work, or no shared context was needed) — it is not a reason to skip your task.`;

  const toolSet = resolveToolSet(roleObj, { alwaysActive: ['report_status', 'post_note', 'read_notes'] });
  logEffortDivergence(memberChar.aiName, reasoningEffort, ctx.configManager.getDefaultReasoningEffort());

  const tempAgent = new Agent(
    ctx.provider,
    ctx.registry,
    ctx.permissionManager,
    sysPrompt,
    toolSet.active,
    ctx.configManager.getMaxHistoryMessages(),
    ctx.configManager.getMaxHistoryTokens(),
    memberChar.aiName,
    reasoningEffort,
    hasAnyStatusMarker,
    ctx.configManager.getMaxToolRounds()
  );
  tempAgent.setDeferredTools(toolSet.deferred);

  setCurrentSenderName(memberChar.aiName);

  for (let i = 1; i < teamMessages.length; i++) {
    tempAgent.getMessages().push(teamMessages[i]);
  }

  const pending = dequeueMessages(memberChar.name);
  if (pending.length > 0) {
    const msgBlock = formatPendingMessages(pending);
    tempAgent.getMessages().push({
      role: 'user',
      content: `📨 You received ${pending.length === 1 ? 'a message' : `${pending.length} messages`} from colleagues:\n${msgBlock}`
    });
  }

  const lastSeeded = tempAgent.getMessages()[tempAgent.getMessages().length - 1];
  const turnStatsRef: { s: TurnStats | null } = { s: null };

  const renderer = new StreamRenderer({ headerName: memberChar.aiName });
  renderer.begin();
  try {
    const activationPrompt = isFirstRound
      ? `Your turn, ${memberChar.aiName}. Work on the task and invoke your tools.`
      : `Task is still in progress (round ${round}). Continue from where the team left off, ${memberChar.aiName}.`;
    await tempAgent.run(
      activationPrompt,
      (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
      (stats) => { renderer.setStats(stats); turnStatsRef.s = stats as TurnStats; },
      (ev) => { renderer.onAgentEvent(ev); interrupt.rearm(); },
      interrupt.signal
    );
    if (interrupt.aborted) {
      renderer.abort();
      CLITheme.warning('Team workflow interrupted (Esc).');
      return 'interrupted';
    }
    renderer.finish();
    logSink.log('');
  } catch (err: any) {
    renderer.abort();
    if (interrupt.aborted) {
      CLITheme.warning('Team workflow interrupted (Esc).');
      return 'interrupted';
    }
    CLITheme.error(`Error in turn for ${memberChar.aiName}: ${err.message}`);
    return 'continue';
  }

  if (turnStatsRef.s) {
    onTurnStats?.(turnStatsRef.s);
    ContextTracker.getInstance().addEntry({
      timestamp: new Date().toISOString(),
      agentName: memberChar.aiName,
      tokenCount: turnStatsRef.s.tokenCount,
      promptTokens: turnStatsRef.s.promptTokens,
      action: task.length > 60 ? task.slice(0, 60) + '…' : task
    });
  }

  const msgs = tempAgent.getMessages();
  const seededIdx = msgs.indexOf(lastSeeded);
  const newMessages = seededIdx >= 0 ? msgs.slice(seededIdx + 1) : msgs.slice(teamMessages.length);
  const condensed = newMessages.filter((m) => m.role === 'assistant');
  teamMessages.push(...(condensed.length > 0 ? condensed : newMessages.slice(-1)));
  CLITheme.printDivider();

  const decision = resolveTurnStatus(newMessages);
  turnLog?.push({ agent: memberChar.aiName, role: 'member', protocol: decision.source, outcome: decision.status });
  if (decision.source !== 'tool_call') {
    warnProtocolDegrade('report_status', memberChar.aiName, decision.source);
  }

  if (decision.status === 'completed') {
    logSink.log(chalk.green.bold(`\n✔ ${memberChar.aiName} declared task COMPLETED.`));
    return 'completed';
  }
  if (decision.status === 'failed') {
    logSink.log(chalk.red.bold(`\n✘ ${memberChar.aiName} declared task FAILED.`));
    return 'failed';
  }

  return 'continue';
}
