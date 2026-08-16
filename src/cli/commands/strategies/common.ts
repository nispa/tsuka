import chalk from 'chalk';
import { CommandCtx } from '../types';
import { CLITheme } from '../../ui';
import { StreamRenderer } from '../../stream';
import { GenerationInterrupt } from '../../interrupt';
import { loadSystemPrompt, resolveCharacter } from '../../shared';
import { Agent, resolveReasoningEffort } from '../../../core/agent';
import { withEffortPin, logEffortDivergence } from '../../../core/effortControl';
import { setCurrentSenderName, dequeueMessages, formatPendingMessages } from '../../../core/messageQueue';
import { ContextTracker } from '../../../core/contextTracker';
import { Blackboard } from '../../../core/blackboard';
import { sanitizeToolCallArguments } from '../../../tools/jsonRepair';
import { ChatMessage, TurnOutcome, ProtocolSource, TeamConfig } from '../../../core/types';
import { logSink } from '../../../core/logSink';

/**
 * Utility condivise dalle strategie di team (T4.2, PLANNING-QUALITA.md):
 * `runMemberTurn` (esegue il turno di un membro), il protocollo di stato
 * (report_status/marker STATO:), e i tipi comuni (`TeamStrategy` e affini).
 * Ogni modalità concreta vive nel proprio file (`roundRobin.ts`, `orchestrated.ts`,
 * `pipeline.ts`, `hybrid.ts`) e importa da qui.
 */

/** Team così come lo usano le funzioni di modalità: solo `members` è obbligatorio (i test
 * costruiscono team minimi senza name/displayName/description, sempre presenti invece nei
 * team.json reali caricati da CommandCtx.loadTeam). */
export type TeamRunConfig = Partial<TeamConfig> & Pick<TeamConfig, 'members'>;

export interface TeamResult {
  completed: boolean;
  roundsDone: number;
  failed?: boolean;
}

/**
 * Bundle di parametri per l'esecuzione di una strategia di team. Le funzioni concrete
 * (runRoundRobin/runOrchestrated/runPipeline) restano esportate con la loro firma
 * posizionale storica — usata direttamente dai test T1.2/T2.1, che non vanno toccati —
 * `TeamStrategy` è l'astrazione usata dal dispatcher (`handleTeam` in team.ts) per
 * scegliere la modalità senza un if/else esplicito.
 */
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

/** Cronologia condivisa iniziale di un workflow di team. */
export function seedTeamMessages(task: string): ChatMessage[] {
  return [
    { role: 'system', content: '' },
    { role: 'user', content: `COMPITO DI GRUPPO DA RISOLVERE: "${task}"` }
  ];
}

/**
 * Rileva il protocollo di stato nei messaggi generati in un turno:
 * un membro dichiara il compito risolto scrivendo "STATO: COMPLETATO".
 * Il marker deve stare a inizio riga (come richiesto dal protocollo): una
 * semplice citazione a metà frase ("non scriverò STATO: COMPLETATO") non conta.
 * Vengono considerati solo i messaggi assistant (ignorati tool e system).
 */
export function hasCompletionMarker(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'assistant' && typeof m.content === 'string' && /(^|\n)\s*STATO:\s*COMPLETATO/i.test(m.content)
  );
}

/**
 * Riconosce una risposta testuale come chiusura LEGITTIMA di un turno di
 * membro (T9.10), anche senza tool call: un qualunque marker di stato del
 * protocollo (non solo COMPLETATO — anche DA_CONTINUARE/FALLITO sono chiusure
 * esplicite valide del turno, distinte da testo che non dichiara nulla).
 * Usata come `acceptTextOnlyIf` di Agent per distinguere "il membro ha
 * concluso con un marker testuale" (fallback sanzionato del protocollo) da
 * "il membro ha solo ragionato e non ha detto né fatto nulla" (il vicolo
 * cieco osservato in produzione con modelli locali "pensanti").
 */
