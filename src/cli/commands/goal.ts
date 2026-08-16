import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import { StreamRenderer } from '../stream';
import { GenerationInterrupt } from '../interrupt';
import { MemoryStore } from '../../core/memory';
import { ContextTracker } from '../../core/contextTracker';
import { runMemberTurn, TurnStats } from './team';
import { ChatMessage, PlanStep } from '../../core/types';
import { runLoop } from '../../core/loop';
import { createParallelBranches, mergeParallelWorkspaces } from '../../core/parallelWorkspace';
import { installLogBuffering, runWithLogBuffer, flushLogBuffer } from '../../core/logBuffer';
import { withWorkspaceOverride } from '../../tools/impl/utils';
import { Blackboard } from '../../core/blackboard';
import { withEffortPin } from '../../core/effortControl';
import { loadRole, listAvailableTeams, CharacterConfig } from '../shared';

interface PlanGroup {
  mode: 'sequential' | 'parallel';
  steps: PlanStep[];
  label: string;
}

/** Mestieri (ruoli/skill) coperti da un personaggio: multi-skill se presenti, altrimenti il ruolo singolo. */
function rolesOf(c: CharacterConfig): string[] {
  if (c.roles && c.roles.length > 0) return c.roles;
  return c.role ? [c.role] : [];
}

/**
 * Genera la firma sintetica compatta di un agente per il catalogo dell'orchestrator.
 * Include nome, ruolo/skills, descrizione operativa ad alto segnale e tool essenziali.
 */
export function formatAgentSignature(c: CharacterConfig): string {
  if (c.signature && typeof c.signature === 'string' && c.signature.trim()) {
    return `- @${c.name} (${c.aiName || c.name}): ${c.signature.trim()}`;
  }

  const roleNames = rolesOf(c);

  const allTools = new Set<string>();
  const roleSummaries: string[] = [];

  // Tool generici/omnipresenti che non differenziano la specializzazione
  const AMBIENT_TOOLS = new Set(['save_memory', 'recall_memory', 'send_message', 'list_dir', 'read_file', 'browse_url']);

  for (const rName of roleNames) {
    const role = loadRole(rName);
    if (role) {
      if (role.description) roleSummaries.push(role.description);
      (role.allowedTools || []).forEach((t) => allTools.add(t));
    }
  }

  let desc = (c.description || roleSummaries.join('; ') || 'No description').split('\n')[0].trim();
  if (desc.length > 85) {
    desc = desc.slice(0, 82).trim() + '...';
  }

  const specificTools = Array.from(allTools).filter((t) => !AMBIENT_TOOLS.has(t));
  const displayTools = specificTools.length > 0 ? specificTools : Array.from(allTools);
  const toolsStr = displayTools.length > 0 ? ` | Tools: [${displayTools.join(', ')}]` : '';
  const rolesLabel = roleNames.length > 0 ? `role=${roleNames.join(',')}` : 'general';

  return `- @${c.name} (${c.aiName || c.name}): ${rolesLabel} — ${desc}${toolsStr}`;
}

/**
 * Blueprint dei team, letti da quelli REALMENTE installati (`teams/*.json`,
 * dipende dal preset scelto a `tsuka init`) e descritti per MESTIERE.
 *
 * Un solo concetto di squadra: il team è quello di `/team`, non un archetipo
 * separato inventato nel prompt. Due vincoli, entrambi deliberati:
 * - derivato, mai hard-coded: un elenco fisso citerebbe agenti che l'utente non ha
 *   installato, e l'orchestrator pianificherebbe con @nomi che `parsePlan` deve poi
 *   scartare (piano silenziosamente dimezzato);
 * - il team è una catena di RUOLI, non di personaggi: il modello sceglie la
 *   competenza, l'@handle designa solo CHI la esercita — e con il multi-skill
 *   (T9.1) un handle può coprire più mestieri, evitando il passaggio di consegne
 *   fatto solo per raggiungere il tool di un altro ruolo.
 * Un team è incluso solo se almeno 2 dei suoi membri esistono nel catalogo.
 */
export function buildTeamBlueprints(allCharacters: CharacterConfig[]): string {
  const byName = new Map(allCharacters.map((c) => [c.name, c]));
  const lines: string[] = [];

  for (const team of listAvailableTeams()) {
    const members = (team.members || [])
      .map((m) => byName.get(m))
      .filter((c): c is CharacterConfig => !!c);
    if (members.length < 2) continue;

    const crew = members
      .map((c) => `${rolesOf(c).join('+') || 'general'} (@${c.name})`)
      .join(' → ');

    let desc = (team.description || team.displayName || '').split('\n')[0].trim();
    if (desc.length > 110) desc = desc.slice(0, 107).trim() + '...';

    lines.push(`- [${team.name.toUpperCase()}] ${crew}${desc ? ` — ${desc}` : ''}`);
  }

  return lines.join('\n');
}

