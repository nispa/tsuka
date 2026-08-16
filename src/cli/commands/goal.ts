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

// Re-esportati per retrocompatibilità: buona parte dei test importa questi nomi
// direttamente da './goal' (era tutto in un unico file prima dello split T12.3).
export { formatAgentSignature, buildTeamBlueprints, buildGoalOrchestratorPrompt } from './goalPrompts';
export { parsePlan, parseAgentLine } from './goalParsing';

function getCharDisplayName(allCharacters: CharacterConfig[], agentName: string): string {
  const char = allCharacters.find((c) => c.name === agentName);
  return char ? char.aiName : agentName;
}

/**
 * Salva un fact in memoria e accorcia l'ultimo assistant message se molto lungo.
 * Mantiene un summary significativo (non un one-liner) così gli agenti successivi
 * sanno cosa è stato fatto e quali file sono stati creati/modificati.
 */
function condenseAgentOutput(agentName: string, teamMessages: ChatMessage[], allCharacters: CharacterConfig[], maxTokens: number): void {
  const displayName = getCharDisplayName(allCharacters, agentName);
  const before = estimateMessagesTokens(teamMessages);
  const MAX_KEEP = 1500; // caratteri da mantenere nell'assistant message
  for (let i = teamMessages.length - 1; i >= 0; i--) {
    const msg = teamMessages[i];
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      const full = msg.content;
      // Salva sempre il fact in memoria per recall
      MemoryStore.getInstance().addFact(`[Goal] ${displayName}: ${full.replace(/\s+/g, ' ').slice(0, 300).trim()}`, 'goal_orchestrator', { kind: 'run' });
      // Solo se il messaggio è molto lungo lo accorciamo, mantenendo il summary
      if (full.length > MAX_KEEP) {
        const kept = full.slice(0, MAX_KEEP).trim();
        msg.content = `${kept}\n\n[... output accorciato. Dettagli completi: recall_memory "Goal ${displayName}"]`;
      }
      // Se è corto enough, lo lasciamo intero — l'agente successivo ha bisogno del contesto
      break;
    }
  }
  const after = estimateMessagesTokens(teamMessages);
  const saved = before - after;
  if (saved > 0) {
    const pct = maxTokens > 0 ? Math.round((after / maxTokens) * 100) : 0;
    const savedStr = saved >= 1000 ? `${(saved / 1000).toFixed(1)}k` : `${saved}`;
    logSink.log(chalk.gray(`  💾 Contesto compresso: risparmiati ~${savedStr} tok (ora ~${after.toLocaleString()} tot, ${pct}% del limite)`));
  }
  CLITheme.contextBar(after, maxTokens, 'Contesto history:');
}