export function hasAnyStatusMarker(content: string): boolean {
  return /(^|\n)\s*STATO:\s*(COMPLETATO|DA_CONTINUARE|FALLITO)/i.test(content || '');
}

// ── Protocollo a tool call (T2.1, PLANNING-QUALITA.md) ──
// Coordinamento a tool strutturate invece che a marker testuali liberi (STATO:/
// AGENTE:/VOTO:), che con modelli piccoli falliscono su grassetto markdown, spazi
// extra, nomi multi-parola ecc. Ordine di decisione, identico per i tre protocolli
// (report_status/route_next/cast_vote): tool call → regex esistente → default.
// Ogni scalino sotto 'tool_call' è una caduta di livello: segnalata in UI (riga
// gialla) e registrata in `ProtocolLogEntry` per il workflow log.

export interface ProtocolLogEntry {
  agent: string;
  role: 'member' | 'orchestrator' | 'vote';
  protocol: ProtocolSource;
  outcome: string;
}

/** Estrae l'ultima tool_call `report_status` valida tra i messaggi assistant del turno. */
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
      } catch {
        // Argomenti non parseabili: ignora questa tool_call, si ricade sulla regex
      }
    }
  }
  return null;
}

/**
 * Decide l'esito del turno di un membro con priorità: tool call `report_status`
 * → regex `STATO: COMPLETATO` esistente → default (nessun segnale, si continua).
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

/** Segnala in UI (riga gialla) una caduta di livello sotto 'tool_call'. */
export function warnProtocolDegrade(toolName: string, agentLabel: string, source: ProtocolSource): void {
  const detail = source === 'regex' ? 'uso il marker testuale (regex)' : 'nessun segnale valido, uso il default';
  CLITheme.warning(`Protocollo: '${agentLabel}' non ha usato la tool call '${toolName}' — ${detail}.`);
}