export function buildGoalOrchestratorPrompt(allCharacters: CharacterConfig[], goal: string): string {
  const charList = allCharacters
    .map(formatAgentSignature)
    .join('\n');

  const blueprints = buildTeamBlueprints(allCharacters);
  const blueprintBlock = blueprints
    ? `INSTALLED TEAMS (role chains — reuse one when the goal matches):\n${blueprints}\n\n`
    : '';
  const blueprintRule = blueprints
    ? '1. Reason by CRAFT: list the roles the goal requires, then reuse the team whose role chain matches, or compose your own from AVAILABLE AGENTS.\n'
    : '1. Reason by CRAFT: list the roles the goal requires, then pick the agents that cover them.\n';

  // Esempio costruito sul catalogo reale: un esempio con @nomi non installati
  // insegnerebbe al modello a pianificare con agenti inesistenti.
  const supervisor = allCharacters.find((c) => rolesOf(c).includes('supervisor'));
  const workers = allCharacters.filter((c) => c !== supervisor).slice(0, 3);
  const ex = (i: number, fallback: string) => {
    const c = workers[i];
    return c ? `@${c.name}` : `@${fallback}`;
  };
  const exReviewer = supervisor ? `@${supervisor.name}` : ex(3, 'reviewer');

  return `You are the TSUKA Goal Orchestrator. Plan a dynamic agent team to achieve a goal.

${blueprintBlock}AVAILABLE AGENTS (for custom or fallback composition):
${charList}

GOAL: "${goal}"

INSTRUCTIONS:
${blueprintRule}2. An agent listed with several roles (role=a,b) owns the tools of ALL of them: prefer ONE such agent over two specialists when the tasks are adjacent — it avoids a handoff whose only purpose is reaching another role's tool.
3. The @handle is just how you address the agent that holds the craft: use ONLY the @names listed above, any other name is discarded.
4. For each selected agent, specify a concrete task.
5. If some tasks are INDEPENDENT (can run concurrently), wrap them in a PARALLELO block.
6. If the goal is trivial (simple question, answer, info), respond with just FINE.

RESPONSE FORMAT:
AGENTE: @name — Task
PARALLELO:
AGENTE: @name1 — Task1 (independent from others)
AGENTE: @name2 — Task2 (independent from others)
FINE PARALLELO
AGENTE: @name3 — Task3 (after parallel tasks)
FINE

Example with parallel tasks:
AGENTE: ${ex(0, 'agent1')} — First step of the work
PARALLELO:
AGENTE: ${ex(1, 'agent2')} — Independent step A
AGENTE: ${ex(2, 'agent3')} — Independent step B
FINE PARALLELO
AGENTE: ${exReviewer} — Review and validate the work
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

export function parsePlan(
  content: string,
  allCharacters: (CharacterConfig | string)[],
  parallelEnabled: boolean = true
): ParseResult {
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
        if (parallelEnabled) {
          groups.push({
            mode: 'parallel',
            steps: parallelSteps,
            label: `Parallelo (${parallelSteps.map((s) => s.agentName).join(' + ')})`
          });
        } else {
          // T9.10: parallelExecutionEnabled=false (default) — il blocco PARALLELO
          // resta riconosciuto (il piano del modello non cambia), ma i suoi step
          // vengono eseguiti in sequenza come step normali, uno per gruppo, invece
          // che con Promise.all su workspace isolati. Su una singola GPU il
          // parallelismo reale non c'è comunque (contesa sulla stessa scheda), quindi
          // eseguire in sequenza evita l'overhead di branch/merge della workspace
          // senza perdere nessuno step del piano.
          for (const step of parallelSteps) {
            groups.push({ mode: 'sequential', steps: [step], label: step.task });
          }
        }
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

function lookupValidName(name: string, validMap?: Map<string, string> | (CharacterConfig | string)[]): string | null {
  if (!validMap) return name;
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
  validMap?: Map<string, string> | (CharacterConfig | string)[]
): { realName: string; name: string; task: string; consumed: number } | null {
  const rawLine = lines[startIdx].trim();
  // Pulizia prefissi markdown (es. "1. **AGENTE:** @nome — ...", "- AGENTE: nome: ...", "@nome - ...")
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

  return { realName, name: realName, task, consumed };
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

          // Rilavorazione innescata dal supervisore finale se il compito fallisce.
          // Il criterio è il MESTIERE, non il nome proprio: vale per qualsiasi
          // personaggio che abbia 'supervisor' fra le skill, anche se non attiva.
          const isSupervisor = rolesOf(char).includes('supervisor');
          if (isSupervisor && (result === 'failed' || result === 'continue') && !reworkAttempted && g > 0) {
            reworkAttempted = true;
            const lastAssistantMsg = teamMessages[teamMessages.length - 1]?.content || '';
            console.log(chalk.bold.yellow(`\n[VERDETTO DEL SUPERVISORE: RILAVORAZIONE RICHIESTA]`));
            console.log(chalk.gray(`Il supervisore ha riscontrato problemi. Avvio ciclo di rilavorazione dello step precedente...`));

            const prevGroup = groups[g - 1];
            if (prevGroup && prevGroup.steps.length > 0) {
              const targetStep = prevGroup.steps[0];
              const targetChar = allCharacters.find((c) => c.name === targetStep.agentName);
              if (targetChar) {
                overallStep++;
                console.log(chalk.bold.yellow(`\n═══ STEP RILAVORAZIONE: ${targetChar.aiName} ═══`));
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
                console.log(chalk.bold.yellow(`\n═══ REVISIONE DEL SUPERVISORE POST-RILAVORAZIONE ═══`));
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
