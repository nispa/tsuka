import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import { StreamRenderer } from '../stream';
import { GenerationInterrupt } from '../interrupt';
import { MemoryStore } from '../../core/memory';
import { ContextTracker } from '../../core/contextTracker';
import { runMemberTurn, TurnStats } from './team';
import { CharacterConfig } from '../shared';
import { ChatMessage, PlanStep } from '../../core/types';
import { runLoop } from '../../core/loop';
import { createParallelBranches, mergeParallelWorkspaces } from '../../core/parallelWorkspace';
import { installLogBuffering, runWithLogBuffer, flushLogBuffer } from '../../core/logBuffer';
import { withWorkspaceOverride } from '../../tools/impl/utils';
import { Blackboard } from '../../core/blackboard';

interface PlanGroup {
  mode: 'sequential' | 'parallel';
  steps: PlanStep[];
  label: string;
}

function buildGoalOrchestratorPrompt(allCharacters: CharacterConfig[], goal: string): string {
  const charList = allCharacters
    .map((c) => {
      const roleDesc = c.description || 'no description';
      return `- @${c.name} (${c.aiName}): role ${c.role} — ${roleDesc}`;
    })
    .join('\n');

  return `You are the TSUKA Goal Orchestrator. Plan a dynamic agent team to achieve a goal.

AVAILABLE AGENTS:
${charList}

GOAL: "${goal}"

Analyze the goal and select the best agents. For each, specify a concrete task.
If some tasks are INDEPENDENT (can run concurrently), wrap them in a PARALLELO block.
If the goal is trivial (simple question, answer, info), respond with just FINE.

RESPONSE FORMAT:
AGENTE: @name — Task
PARALLELO:
AGENTE: @name1 — Task1 (independent from others)
AGENTE: @name2 — Task2 (independent from others)
FINE PARALLELO
AGENTE: @name3 — Task3 (after parallel tasks)
FINE

Example with parallel tasks:
AGENTE: @piccione — Search for known vulnerabilities in current server version
PARALLELO:
AGENTE: @falco — Analyze current security policies on the system
AGENTE: @pippo — Prepare hardening and backup scripts
FINE PARALLELO
AGENTE: @overseer — Review the work
FINE

If no team is needed:
FINE`;
}

interface ParseResult {
  groups: PlanGroup[];
  flatSteps: number;
}

function normalizeCharName(name: string): string {
  return (name || '').toLowerCase().replace(/[\s_\-]/g, '');
}

export function parsePlan(content: string, allCharacters: (CharacterConfig | string)[]): ParseResult {
  const groups: PlanGroup[] = [];
  const lines = content.split('\n');
  const validMap = new Map<string, string>();
  for (const item of allCharacters) {
    if (typeof item === 'string') {
      validMap.set(normalizeCharName(item), item);
    } else if (item && typeof item === 'object') {
      if (item.name) validMap.set(normalizeCharName(item.name), item.name);
      if (item.aiName) validMap.set(normalizeCharName(item.aiName), item.name);
    }
  }

  let flatSteps = 0;
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i].trim();
    // Pulisci markdown formatting (bullet, bold, numbers)
    const line = rawLine.replace(/^(?:\d+\.|\*|-)\s*/, '').replace(/\*\*/g, '').trim();

    // Blocco parallelo
    if (/^PARALLELO/i.test(line)) {
      i++;
      const parallelSteps: PlanStep[] = [];
      while (i < lines.length) {
        const subLine = lines[i].trim().replace(/^(?:\d+\.|\*|-)\s*/, '').replace(/\*\*/g, '').trim();
        if (/^FINE\s*PARALLELO/i.test(subLine)) break;

        const step = parseAgentLine(lines, i, validMap);
        if (step) {
          parallelSteps.push({ agentName: step.realName, task: step.task });
          i += step.consumed;
        } else {
          i++;
        }
      }
      if (parallelSteps.length > 0) {
        groups.push({
          mode: 'parallel',
          steps: parallelSteps,
          label: `Parallelo (${parallelSteps.map((s) => s.agentName).join(' + ')})`
        });
        flatSteps += parallelSteps.length;
      }
      i++; // salta FINE PARALLELO
      continue;
    }

    // Riga agente singolo
    const step = parseAgentLine(lines, i, validMap);
    if (step) {
      groups.push({
        mode: 'sequential',
        steps: [{ agentName: step.realName, task: step.task }],
        label: step.realName
      });
      flatSteps++;
      i += step.consumed;
    } else {
      i++;
    }
  }

  return { groups, flatSteps };
}