export async function handleGoal(ctx: CommandCtx, arg: string): Promise<void> {
  const goal = arg.trim();
  if (!goal) {
    CLITheme.error('Specifica un obiettivo. Es: /goal "Crea un sito web e deployalo"');
    return;
  }

  return WorkflowScope.withScope('goal', async () => {
    const allCharacters = ctx.listAvailableCharacters();
    if (allCharacters.length === 0) {
      CLITheme.warning('Nessun personaggio disponibile. Usa /character per crearne uno.');
      return;
    }

  const validNames = allCharacters.map((c) => c.name.toLowerCase());

  logSink.log(chalk.bold('\n🎯 [GOAL ORCHESTRATOR]'));
  logSink.log(`Obiettivo:  "${chalk.yellow(goal)}"`);
  logSink.log(`Agenti disp: ${allCharacters.map((c) => chalk.cyan(`@${c.name}`)).join(', ')}\n`);

  // Prompt per l'orchestrator
  const sysPrompt = buildGoalOrchestratorPrompt(allCharacters, goal);
  const orcMessages: ChatMessage[] = [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: `Pianifica il team per: "${goal}"` }
  ];

  const interrupt = new GenerationInterrupt();
  interrupt.arm();

  logSink.log(chalk.bold.cyan('[ORCHESTRATOR] Analisi del goal e pianificazione team...\n'));

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
    if (interrupt.aborted) { CLITheme.warning('Goal interrotto (Esc).'); interrupt.disarm(); return; }
    CLITheme.error(`Errore nell'orchestrator: ${err.message}`);
    interrupt.disarm();
    return;
  }

  // Se l'orchestrator dice solo FINE (senza AGENTE:), il goal non richiede team
  if (!/AGENTE:/i.test(planText) && /^FINE\b/im.test(planText)) {
    CLITheme.info('L\'orchestrator ritiene che questo goal non richieda un team dedicato.');
    CLITheme.info('Puoi continuare la conversazione con l\'agente predefinito.\n');
    interrupt.disarm();
    return;
  }

  // Parsing del piano in gruppi (T9.10: il parallelismo è disattivato di default —
  // vedi ConfigManager.isParallelExecutionEnabled)
  const { groups, flatSteps } = parsePlan(planText, allCharacters, ctx.configManager.isParallelExecutionEnabled());

  if (groups.length === 0) {
    CLITheme.warning('Nessun formato AGENTE: riconosciuto direttamente nel piano. Recupero agenti menzionati...');
    
    // Tentativo 1: Cerca personaggi menzionati nel testo della risposta
    const mentionedNames = new Set<string>();
    for (const c of allCharacters) {
      const pattern = new RegExp(`@?\\b${c.name.replace(/_/g, '[_\\s-]?')}\\b`, 'i');
      if (pattern.test(planText)) {
        mentionedNames.add(c.name);
      }
    }

    if (mentionedNames.size > 0) {
      for (const name of mentionedNames) {
        groups.push({ mode: 'sequential', steps: [{ agentName: name, task: `Esegui task correlato al goal: ${goal}` }], label: name });
      }
    } else {
      // Tentativo 2: fallback su una coppia minima scelta per MESTIERE (chi esegue +
      // chi verifica), non per nome proprio: il roster è configurabile e i nomi
      // cambiano, i due mestieri no.
      const devChar = allCharacters.find((c) => rolesOf(c).includes('developer')) || allCharacters[0];
      const supervisorChar = allCharacters.find((c) => rolesOf(c).includes('supervisor')) || allCharacters[1] || allCharacters[0];
      CLITheme.warning(`Nessun agente specifico rilevato: assegno il goal al team essenziale (@${devChar.name} + @${supervisorChar.name}).`);

      groups.push({ mode: 'sequential', steps: [{ agentName: devChar.name, task: `Sviluppa e realizza l'obiettivo: ${goal}` }], label: devChar.name });
      if (supervisorChar && supervisorChar.name !== devChar.name) {
        groups.push({ mode: 'sequential', steps: [{ agentName: supervisorChar.name, task: `Verifica e convalida il lavoro svolto` }], label: supervisorChar.name });
      }
    }
  }

  // Stampa piano
  logSink.log(chalk.bold('\n📋 PIANO D\'ESECUZIONE'));
  let stepCounter = 1;
  for (const group of groups) {
    if (group.mode === 'parallel') {
      logSink.log(`  ⚡ ${chalk.yellow('PARALLELO')}:`);
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

  // Esecuzione del piano
  const maxTokens = ctx.configManager.getMaxHistoryTokens();
  const teamMessages: ChatMessage[] = [
    { role: 'system', content: '' },
    { role: 'user', content: `GOAL DA RAGGIUNGERE: "${goal}"` }
  ];

  // Stima overhead fisso (system prompt + tool schemas) non visibile in teamMessages
  const CTX_OVERHEAD = 2000;
  let lastPromptTokens = 0; // prompt tokens reali dell'ultimo agente (peak context)

  let completed = false;
  let reworkAttempted = false;
  let overallStep = 0;
  const agentStats: { name: string; stats: TurnStats }[] = [];

  // In sessioni interattive, chiede all'utente se attivare la modalità autonoma per questo specifico goal
  let isAuto = true;
  if (process.stdin.isTTY) {
    const autoModeChoice = await InteractiveMenu.select<string>(
      'Modalità di esecuzione per questo goal:',
      [
        { title: '⚡ Autonoma — Consenti modifiche file e ricerche nel workspace senza interruzioni', value: 'auto' },
        { title: '🛡️  Sorvegliata — Chiedi conferma per ogni creazione/modifica di file', value: 'supervised' }
      ],
      'auto'
    );
    isAuto = autoModeChoice === 'auto';
  }

  const prevAllowWrite = ctx.permissionManager.isAllowAllWrite();
  if (isAuto) {
    ctx.permissionManager.setAllowAllWrite(true);
    logSink.log(chalk.green('✔ Modalità autonoma attivata per questo goal (scrittura file nel workspace consentita automaticamente).'));
    logSink.log(chalk.gray('  La jail del workspace resta attiva (non è possibile uscire dalla root); comandi DANGEROUS richiederanno conferma.\n'));
  } else {
    logSink.log(chalk.yellow('✔ Modalità sorvegliata attiva: verrà richiesta autorizzazione per ogni file.\n'));
  }

  // Blackboard del run (T6.2, TASKS.md — FASE 2): stato condiviso di QUESTO goal,
  // letto/scritto dagli agenti via post_note/read_notes (runMemberTurn,
  // strategies/common.ts). Isolata dai run concorrenti via AsyncLocalStorage
  // (src/core/blackboard.ts): i branch del blocco PARALLELO qui sotto sono
  // annidati dentro questo stesso withRun, quindi ereditano il runId ed
  // effettivamente condividono la blackboard (sono lo stesso run); un'altra
  // chiamata a handleGoal (es. due /goal in Promise.all, come nel test di
  // isolamento) genera un runId diverso e non vede queste note.
  const runId = Blackboard.newRunId();
  let blackboardNotes: BlackboardNote[] = [];
  try {
    await Blackboard.withRun(runId, async () => {
      for (let g = 0; g < groups.length; g++) {
        if (interrupt.aborted) break;
        const group = groups[g];

        if (group.mode === 'parallel') {
          const ctxEstimate = estimateMessagesTokens(teamMessages) + CTX_OVERHEAD;
          CLITheme.contextBar(ctxEstimate, maxTokens, 'Contesto stimato (gruppo parallelo):');

          logSink.log(chalk.bold.yellow(`\n═══ GRUPPO PARALLELO ${g + 1}/${groups.length} ═══`));
          for (const s of group.steps) {
            logSink.log(`  ⚡ ${chalk.cyan(getCharDisplayName(allCharacters, s.agentName))}: ${chalk.gray(s.task)}`);
          }
          logSink.log('');

          // Workspace isolati per branch (T3.2): ogni agente scrive in una propria
          // cartella di staging, unita alla workspace principale solo a fine blocco
          // (vedi mergeParallelWorkspaces più sotto) — evita scritture concorrenti
          // che si sovrappongono e permette di rilevare conflitti prima di applicarle.
          const branches = createParallelBranches(group.steps.map((s) => getCharDisplayName(allCharacters, s.agentName)));

          // Output bufferizzato per branch: le scritture concorrenti non si
          // interfogliano sulla console, vengono stampate in ordine dopo Promise.all.
          // Indicatore live minimale nel frattempo (spinner unico, non uno per agente).
          const restoreConsole = installLogBuffering();
          const spinner = CLITheme.createSpinner(`${group.steps.length} agenti al lavoro in parallelo...`);
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

          // Flush ordinato dell'output per-agente accumulato durante il parallelo
          for (const pr of parallelResults) {
            flushLogBuffer(pr.buffer);
          }

          // Merge dei file scritti dai branch nella workspace principale: nessuna
          // sovrascrittura silenziosa, i path in conflitto (contenuto diverso tra
          // branch) vengono elencati e NON copiati.
          const mergeResult = mergeParallelWorkspaces(branches, ctx.configManager.getWorkspaceRoot());
          if (mergeResult.merged.length > 0) {
            logSink.log(chalk.gray(`  📁 File uniti nella workspace: ${mergeResult.merged.join(', ')}`));
          }
          if (mergeResult.conflicts.length > 0) {
            CLITheme.warning(`Conflitti nel blocco parallelo: ${mergeResult.conflicts.length} file scritti in modo diverso da agenti diversi — NON uniti, workspace principale intatta per questi file:`);
            for (const c of mergeResult.conflicts) {
              logSink.log(chalk.yellow(`    • ${c.relativePath} — scritto diversamente da: ${c.labels.join(', ')}`));
            }
          }

          // Mostra contesto reale se disponibile
          if (lastPromptTokens > 0) {
            CLITheme.contextBar(lastPromptTokens, maxTokens, 'Contesto reale (peak LLM):');
          }

          // Merge dei risultati (in ordine, non mischiati)
          for (const pr of parallelResults) {
            const newMsgs = pr.localHistory.slice(teamMessages.length);
            teamMessages.push(...newMsgs);
            if (pr.result === 'completed') completed = true;
          }
          // Condensa output di ogni agente parallelo
          for (const pr of parallelResults) {
            condenseAgentOutput(pr.agentName, teamMessages, allCharacters, maxTokens);
          }
          overallStep += group.steps.length;
          // NB: non interrompiamo il loop sui gruppi se un agente parallelo dice COMPLETATO:
          // il piano del goal orchestrator è fisso, tutti gli step devono eseguirsi (es. la verifica finale del supervisore)

        } else {
          // Singolo agente sequenziale
          const step = group.steps[0];
          const char = allCharacters.find((c) => c.name === step.agentName);
          if (!char) continue;

          overallStep++;
          // Context bar: usa prompt tokens reali dell'agente precedente se disponibili, altrimenti stima
          const ctxEstimate = lastPromptTokens > 0
            ? lastPromptTokens
            : estimateMessagesTokens(teamMessages) + CTX_OVERHEAD;
          CLITheme.contextBar(ctxEstimate, maxTokens, `Contesto prima di ${char.aiName}:`);

          logSink.log(chalk.bold.yellow(`\n═══ STEP ${overallStep}/${flatSteps}: ${char.aiName} ═══`));
          logSink.log(chalk.gray(`Compito: ${step.task}`));

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
            // Mostra contesto reale dopo l'esecuzione
            CLITheme.contextBar(lastPromptTokens, maxTokens, `Contesto reale (peak ${char.aiName}):`);
          }

          condenseAgentOutput(step.agentName, teamMessages, allCharacters, maxTokens);

          if (result === 'completed') completed = true;

          // Rilavorazione innescata dal supervisore finale se il compito fallisce.
          // Il criterio è il MESTIERE, non il nome proprio: vale per qualsiasi
          // personaggio che abbia 'supervisor' fra le skill, anche se non attiva.
          const isSupervisor = rolesOf(char).includes('supervisor');
          if (isSupervisor && (result === 'failed' || result === 'continue') && !reworkAttempted && g > 0) {
            reworkAttempted = true;
            const lastAssistantMsg = teamMessages[teamMessages.length - 1]?.content || '';
            logSink.log(chalk.bold.yellow(`\n[VERDETTO DEL SUPERVISORE: RILAVORAZIONE RICHIESTA]`));
            logSink.log(chalk.gray(`Il supervisore ha riscontrato problemi. Avvio ciclo di rilavorazione dello step precedente...`));

            const prevGroup = groups[g - 1];
            if (prevGroup && prevGroup.steps.length > 0) {
              const targetStep = prevGroup.steps[0];
              const targetChar = allCharacters.find((c) => c.name === targetStep.agentName);
              if (targetChar) {
                overallStep++;
                logSink.log(chalk.bold.yellow(`\n═══ STEP RILAVORAZIONE: ${targetChar.aiName} ═══`));
                const reworkPrompt = `[RILAVORAZIONE GUIDATA DAL SUPERVISORE per @${targetStep.agentName}]:\n` +
                  `Il supervisore ha riscontrato problemi nella revisione precedente:\n${lastAssistantMsg}\n\n` +
                  `Correggi i problemi indicati dal supervisore ed esegui nuovamente il compito.`;
                teamMessages.push({ role: 'user', content: reworkPrompt });

                await runMemberTurn(
                  ctx, targetStep.agentName, goal,
                  overallStep, flatSteps + 2, teamMessages, interrupt, false
                );
                condenseAgentOutput(targetStep.agentName, teamMessages, allCharacters, maxTokens);

                // Riesegue la revisione finale del supervisore
                overallStep++;
                logSink.log(chalk.bold.yellow(`\n═══ REVISIONE DEL SUPERVISORE POST-RILAVORAZIONE ═══`));
                teamMessages.push({ role: 'user', content: `[Revisione finale del supervisore post-rilavorazione]: Verifica se i problemi del lavoro di @${targetStep.agentName} sono stati risolti.` });
                const finalOverseerOutcome = await runMemberTurn(
                  ctx, step.agentName, goal,
                  overallStep, flatSteps + 2, teamMessages, interrupt, false
                );
                if (finalOverseerOutcome === 'completed') completed = true;
                condenseAgentOutput(step.agentName, teamMessages, allCharacters, maxTokens);
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
    // Ripristina lo stato dei permessi preesistente
    ctx.permissionManager.setAllowAllWrite(prevAllowWrite);
    // La blackboard muore col run: liberata subito dopo l'esecuzione del piano,
    // non sopravvive oltre (nessuna persistenza, nessun accumulo tra /goal successivi).
    Blackboard.endRun(runId);
  }

  interrupt.disarm();

  // Riepilogo stats agenti
  if (agentStats.length > 0) {
    logSink.log(chalk.bold('\n📊 RIEPILOGO STATS AGENTI'));
    logSink.log(`  ${'Agente'.padEnd(16)}  ${'Out tok'.padStart(7)}  ${'Ctx tok'.padStart(8)}  ${'Tot tok'.padStart(7)}  ${'Tempo'.padStart(7)}  ${'Velocità'.padStart(10)}`);
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
      logSink.log(`  ${chalk.bold('TOTALE'.padEnd(16))}  ${chalk.bold.yellow(String(totalOut).padStart(7))}  ${chalk.bold.gray(String(totalCtx).padStart(8))}  ${chalk.bold.gray(String(totalAll).padStart(7))}  ${chalk.bold.gray(`${totalSec}s`.padStart(7))}`);
    }
    logSink.log('');
  }

  // Visualizzazione note Blackboard se presenti
  if (blackboardNotes.length > 0) {
    logSink.log(chalk.bold('📋 NOTE CONDIVISE SULLA BLACKBOARD (RUN)'));
    for (const note of blackboardNotes) {
      logSink.log(`  • ${chalk.cyan(`[${note.key}]`)} ${chalk.gray(`(@${note.author}):`)} ${note.value}`);
    }
    logSink.log('');
  }

  logSink.log(chalk.bold('\n🎯 [FINE GOAL]\n'));

  const agentNames = groups.flatMap((g) => g.steps.map((s) => s.agentName));
  if (completed) {
    CLITheme.success(`Goal raggiunto con successo in ${flatSteps} passi.`);
  } else {
    CLITheme.warning(`Goal non completato (elaborati ${flatSteps} passi).`);
  }

  // Scrive il report JSON in workflow_logs/
  const logFile = writeGoalLog({
    goal,
    success: completed,
    agents: agentNames,
    stats: agentStats,
    blackboard: blackboardNotes
  });
  if (logFile) {
    logSink.log(chalk.gray(`  📄 Report goal salvato in: workflow_logs/${logFile}`));
  }

  const summary = completed
    ? `Il Goal Orchestrator ha completato l'obiettivo: "${goal}" in ${flatSteps} passi (${agentNames.join(' → ')}).`
    : `Il Goal Orchestrator ha lavorato sul goal: "${goal}" senza completarlo. Team: ${agentNames.join(' → ')}.`;
  ctx.agent.current.getMessages().push({ role: 'user', content: `Goal: "${goal}"` });
  ctx.agent.current.getMessages().push({ role: 'assistant', content: summary });
  });
}