// ── Helper: esegue il turno di un singolo membro ──

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
    CLITheme.warning(`Membro del team '${memberName}' non trovato. Saltato.`);
    return 'continue';
  }

  const roleObj = ctx.loadRole(memberChar.role);
  const traitObj = ctx.loadTrait(memberChar.trait);

  // T8.10: cascata override chiamante (nessuno, qui) → personaggio → ruolo → default config.
  const cascadedEffort = resolveReasoningEffort(undefined, memberChar, roleObj, ctx.configManager.getDefaultReasoningEffort());
  // T8.14: il pin globale si applica sopra la cascata, invariata. Qui (/team e
  // /goal, che riusa runMemberTurn) la divergenza dal riferimento è SEMPRE solo
  // una riga di log — mai un prompt, a prescindere dalla modalità ask globale:
  // è il vincolo esplicito del task (un flusso a più turni non deve mai bloccarsi).
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

  // Tool di protocollo (report_status, post_note, read_notes) sempre disponibili
  // nei turni di team/goal, anche se il ruolo attivo non li elenca: qui non sono
  // tool "liberi" ma parte del protocollo di coordinamento (T2.1/T6.2), non sono
  // offerti nella chat normale.
  const memberAllowedTools = [...(roleObj.allowedTools || []), 'report_status', 'post_note', 'read_notes'];
  logEffortDivergence(memberChar.aiName, reasoningEffort, ctx.configManager.getDefaultReasoningEffort());

  const tempAgent = new Agent(
    ctx.provider,
    ctx.registry,
    ctx.permissionManager,
    sysPrompt,
    memberAllowedTools,
    ctx.configManager.getMaxHistoryMessages(),
    ctx.configManager.getMaxHistoryTokens(),
    memberChar.aiName,
    reasoningEffort,
    // T9.10: un turno di membro DEVE agire o dichiarare esplicitamente lo stato
    // (il prompt sopra lo richiede) — una risposta senza tool call E senza
    // marker di stato ottiene un nudge esplicito prima che il turno finisca.
    hasAnyStatusMarker
  );

  // Imposta il nome mittente per eventuali messaggi (tool send_message)
  setCurrentSenderName(memberChar.aiName);

  // Semina la cronologia condivisa (saltando il placeholder system)
  for (let i = 1; i < teamMessages.length; i++) {
    tempAgent.getMessages().push(teamMessages[i]);
  }

  // Inietta eventuali messaggi in attesa per questo agente
  const pending = dequeueMessages(memberChar.name);
  if (pending.length > 0) {
    const msgBlock = formatPendingMessages(pending);
    tempAgent.getMessages().push({
      role: 'user',
      content: `📨 Hai ricevuto ${pending.length === 1 ? 'un messaggio' : `${pending.length} messaggi`} dai colleghi:\n${msgBlock}`
    });
  }

  const lastSeeded = tempAgent.getMessages()[tempAgent.getMessages().length - 1];

  // Accumula le stats dell'intero turno (agent.run chiama onStats ad ogni round LLM)
  const turnStatsRef: { s: TurnStats | null } = { s: null };

  const renderer = new StreamRenderer({ headerName: memberChar.aiName });
  renderer.begin();
  try {
    const promptAttivazione = isFirstRound
      ? `Tocca a te, ${memberChar.aiName}. Lavora sul compito ed esegui i tuoi tool.`
      : `Il compito non è ancora completato (round ${round}). Riprendi da dove è arrivato il team e porta avanti il lavoro, ${memberChar.aiName}.`;
    await tempAgent.run(
      promptAttivazione,
      (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
      (stats) => { renderer.setStats(stats); turnStatsRef.s = stats as TurnStats; },
      (ev) => { renderer.onAgentEvent(ev); interrupt.rearm(); },
      interrupt.signal
    );
    if (interrupt.aborted) {
      renderer.abort();
      CLITheme.warning('Workflow di team interrotto (Esc).');
      return 'interrupted';
    }
    renderer.finish();
    logSink.log('');
  } catch (err: any) {
    renderer.abort();
    if (interrupt.aborted) {
      CLITheme.warning('Workflow di team interrotto (Esc).');
      return 'interrupted';
    }
    CLITheme.error(`Errore nel turno di ${memberChar.aiName}: ${err.message}`);
    return 'continue';
  }

  // Emette le stats cumulative del turno una sola volta (dopo la fine, non ad ogni round)
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

  // Estrae i nuovi messaggi generati dal turno
  const msgs = tempAgent.getMessages();
  const seededIdx = msgs.indexOf(lastSeeded);
  const newMessages = seededIdx >= 0 ? msgs.slice(seededIdx + 1) : msgs.slice(teamMessages.length);
  // History condensata: salva solo i messaggi assistant (sintesi finali dell'agente),
  // non i messaggi tool (output grezzi) che appesantiscono il contesto
  const condensed = newMessages.filter((m) => m.role === 'assistant');
  teamMessages.push(...(condensed.length > 0 ? condensed : newMessages.slice(-1)));
  CLITheme.printDivider();

  // Controllo del protocollo di stato: tool call report_status → regex STATO: → default
  const decision = resolveTurnStatus(newMessages);
  turnLog?.push({ agent: memberChar.aiName, role: 'member', protocol: decision.source, outcome: decision.status });
  if (decision.source !== 'tool_call') {
    warnProtocolDegrade('report_status', memberChar.aiName, decision.source);
  }

  if (decision.status === 'completed') {
    logSink.log(chalk.green.bold(`\n✔ ${memberChar.aiName} ha dichiarato il compito COMPLETATO.`));
    return 'completed';
  }
  if (decision.status === 'failed') {
    logSink.log(chalk.red.bold(`\n✘ ${memberChar.aiName} ha dichiarato il compito FALLITO.`));
    return 'failed';
  }

  return 'continue';
}