function lookupValidName(name: string, validMap: Map<string, string> | (CharacterConfig | string)[]): string | null {
  const normalized = normalizeCharName(name);
  if (validMap instanceof Map) {
    return validMap.get(normalized) || null;
  }
  if (Array.isArray(validMap)) {
    for (const item of validMap) {
      if (typeof item === 'string') {
        if (normalizeCharName(item) === normalized) return item;
      } else if (item && typeof item === 'object') {
        if (item.name && normalizeCharName(item.name) === normalized) return item.name;
        if (item.aiName && normalizeCharName(item.aiName) === normalized) return item.name;
      }
    }
  }
  return null;
}

/** Parsa una riga AGENTE: / AGENT: / @name tollerando markdown, numeri di lista e separatori vari. */
export function parseAgentLine(
  lines: string[],
  startIdx: number,
  validMap: Map<string, string> | (CharacterConfig | string)[]
): { realName: string; task: string; consumed: number } | null {
  const rawLine = lines[startIdx].trim();
  // Pulizia prefissi markdown (es. "1. **AGENTE:** @dev — ...", "- AGENTE: dev: ...", "@dev - ...")
  const cleanLine = rawLine
    .replace(/^(?:\d+\.|\*|-)\s*/, '')
    .replace(/\*\*/g, '')
    .trim();

  // Pattern flessibile:
  // 1) Opzionale "AGENTE:" o "AGENT:"
  // 2) @nome (con trattini/spazi/underscore ammessi)
  // 3) Separatore: —, –, -, :, ->, => o |
  // 4) Task descrittivo
  const FLEXIBLE_RE = /^(?:AGENTE|AGENT)?:\s*@?([a-zA-Z0-9_\-\s]+?)\s*(?:[—–\-:]|->|=>|\|)\s*(.*)/i;
  const AT_DIRECT_RE = /^@([a-zA-Z0-9_\-\s]+?)\s*(?:[—–\-:]|->|=>|\|)\s*(.*)/i;

  let match = cleanLine.match(FLEXIBLE_RE);
  if (!match) {
    match = cleanLine.match(AT_DIRECT_RE);
  }

  if (!match) return null;

  const rawName = match[1].trim();
  const realName = lookupValidName(rawName, validMap);
  if (!realName) return null;

  let task = match[2]?.trim() || '';
  let consumed = 1;

  // Se il task è vuoto o un separatore isolato, accumula le righe successive
  if (!task || /^[—–\-:]\s*$/.test(task)) {
    const taskLines: string[] = [];
    for (let j = startIdx + 1; j < lines.length; j++) {
      const nextRaw = lines[j].trim();
      const nextClean = nextRaw.replace(/^(?:\d+\.|\*|-)\s*/, '').replace(/\*\*/g, '').trim();
      if (/^(?:AGENTE|AGENT)?:\s*@/i.test(nextClean) || /^PARALLELO/i.test(nextClean) || /^FINE\b/i.test(nextClean)) break;
      taskLines.push(nextClean);
      consumed++;
    }
    task = taskLines.filter(Boolean).join(' ').trim();
  }

  return { realName, task, consumed };
}

function getCharDisplayName(allCharacters: CharacterConfig[], agentName: string): string {
  const char = allCharacters.find((c) => c.name === agentName);
  return char ? char.aiName : agentName;
}

/** Stima token di un array di messaggi (stessa euristica di Agent.estimateTokens). */
function estimateMessagesTokens(msgs: ChatMessage[]): number {
  let chars = 0;
  for (const m of msgs) {
    if (typeof m.content === 'string') chars += m.content.length;
    if (m.tool_calls) {
      try { chars += JSON.stringify(m.tool_calls).length; } catch {}
    }
  }
  return Math.ceil(chars / 3.5);
}

