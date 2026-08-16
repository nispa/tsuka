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
 * Dispatcher di `/team` (T4.2, PLANNING-QUALITA.md): carica il team JSON, sceglie la
 * `TeamStrategy` in base a `team.mode` e delega. Le 4 modalità vivono in `strategies/`
 * (roundRobin/orchestrated/pipeline/hybrid.ts); utility condivise (`runMemberTurn`,
 * protocollo di stato, seeding history) in `strategies/common.ts`. Ri-esportate qui
 * sotto per compatibilità con i chiamanti esistenti (goal.ts, tests/).
 */
export {
  runRoundRobin, runOrchestrated, runPipeline, runDiscussionRound,
  runMemberTurn, hasCompletionMarker, hasUnanimousApproval,
  parseOrchestratorDecision, hasDoneSignal
};
export type { TurnStats, ProtocolLogEntry };

// ── Entry point ──

export async function handleTeam(ctx: CommandCtx, arg: string, directTask?: string): Promise<void> {
  const availableTeams = ctx.listAvailableItems('teams', ctx.loadTeam);
  if (availableTeams.length === 0) {
    CLITheme.warning('Nessun team configurato trovato nella cartella teams/.');
    return;
  }

  let selectedTeamName = arg.toLowerCase().trim();
  if (!selectedTeamName) {
    logSink.log('');
    const selected = await InteractiveMenu.select<string>(
      'Seleziona il team collaborativo da attivare (usa le frecce):',
      availableTeams.map((t) => ({ title: `${t.displayName} - ${t.description}`, value: t.name })),
      availableTeams[0].name
    );
    if (!selected) return;
    selectedTeamName = selected;
  }

  const team = ctx.loadTeam(selectedTeamName);
  if (!team) {
    CLITheme.error(`Team '${selectedTeamName}' non trovato.`);
    return;
  }

  let task = (directTask || '').trim();
  if (!task) {
    logSink.log('');
    const taskResp = await prompts({
      type: 'text',
      name: 'task',
      message: chalk.cyan.bold('Descrivi il compito da assegnare al Team ❯'),
    });
    task = taskResp.task?.trim() || '';
  }

  if (!task) {
    CLITheme.warning('Operazione annullata: nessun compito specificato.');
    return;
  }

  return WorkflowScope.withScope('team', async () => {

  const maxRounds = ctx.configManager.getTeamMaxRounds();
  const modeLabel = team.mode === 'orchestrated' ? 'Orchestrato' : team.mode === 'pipeline' ? 'Pipeline' : 'Round-robin';
  const hybridInfo = (team.discussionRounds ?? 0) > 0 ? ` + ${team.discussionRounds} discussione/i per round` : '';
  logSink.log(chalk.bold('\n🚀 [AVVIO WORKFLOW COLLABORATIVO DI TEAM]'));
  logSink.log(`Team:        ${chalk.green(team.displayName)}`);
  logSink.log(`Modalità:    ${chalk.cyan(modeLabel)}${hybridInfo}`);
  logSink.log(`Membri:      ${team.members.map((m: string) => chalk.cyan(m)).join(', ')}`);
  if (team.orchestrator && team.mode === 'orchestrated') {
    logSink.log(`Orchestrator: ${chalk.magenta(team.orchestrator)}`);
  }
  logSink.log(`Obiettivo:   "${chalk.yellow(task)}"`);
  logSink.log(`Round max:   ${chalk.cyan(maxRounds)} (stop anticipato a compito risolto)\n`);

  // Cronologia condivisa tra tutti i membri e tutti i round
  const teamMessages: ChatMessage[] = seedTeamMessages(task);

  // Esc interrompe l'intero workflow
  const interrupt = new GenerationInterrupt();
  interrupt.arm();

  // Traccia il meccanismo di decisione (tool call/regex/fallback) di ogni turno,
  // membro/orchestrator/voto: confluisce nel workflow log (T2.1, PLANNING-QUALITA.md)
  const turnLog: ProtocolLogEntry[] = [];
  const strategy: TeamStrategy = team.mode === 'pipeline'
    ? pipelineStrategy
    : team.mode === 'orchestrated' && team.orchestrator
    ? orchestratedStrategy
    : roundRobinStrategy;

  // Blackboard del run (T6.2, TASKS.md — FASE 2): stato condiviso di QUESTO
  // workflow, letto/scritto dai membri via post_note/read_notes (runMemberTurn,
  // strategies/common.ts). Isolata dai run concorrenti via AsyncLocalStorage
  // (src/core/blackboard.ts) — stesso meccanismo di withWorkspaceOverride.
  const runId = Blackboard.newRunId();
  let completed = false, failed = false, roundsDone = 0;
  // Snapshot preso nel percorso di successo, prima che il finally liberi la
  // blackboard: se strategy.run lancia, resta [] ma non importa — l'eccezione
  // salta comunque il writeWorkflowLog qui sotto, come già faceva prima di T6.2.
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
    // La blackboard muore col run: liberata sempre, anche se strategy.run lancia
    // — non deve sopravvivere al workflow che l'ha creata.
    Blackboard.endRun(runId);
  }

  logSink.log(chalk.bold('🚀 [FINE WORKFLOW COLLABORATIVO DI TEAM]\n'));
  writeWorkflowLog({ team, task, completed, failed, roundsDone, teamMessages, turnLog, blackboard: blackboardSnapshot });

  const finalReport = completed
    ? `Il team collaborativo (${team.members.join(', ')}) ha COMPLETATO il compito: "${task}" in ${roundsDone} round.
    Puoi analizzare i file del workspace per verificare il risultato o chiedere dettagli sul processo svolto.`
    : failed
    ? `Il team collaborativo (${team.members.join(', ')}) ha dichiarato il compito FALLITO dopo ${roundsDone} round: "${task}".
    Un membro ha segnalato di non riuscire a risolverlo con i mezzi a disposizione: verifica i file del workspace e valuta se rilanciare con istruzioni diverse.`
    : `Il team collaborativo (${team.members.join(', ')}) ha lavorato ${maxRounds} round sul compito: "${task}" senza dichiararlo completato.
    Il lavoro sul workspace potrebbe essere parziale: ti consiglio di verificare i file e, se serve, rilanciare il team con istruzioni più specifiche.`;

  if (completed) {
    CLITheme.success(`Compito risolto dal team in ${roundsDone} round.`);
  } else if (failed) {
    CLITheme.error(`Il team ha dichiarato il compito FALLITO dopo ${roundsDone} round.`);
  } else {
    CLITheme.warning(`Limite di ${maxRounds} round raggiunto senza completamento dichiarato.`);
  }

  ctx.agent.current.getMessages().push({ role: 'user', content: `Lavoro di team completato per: "${task}"` });
  ctx.agent.current.getMessages().push({ role: 'assistant', content: finalReport });
  });
}
