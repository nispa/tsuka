import chalk from 'chalk';
import { CommandCtx } from '../types';
import { CLITheme } from '../../ui';
import { StreamRenderer } from '../../stream';
import { GenerationInterrupt } from '../../interrupt';
import { loadSystemPrompt, resolveCharacter } from '../../shared';
import { ChatMessage, ToolCall, Vote } from '../../../core/types';
import { ProtocolLogEntry, warnProtocolDegrade } from './common';
import { sanitizeToolCallArguments } from '../../../tools/jsonRepair';

/**
 * Modalità ibrida (T4.2, PLANNING-QUALITA.md): non è un `mode` a sé — è un round di
 * discussione stile `/call` (senza tool) che roundRobin.ts/orchestrated.ts inseriscono
 * dopo ogni round quando il team ha `discussionRounds > 0`. Con `voting: true` include
 * anche il voto (`cast_vote` o marker `VOTO:`).
 */

/** Estrae il voto da una eventuale tool_call `cast_vote` nella risposta del round di discussione. */
function extractCastVoteCall(toolCalls?: ToolCall[]): Vote | null {
  if (!Array.isArray(toolCalls)) return null;
  for (const tc of toolCalls) {
    if (tc?.function?.name !== 'cast_vote') continue;
    try {
      const raw = tc.function.arguments;
      const args = typeof raw === 'string' ? sanitizeToolCallArguments(raw).parsed : raw;
      const vote = String(args?.vote || '').trim().toUpperCase();
      if (vote === 'APPROVO' || vote === 'MODIFICARE' || vote === 'RIFIUTO') {
        return vote as Vote;
      }
    } catch {
      // Argomenti non parseabili: ignora, si ricade sulla regex
    }
  }
  return null;
}

// ── Helper: turno di discussione (stile /call, senza tool) ──
// Se voting è attivo, la discussione include anche il voto alla fine

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
  console.log(chalk.bold.magenta(`\n═══ DISCUSSIONE ROUND ${round} ═══`));

  let allApproved = true;
  // Tool cast_vote offerto solo quando il voto è attivo: nella discussione senza
  // voting non ci sono tool disponibili (resta "solo la voce" del personaggio).
  const voteTools = votingEnabled ? ctx.registry.listForLLM(ctx.provider.getCurrentModel(), ['cast_vote']) : [];

  for (const memberName of members) {
    if (interrupt.aborted) return 'interrupted';

    const memberChar = resolveCharacter(memberName);
    if (!memberChar) continue;

    const roleObj = ctx.loadRole(memberChar.role);
    const traitObj = ctx.loadTrait(memberChar.trait);

    let sysPrompt = loadSystemPrompt(roleObj, traitObj, ctx.provider.getCurrentModel(), ctx.registry, memberChar, task);
    sysPrompt += `\n\n[DISCUSSION CONTEXT]: You are in a team discussion on: "${task}".
You are debating with colleagues about the work done so far (round ${round}). Express your opinion, constructive criticism or suggestions.
Keep it brief (max 4 sentences) and true to your identity and style.
No tools available — just your voice.`;

    if (votingEnabled) {
      sysPrompt += `\n\nAt the end, cast your vote by calling the 'cast_vote' tool with your vote and a reason.
If for any reason you cannot call the tool, fall back to writing it on a separate line in this exact format instead:
- VOTO: APPROVO — if work is satisfactory;
- VOTO: MODIFICARE — if changes are needed (specify what);
- VOTO: RIFIUTO — if work is wrong and must be redone.

Example:
"...analysis comment... I think the configuration is correct but tests are missing."
VOTO: MODIFICARE — Add unit tests before deploy`;
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
        interrupt.signal
      );
      toolCalls = response.toolCalls;
      renderer.finish();
      console.log();
    } catch (err: any) {
      renderer.abort();
      console.log(chalk.red(`[Errore discussione ${memberChar.aiName}: ${err.message}]`));
      continue;
    }

    const responseText = renderer.getFullText().trim();
    if (responseText) {
      teamMessages.push({ role: 'user', content: `${memberChar.aiName}: "${responseText}"` });
    }

    // Controllo voto se voting attivo: tool call cast_vote → regex VOTO: → nessun voto rilevato
    if (votingEnabled) {
      const toolVote = extractCastVoteCall(toolCalls);
      if (toolVote) {
        turnLog?.push({ agent: memberChar.aiName, role: 'vote', protocol: 'tool_call', outcome: toolVote });
        if (toolVote !== 'APPROVO') allApproved = false;
      } else if (responseText) {
        const voteMatch = responseText.match(/VOTO:\s*(APPROVO|MODIFICARE|RIFIUTO)/i);
        if (voteMatch) {
          const vote = voteMatch[1].toUpperCase();
          turnLog?.push({ agent: memberChar.aiName, role: 'vote', protocol: 'regex', outcome: vote });
          warnProtocolDegrade('cast_vote', memberChar.aiName, 'regex');
          if (vote !== 'APPROVO') {
            allApproved = false;
          }
        } else {
          turnLog?.push({ agent: memberChar.aiName, role: 'vote', protocol: 'fallback', outcome: 'nessun voto rilevato' });
          warnProtocolDegrade('cast_vote', memberChar.aiName, 'fallback');
        }
      }
    }
  }

  if (votingEnabled) {
    if (allApproved) {
      console.log(chalk.green.bold(`\n✔ VOTAZIONE: tutti i membri approvano il lavoro.`));
      return 'all_approve';
    } else {
      console.log(chalk.yellow(`\n⚠ VOTAZIONE: alcuni membri richiedono modifiche o rifiutano. Si procede.`));
    }
  }

  return 'continue';
}

/** Cerca nelle discussioni i voti e ritorna true se tutti approvano */
export function hasUnanimousApproval(messages: ChatMessage[]): boolean {
  const votingMessages = messages.filter(
    (m) => m.role === 'user' && /VOTO:\s*(APPROVO|MODIFICARE|RIFIUTO)/i.test(m.content || '')
  );
  if (votingMessages.length === 0) return false;
  return votingMessages.every(
    (m) => /VOTO:\s*APPROVO/i.test(m.content || '')
  );
}
