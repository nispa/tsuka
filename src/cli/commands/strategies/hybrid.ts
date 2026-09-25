import chalk from 'chalk';
import { CommandCtx } from '../types';
import { StreamRenderer } from '../../stream';
import { GenerationInterrupt } from '../../interrupt';
import { loadSystemPrompt, resolveCharacter } from '../../shared';
import { resolveReasoningEffort } from '../../../core/agent';
import { withEffortPin } from '../../../core/effortControl';
import { ChatMessage, ToolCall, Vote } from '../../../core/types';
import { ProtocolLogEntry, warnProtocolDegrade } from './common';
import { sanitizeToolCallArguments } from '../../../tools/jsonRepair';
import { logSink } from '../../../core/logSink';
import { VOTES } from '../../../core/protocolTokens';

// Text-marker fallback of cast_vote, built from the shared vocabulary (T14.25).
const VOTE_MARKER_RE = new RegExp(`VOTE:\\s*(${VOTES.join('|')})`, 'i');

/**
 * Hybrid team mode: discussion round (/call style, no tools) inserted
 * after each work round when discussionRounds > 0.
 */

/** Extracts vote from `cast_vote` tool call in discussion round. */
function extractCastVoteCall(toolCalls?: ToolCall[]): Vote | null {
  if (!Array.isArray(toolCalls)) return null;
  for (const tc of toolCalls) {
    if (tc?.function?.name !== 'cast_vote') continue;
    try {
      const raw = tc.function.arguments;
      const args = typeof raw === 'string' ? sanitizeToolCallArguments(raw).parsed : raw;
      const vote = String(args?.vote || '').trim().toUpperCase() as Vote;
      if (VOTES.includes(vote)) {
        return vote;
      }
    } catch {}
  }
  return null;
}

export async function runDiscussionRound(
  ctx: CommandCtx,
  members: string[],
  task: string,
  round: number,
  teamMessages: ChatMessage[],
  interrupt: GenerationInterrupt,
  votingEnabled: boolean,
  turnLog?: ProtocolLogEntry[]
): Promise<'all_approve' | 'continue' | 'interrupted'> {
  logSink.log(chalk.bold.magenta(`\n═══ DISCUSSION ROUND ${round} ═══`));

  let allApproved = true;
  const voteTools = votingEnabled
    ? ctx.registry.listForLLM(
        ctx.provider.getCurrentModel(),
        ['cast_vote'],
        undefined,
        ctx.provider.getBaseUrl(),
        ctx.provider.getProviderClass?.()
      )
    : [];

  for (const memberName of members) {
    if (interrupt.aborted) return 'interrupted';

    const memberChar = resolveCharacter(memberName);
    if (!memberChar) continue;

    const roleObj = ctx.loadRole(memberChar.role);
    const traitObj = ctx.loadTrait(memberChar.trait);

    const cascadedEffort = resolveReasoningEffort(undefined, memberChar, roleObj, ctx.configManager.getDefaultReasoningEffort());
    const reasoningEffort = withEffortPin(cascadedEffort);

    // No registry on purpose: a discussion turn only ever gets `cast_vote`, and the prompt below
    // says so explicitly — listing the role's tools here would contradict it.
    let sysPrompt = loadSystemPrompt(roleObj, traitObj, ctx.provider.getCurrentModel(), undefined, memberChar, task, reasoningEffort);
    sysPrompt += `\n\n[DISCUSSION CONTEXT]: You are in a team discussion on: "${task}".
You are debating with colleagues about the work done so far (round ${round}). Express your opinion, constructive criticism or suggestions.
Keep it brief (max 4 sentences) and true to your identity and style.
No tools available — just your voice.`;

    if (votingEnabled) {
      sysPrompt += `\n\nAt the end, cast your vote by calling the 'cast_vote' tool with your vote and a reason.
If for any reason you cannot call the tool, fall back to writing it on a separate line in this exact format instead (fixed English protocol tokens: never translate them, whatever language you are replying in):
- VOTE: APPROVE — if work is satisfactory;
- VOTE: REVISE — if changes are needed (specify what);
- VOTE: REJECT — if work is wrong and must be redone.

Example:
"...analysis comment... I think the configuration is correct but tests are missing."
VOTE: REVISE — Add unit tests before deploy`;
    }

    const discMessages: ChatMessage[] = [{ role: 'system', content: sysPrompt }];
    for (let i = 1; i < teamMessages.length; i++) {
      discMessages.push(teamMessages[i]);
    }

    const renderer = new StreamRenderer({ headerName: memberChar.aiName, headerColor: chalk.magenta });
    renderer.begin();
    let toolCalls: ToolCall[] | undefined;
    try {
      const response = await ctx.provider.chatWithTools(
        discMessages,
        voteTools.length > 0 ? voteTools : [],
        (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
        interrupt.signal,
        { reasoningEffort }
      );
      toolCalls = response.toolCalls;
      renderer.finish();
      logSink.log('');
    } catch (err: any) {
      renderer.abort();
      logSink.log(chalk.red(`[Discussion error for ${memberChar.aiName}: ${err.message}]`));
      continue;
    }

    const responseText = renderer.getFullText().trim();
    if (responseText) {
      teamMessages.push({ role: 'user', content: `${memberChar.aiName}: "${responseText}"` });
    }

    if (votingEnabled) {
      const toolVote = extractCastVoteCall(toolCalls);
      if (toolVote) {
        turnLog?.push({ agent: memberChar.aiName, role: 'vote', protocol: 'tool_call', outcome: toolVote });
        if (toolVote !== 'APPROVE') allApproved = false;
      } else if (responseText) {
        const voteMatch = responseText.match(VOTE_MARKER_RE);
        if (voteMatch) {
          const vote = voteMatch[1].toUpperCase();
          turnLog?.push({ agent: memberChar.aiName, role: 'vote', protocol: 'regex', outcome: vote });
          warnProtocolDegrade('cast_vote', memberChar.aiName, 'regex');
          if (vote !== 'APPROVE') {
            allApproved = false;
          }
        } else {
          turnLog?.push({ agent: memberChar.aiName, role: 'vote', protocol: 'fallback', outcome: 'no vote detected' });
          warnProtocolDegrade('cast_vote', memberChar.aiName, 'fallback');
        }
      }
    }
  }

  if (votingEnabled) {
    if (allApproved) {
      logSink.log(chalk.green.bold(`\n✔ VOTE: all members approve the work.`));
      return 'all_approve';
    } else {
      logSink.log(chalk.yellow(`\n⚠ VOTE: some members requested modifications or rejected. Continuing.`));
    }
  }

  return 'continue';
}

/** Checks whether all votes in messages are approvals */
export function hasUnanimousApproval(messages: ChatMessage[]): boolean {
  const votingMessages = messages.filter(
    (m) => m.role === 'user' && VOTE_MARKER_RE.test(m.content || '')
  );
  if (votingMessages.length === 0) return false;
  return votingMessages.every(
    (m) => (m.content || '').match(VOTE_MARKER_RE)?.[1].toUpperCase() === 'APPROVE'
  );
}