/** Mostra una barra di utilizzo contesto. */
function showContextBar(used: number, total: number, label: string): void {
  const pct = Math.min(100, Math.round((used / total) * 100));
  const barW = 24;
  const filled = Math.round((pct / 100) * barW);
  const empty = barW - filled;
  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  const color = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
  console.log(`  ${chalk.gray(label)} ${bar} ${color(`${pct}%`)} ${chalk.gray(`(~${used.toLocaleString()} / ${total.toLocaleString()} tok)`)}`);
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
    console.log(chalk.gray(`  💾 Contesto compresso: risparmiati ~${savedStr} tok (ora ~${after.toLocaleString()} tot, ${pct}% del limite)`));
  }
  showContextBar(after, maxTokens, 'Contesto history:');
}

export async function handleGoal(ctx: CommandCtx, arg: string): Promise<void> {
  const goal = arg.trim();
  if (!goal) {
    CLITheme.error('Specifica un obiettivo. Es: /goal "Crea un sito web e deployalo"');
    return;
  }

  const allCharacters = ctx.listAvailableCharacters();
  if (allCharacters.length === 0) {
    CLITheme.warning('Nessun personaggio disponibile. Usa /character per crearne uno.');
    return;
  }

  const validNames = allCharacters.map((c) => c.name.toLowerCase());

  console.log(chalk.bold('\n🎯 [GOAL ORCHESTRATOR]'));
  console.log(`Obiettivo:  "${chalk.yellow(goal)}"`);
  console.log(`Agenti disp: ${allCharacters.map((c) => chalk.cyan(`@${c.name}`)).join(', ')}\n`);

  // Prompt per l'orchestrator
  const sysPrompt = buildGoalOrchestratorPrompt(allCharacters, goal);
  const orcMessages: ChatMessage[] = [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: `Pianifica il team per: "${goal}"` }
  ];

  const interrupt = new GenerationInterrupt();
  interrupt.arm();

  console.log(chalk.bold.cyan('[ORCHESTRATOR] Analisi del goal e pianificazione team...\n'));

  const planRenderer = new StreamRenderer({ headerName: 'Goal Orchestrator', headerColor: chalk.magenta });
  planRenderer.begin();

  let planText = '';
  try {
    const response = await ctx.provider.chatWithTools(
      orcMessages,
      undefined,
      (chunk, channel) => planRenderer.onDelta(chunk, channel ?? 'content'),
      interrupt.signal
    );
    planRenderer.finish();
    planText = response.content?.trim() || '';
    console.log();
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

  // Parsing del piano in gruppi
  const { groups, flatSteps } = parsePlan(planText, allCharacters);

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
      // Tentativo 2: Fallback mirato su max 2 agenti (dev ed overseer, o i primi due)
      CLITheme.warning('Nessun agente specifico rilevato: assegno il goal al team essenziale (dev + overseer).');
      const devChar = allCharacters.find((c) => c.name === 'dev' || c.role === 'developer') || allCharacters[0];
      const overseerChar = allCharacters.find((c) => c.name === 'overseer' || c.role === 'supervisor') || allCharacters[1] || allCharacters[0];
      
      groups.push({ mode: 'sequential', steps: [{ agentName: devChar.name, task: `Sviluppa e realizza l'obiettivo: ${goal}` }], label: devChar.name });
      if (overseerChar && overseerChar.name !== devChar.name) {
        groups.push({ mode: 'sequential', steps: [{ agentName: overseerChar.name, task: `Verifica e convalida il lavoro svolto` }], label: overseerChar.name });
      }
    }
  }

  // Stampa piano
  console.log(chalk.bold('\n📋 PIANO D\'ESECUZIONE'));
  let stepCounter = 1;
  for (const group of groups) {
    if (group.mode === 'parallel') {
      console.log(`  ⚡ ${chalk.yellow('PARALLELO')}:`);
      for (const s of group.steps) {
        console.log(`     ${stepCounter}. ${chalk.cyan(getCharDisplayName(allCharacters, s.agentName))} — ${chalk.gray(s.task)}`);
        stepCounter++;
      }
    } else {
      console.log(`  ${stepCounter}. ${chalk.cyan(getCharDisplayName(allCharacters, group.steps[0].agentName))} — ${chalk.gray(group.steps[0].task)}`);
      stepCounter++;
    }
  }
  console.log();

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

  // Blackboard del run (T6.2, TASKS.md — FASE 2): stato condiviso di QUESTO goal,
  // letto/scritto dagli agenti via post_note/read_notes (runMemberTurn,
  // strategies/common.ts). Isolata dai run concorrenti via AsyncLocalStorage
  // (src/core/blackboard.ts): i branch del blocco PARALLELO qui sotto sono
  // annidati dentro questo stesso withRun, quindi ereditano il runId ed
  // effettivamente condividono la blackboard (sono lo stesso run); un'altra
  // chiamata a handleGoal (es. due /goal in Promise.all, come nel test di
  // isolamento) genera un runId diverso e non vede queste note.
  const runId = Blackboard.newRunId();
  try {
    await Blackboard.withRun(runId, async () => {
      for (let g = 0; g < groups.length; g++) {
        if (interrupt.aborted) break;
        const group = groups[g];

        if (group.mode === 'parallel') {
          const ctxEstimate = estimateMessagesTokens(teamMessages) + CTX_OVERHEAD;
          showContextBar(ctxEstimate, maxTokens, 'Contesto stimato (gruppo parallelo):');

          console.log(chalk.bold.yellow(`\n═══ GRUPPO PARALLELO ${g + 1}/${groups.length} ═══`));
          for (const s of group.steps) {
            console.log(`  ⚡ ${chalk.cyan(getCharDisplayName(allCharacters, s.agentName))}: ${chalk.gray(s.task)}`);
          }
          console.log();

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
            console.log(chalk.gray(`  📁 File uniti nella workspace: ${mergeResult.merged.join(', ')}`));
          }
          if (mergeResult.conflicts.length > 0) {
            CLITheme.warning(`Conflitti nel blocco parallelo: ${mergeResult.conflicts.length} file scritti in modo diverso da agenti diversi — NON uniti, workspace principale intatta per questi file:`);
            for (const c of mergeResult.conflicts) {
              console.log(chalk.yellow(`    • ${c.relativePath} — scritto diversamente da: ${c.labels.join(', ')}`));
            }
          }

          // Mostra contesto reale se disponibile
          if (lastPromptTokens > 0) {
            showContextBar(lastPromptTokens, maxTokens, 'Contesto reale (peak LLM):');
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
          // il piano del goal orchestrator è fisso, tutti gli step devono eseguirsi (es. overseer finale)

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
          showContextBar(ctxEstimate, maxTokens, `Contesto prima di ${char.aiName}:`);

          console.log(chalk.bold.yellow(`\n═══ STEP ${overallStep}/${flatSteps}: ${char.aiName} ═══`));
          console.log(chalk.gray(`Compito: ${step.task}`));

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
            showContextBar(lastPromptTokens, maxTokens, `Contesto reale (peak ${char.aiName}):`);
          }

          condenseAgentOutput(step.agentName, teamMessages, allCharacters, maxTokens);

          if (result === 'completed') completed = true;

          // Rilavorazione innescata dall'Overseer finale se il compito fallisce
          if (step.agentName === 'overseer' && (result === 'failed' || result === 'continue') && !reworkAttempted && g > 0) {
            reworkAttempted = true;
            const lastAssistantMsg = teamMessages[teamMessages.length - 1]?.content || '';
            console.log(chalk.bold.yellow(`\n[OVERSEER VERDICT: RILAVORAZIONE RICHIESTA]`));
            console.log(chalk.gray(`L'Overseer ha riscontrato problemi. Avvio ciclo di rilavorazione dello step precedente...`));

            const prevGroup = groups[g - 1];
            if (prevGroup && prevGroup.steps.length > 0) {
              const targetStep = prevGroup.steps[0];
              const targetChar = allCharacters.find((c) => c.name === targetStep.agentName);
              if (targetChar) {
                overallStep++;
                console.log(chalk.bold.yellow(`\n═══ STEP RILAVORAZIONE: ${targetChar.aiName} ═══`));
                const reworkPrompt = `[RILAVORAZIONE GUIDATA DALL'OVERSEER per @${targetStep.agentName}]:\n` +
                  `L'Overseer ha riscontrato problemi nella revisione precedente:\n${lastAssistantMsg}\n\n` +
                  `Correggi i problemi indicati dall'Overseer ed esegui nuovamente il compito.`;
                teamMessages.push({ role: 'user', content: reworkPrompt });

                await runMemberTurn(
                  ctx, targetStep.agentName, goal,
                  overallStep, flatSteps + 2, teamMessages, interrupt, false
                );
                condenseAgentOutput(targetStep.agentName, teamMessages, allCharacters, maxTokens);

                // Riesaegue la revisione finale dell'Overseer
                overallStep++;
                console.log(chalk.bold.yellow(`\n═══ REVISIONE OVERSEER POST-RILAVORAZIONE ═══`));
                teamMessages.push({ role: 'user', content: `[Revisione finale Overseer post-rilavorazione]: Verifica se i problemi del lavoro di @${targetStep.agentName} sono stati risolti.` });
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
    // La blackboard muore col run: liberata subito dopo l'esecuzione del piano,
    // non sopravvive oltre (nessuna persistenza, nessun accumulo tra /goal successivi).
    Blackboard.endRun(runId);
  }

  interrupt.disarm();

  // Riepilogo stats agenti
  if (agentStats.length > 0) {
    console.log(chalk.bold('\n📊 RIEPILOGO STATS AGENTI'));
    console.log(`  ${'Agente'.padEnd(16)}  ${'Out tok'.padStart(7)}  ${'Ctx tok'.padStart(8)}  ${'Tot tok'.padStart(7)}  ${'Tempo'.padStart(7)}  ${'Velocità'.padStart(10)}`);
    let totalOut = 0, totalCtx = 0, totalAll = 0, totalMs = 0;
    for (const { name, stats } of agentStats) {
      const displayName = getCharDisplayName(allCharacters, name);
      const sec = (stats.durationMs / 1000).toFixed(1);
      const ctx = stats.promptTokens || 0;
      const tot = stats.totalTokens || (ctx + stats.tokenCount);
      console.log(`  ${chalk.cyan(displayName.padEnd(16))}  ${chalk.yellow(String(stats.tokenCount).padStart(7))}  ${chalk.gray(String(ctx).padStart(8))}  ${chalk.gray(String(tot).padStart(7))}  ${chalk.gray(`${sec}s`.padStart(7))}  ${chalk.gray(`${stats.tokensPerSecond} tok/s`.padStart(10))}`);
      totalOut += stats.tokenCount;
      totalCtx = Math.max(totalCtx, ctx);
      totalAll += tot;
      totalMs += stats.durationMs;
    }
    if (agentStats.length > 1) {
      const totalSec = (totalMs / 1000).toFixed(1);
      console.log(`  ${chalk.bold('TOTALE'.padEnd(16))}  ${chalk.bold.yellow(String(totalOut).padStart(7))}  ${chalk.bold.gray(String(totalCtx).padStart(8))}  ${chalk.bold.gray(String(totalAll).padStart(7))}  ${chalk.bold.gray(`${totalSec}s`.padStart(7))}`);
    }
    console.log();
  }

  console.log(chalk.bold('\n🎯 [FINE GOAL]\n'));

  const agentNames = groups.flatMap((g) => g.steps.map((s) => s.agentName));
  if (completed) {
    CLITheme.success(`Goal raggiunto con successo in ${flatSteps} passi.`);
  } else {
    CLITheme.warning(`Goal non completato (elaborati ${flatSteps} passi).`);
  }

  const summary = completed
    ? `Il Goal Orchestrator ha completato l'obiettivo: "${goal}" in ${flatSteps} passi (${agentNames.join(' → ')}).`
    : `Il Goal Orchestrator ha lavorato sul goal: "${goal}" senza completarlo. Team: ${agentNames.join(' → ')}.`;
  ctx.agent.current.getMessages().push({ role: 'user', content: `Goal: "${goal}"` });
  ctx.agent.current.getMessages().push({ role: 'assistant', content: summary });
}
