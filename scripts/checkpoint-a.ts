/**
 * Checkpoint A runner (T24.3): does automatic context delegation help on real tasks?
 *
 * Runs every task with the context scheduler OFF and ON, several times, against the
 * provider configured in tsuka.config.json, and writes a results table. Each trial:
 *   1. resets a throwaway git worktree (never the real repository);
 *   2. writes <worktree>/.tsuka/config.json = your config + workspaceRoot + scheduler flag
 *      (a local config wins over the app-home one; your tsuka.config.json is never touched);
 *   3. runs the task in a fresh process, so every counter starts from zero;
 *   4. checks the success criterion and records the /context metrics.
 *
 * Usage:   npx tsx scripts/checkpoint-a.ts [--reps 2] [--tasks A,B,C] [--workspace ../tsuka-checkpoint]
 * Output:  runs/checkpoint-a/<timestamp>/results.md and answers.md (task C answers to rate by hand)
 *
 * Unattended safety: file writes inside the worktree are approved, shell commands are refused.
 * Delegation only fires when the context fills up: use a small window (e.g. llama-server -c 16384).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..');
const NEUTRAL_AGENT = { activeCharacter: 'custom', activeRole: 'developer', activeTrait: 'professional' };

interface TaskSpec {
  id: string;
  title: string;
  prompt: string;
}

const TASKS: TaskSpec[] = [
  {
    id: 'A',
    title: 'lettura pesante con traccia su file',
    prompt: 'Leggi tutti i file in src/core/memory/ e scrivi in docs/memory-overview.md una sezione per ogni file: scopo e funzioni principali.',
  },
  {
    id: 'B',
    title: 'modifiche su più file',
    prompt: 'Aggiungi a ogni file .ts in src/tools/webSearch/ un commento di una riga in testa che dica cosa fa il file. Non modificare altro.',
  },
  {
    id: 'C',
    title: 'solo ragionamento',
    prompt: 'Spiegami come una richiesta scritta nel prompt della TUI arriva fino al provider LLM, citando i file coinvolti. Non modificare file.',
  },
];

interface TrialMetrics {
  ok: boolean;
  error?: string;
  provider?: string;
  model?: string;
  contextWindow?: number | null;
  durationMs: number;
  rounds: number;
  toolCalls: number;
  totalTokens: number;
  peakPromptTokens: number;
  peakPressure: number;
  prepareDecisions: number;
  delegateDecisions: number;
  delegationsCompleted: number;
  delegationsBlocked: number;
  delegationsFailed: number;
  childTokens: number;
  returnedTokens: number;
  amplification: number | null;
  answer: string;
}

// ───────────────────────────── trial (child process) ─────────────────────────────

async function runTrial(taskId: string): Promise<void> {
  const task = TASKS.find((t) => t.id === taskId);
  if (!task) throw new Error(`Unknown task '${taskId}'.`);
  // Imported here, after the parent set cwd to the worktree: the local .tsuka/config.json
  // is resolved at construction time.
  const { ConfigManager } = await import('../src/core/config');
  const { createHarnessRuntime } = await import('../src/core/runtime');
  const { chooseStartupModel, detectContextWindow, probeProvider } = await import('../src/core/discovery');
  const { DISCOVERY_DEFAULTS } = await import('../src/core/constants');
  const { Agent, resolveReasoningEffort } = await import('../src/core/agent');
  const { loadCharacter, loadRole, loadTrait, loadSystemPrompt } = await import('../src/core/personas');
  const { withEffortPin } = await import('../src/core/effortControl');
  const { resolveToolSet } = await import('../src/core/toolSet');
  const { ContextTracker } = await import('../src/core/contextTracker');

  const result: TrialMetrics = {
    ok: false, durationMs: 0, rounds: 0, toolCalls: 0, totalTokens: 0, peakPromptTokens: 0, peakPressure: 0,
    prepareDecisions: 0, delegateDecisions: 0, delegationsCompleted: 0, delegationsBlocked: 0, delegationsFailed: 0,
    childTokens: 0, returnedTokens: 0, amplification: null, answer: '',
  };
  try {
    const configManager = new ConfigManager();
    const runtime = await createHarnessRuntime({
      configManager,
      connectMcp: false,
      // Unattended: writes stay inside the worktree jail; the shell is never allowed.
      permissionHandler: async (request) => (request.toolName === 'execute_command' ? 'no' : 'yes'),
    });
    const { provider, registry, permissionManager } = runtime;
    const active = configManager.getActiveProviderConfig();
    result.provider = configManager.getActiveProviderName();
    // Start on whatever the server has loaded, like the CLI/TUI startup: a checkpoint run
    // measures the model in RAM, not the one last saved in the config. Long wait on
    // purpose: a cold local server can miss the short probe, and without the real window
    // pressure is measured against maxHistoryTokens and delegation never fires.
    const scan = await probeProvider(result.provider, active, configManager.getApiKey(), DISCOVERY_DEFAULTS.configuredProbeTimeoutMs);
    if (!scan) throw new Error(`Provider '${result.provider}' is not reachable at ${active.baseUrl}.`);
    provider.setCurrentModel(chooseStartupModel(scan, provider.getCurrentModel()));
    result.model = provider.getCurrentModel();
    result.contextWindow = scan.contextWindow
      ?? await detectContextWindow(active.baseUrl, configManager.getApiKey(), result.model, DISCOVERY_DEFAULTS.configuredProbeTimeoutMs);
    if (result.contextWindow) configManager.setRuntimeContextTokens(result.contextWindow);

    // Same assembly as the CLI's recreateAgent.
    const char = loadCharacter(configManager.getActiveCharacter());
    const role = loadRole(char ? char.role : configManager.getActiveRole());
    const trait = loadTrait(char ? char.trait : configManager.getActiveTrait());
    const effort = withEffortPin(resolveReasoningEffort(undefined, char, role, configManager.getDefaultReasoningEffort()));
    const toolSet = resolveToolSet(role);
    const agent = new Agent(
      provider, registry, permissionManager,
      loadSystemPrompt(role, trait, provider.getCurrentModel(), registry, char, undefined, effort, provider.getBaseUrl(), provider.getProviderClass?.()),
      toolSet.active, configManager.getMaxHistoryMessages(), configManager.getMaxHistoryTokens(),
      char?.aiName || role.name, effort, undefined, configManager.getMaxToolRounds()
    );
    agent.setDeferredTools(toolSet.deferred);
    agent.setRoleName(role.name);
    if (char) agent.setCharName(char.aiName);
    agent.setSubagentRunner(runtime.subagentRunner);
    if (configManager.isContextSchedulerEnabled()) {
      agent.setContextScheduler({ enabled: true, ...configManager.getContextSchedulerConfig() });
    }

    ContextTracker.getInstance().clear();
    const started = Date.now();
    result.answer = await agent.run(
      task.prompt,
      () => {},
      (stats) => {
        result.rounds++;
        result.totalTokens += stats.totalTokens || 0;
        result.peakPromptTokens = Math.max(result.peakPromptTokens, stats.promptTokens || 0);
      },
      (event) => {
        if (event.type === 'tool_start') result.toolCalls++;
      }
    );
    result.durationMs = Date.now() - started;

    const m = ContextTracker.getInstance().getSchedulerMetrics();
    Object.assign(result, {
      ok: true,
      peakPressure: Math.round(m.peakEstimatedPressure * 100) / 100,
      prepareDecisions: m.prepareDecisions,
      delegateDecisions: m.delegateDecisions,
      delegationsCompleted: m.delegationsCompleted,
      delegationsBlocked: m.delegationsBlocked,
      delegationsFailed: m.delegationsFailed,
      childTokens: m.totalChildTokens,
      returnedTokens: m.totalReturnedTokens,
      amplification: m.contextAmplification,
    });
    await runtime.close();
  } catch (error: any) {
    result.error = String(error?.message ?? error);
  }
  process.stdout.write(`\nCHECKPOINT_RESULT ${JSON.stringify(result)}\n`);
}

// ───────────────────────────── orchestration (parent) ─────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function git(cwd: string, ...args: string[]): string {
  const out = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
  if (out.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${out.stderr.trim()}`);
  return out.stdout;
}

function prepareWorktree(ws: string): void {
  if (!fs.existsSync(ws)) {
    console.log(`Creating throwaway worktree at ${ws} ...`);
    git(REPO, 'worktree', 'add', '--detach', ws, 'HEAD');
  }
  git(ws, 'rev-parse', '--is-inside-work-tree');
}

/** Back to the committed state; .tsuka/ (the local config) is kept. */
function resetWorktree(ws: string): void {
  git(ws, 'checkout', '--', '.');
  git(ws, 'clean', '-fdq', '-e', '.tsuka');
}

function writeLocalConfig(ws: string, schedulerOn: boolean): void {
  const userConfig = JSON.parse(fs.readFileSync(path.join(REPO, 'tsuka.config.json'), 'utf-8'));
  fs.mkdirSync(path.join(ws, '.tsuka'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, '.tsuka', 'config.json'),
    // Neutral, identical agent for every trial: with the user's persona (tone, language,
    // habits) the checkpoint would measure the character instead of the delegation.
    JSON.stringify({ ...userConfig, ...NEUTRAL_AGENT, workspaceRoot: ws, contextSchedulerEnabled: schedulerOn }, null, 2)
  );
}

/** Success criterion of each task, checked on the worktree after the run. */
function evaluate(taskId: string, ws: string, metrics: TrialMetrics): { success: string; note: string } {
  if (!metrics.ok) return { success: 'errore', note: metrics.error ?? '' };
  if (taskId === 'A') {
    const file = path.join(ws, 'docs', 'memory-overview.md');
    if (!fs.existsSync(file)) return { success: 'no', note: 'docs/memory-overview.md non creato' };
    const text = fs.readFileSync(file, 'utf-8');
    const sources = fs.readdirSync(path.join(ws, 'src', 'core', 'memory')).filter((f) => f.endsWith('.ts'));
    const covered = sources.filter((f) => text.includes(f.replace(/\.ts$/, '')));
    return { success: covered.length === sources.length ? 'sì' : 'no', note: `copre ${covered.length}/${sources.length} file` };
  }
  if (taskId === 'B') {
    const dir = path.join(ws, 'src', 'tools', 'webSearch');
    const sources = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    const changed = git(ws, 'diff', '--name-only', '--', 'src/tools/webSearch').split('\n').filter(Boolean);
    const others = git(ws, 'diff', '--name-only').split('\n').filter((f) => f && !f.startsWith('src/tools/webSearch/'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require(path.join(REPO, 'node_modules', 'typescript'));
    let commented = 0;
    let syntaxErrors = 0;
    for (const f of sources) {
      const text = fs.readFileSync(path.join(dir, f), 'utf-8');
      const first = text.split('\n').find((l) => l.trim()) ?? '';
      if (/^\s*(\/\/|\/\*)/.test(first)) commented++;
      const out = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS } });
      syntaxErrors += out.diagnostics?.length ?? 0;
    }
    const ok = changed.length === sources.length && commented === sources.length && syntaxErrors === 0 && others.length === 0;
    return {
      success: ok ? 'sì' : 'no',
      note: `modificati ${changed.length}/${sources.length}, commentati ${commented}, errori di sintassi ${syntaxErrors}, altri file toccati ${others.length}`,
    };
  }
  return { success: 'da votare', note: 'risposta in answers.md' };
}

function cell(v: unknown): string {
  return v === null || v === undefined ? '—' : String(v);
}

async function main(): Promise<void> {
  if (process.argv.includes('--trial')) {
    await runTrial(arg('trial', ''));
    return;
  }

  const ws = path.resolve(arg('workspace', path.join(REPO, '..', 'tsuka-checkpoint')));
  const reps = Math.max(1, parseInt(arg('reps', '2'), 10) || 2);
  const taskIds = arg('tasks', 'A,B,C').split(',').map((t) => t.trim().toUpperCase());
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(REPO, 'runs', 'checkpoint-a', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  // Isolate the harness side effects of the trials from your real memory and logs.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-checkpoint-'));

  prepareWorktree(ws);
  const tsx = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const rows: string[] = [];
  const answers: string[] = ['# Checkpoint A — risposte del task C (da votare 1–5)\n'];
  const total = taskIds.length * 2 * reps;
  let n = 0;

  for (const taskId of taskIds) {
    const task = TASKS.find((t) => t.id === taskId);
    if (!task) throw new Error(`Unknown task '${taskId}' (available: ${TASKS.map((t) => t.id).join(', ')}).`);
    for (const mode of ['off', 'on'] as const) {
      for (let rep = 1; rep <= reps; rep++) {
        n++;
        console.log(`[${n}/${total}] task ${taskId} (${task.title}) · scheduler ${mode} · prova ${rep} ...`);
        resetWorktree(ws);
        writeLocalConfig(ws, mode === 'on');
        const child = spawnSync(process.execPath, [tsx, __filename, '--trial', taskId], {
          cwd: ws,
          encoding: 'utf-8',
          maxBuffer: 64 * 1024 * 1024,
          timeout: 30 * 60 * 1000,
          env: {
            ...process.env,
            TSUKA_HOME: REPO,
            TSUKA_MEMORY_FILE: path.join(scratch, `memory-${n}.json`),
            TSUKA_LOGS_DIR: path.join(scratch, 'logs'),
          },
        });
        const line = (child.stdout ?? '').split('\n').reverse().find((l) => l.startsWith('CHECKPOINT_RESULT '));
        const metrics: TrialMetrics = line
          ? JSON.parse(line.slice('CHECKPOINT_RESULT '.length))
          : { ok: false, error: `nessun risultato (exit ${child.status}${child.error ? ', ' + child.error.message : ''})`, durationMs: 0 } as TrialMetrics;
        const verdict = evaluate(taskId, ws, metrics);
        rows.push(`| ${taskId} | ${mode} | ${rep} | ${verdict.success} | ${Math.round((metrics.durationMs ?? 0) / 1000)} | ${cell(metrics.totalTokens)} | ${cell(metrics.peakPromptTokens)} | ${cell(metrics.peakPressure)} | ${cell(metrics.prepareDecisions)}/${cell(metrics.delegateDecisions)} | ${cell(metrics.delegationsCompleted)}/${cell(metrics.delegationsBlocked)}/${cell(metrics.delegationsFailed)} | ${cell(metrics.childTokens)}/${cell(metrics.returnedTokens)} | ${cell(metrics.amplification)} | ${verdict.note.replace(/\|/g, '/')} |`);
        console.log(`    → ${verdict.success} · ${Math.round((metrics.durationMs ?? 0) / 1000)} s · ${verdict.note}`);
        if (taskId === 'C') answers.push(`## Scheduler ${mode} · prova ${rep}\n\nVoto (1–5): ___\n\n${metrics.answer || metrics.error || '(nessuna risposta)'}\n`);
        if (n === 1 && metrics.ok) console.log(`    provider ${metrics.provider} · modello ${metrics.model} · finestra ${cell(metrics.contextWindow)} token`);
      }
    }
  }
  resetWorktree(ws);

  const header = [
    '# Checkpoint A — risultati',
    '',
    `Eseguito il ${new Date().toLocaleString('it-IT')}. Worktree: \`${ws}\`. Ripetizioni per modalità: ${reps}. Agente neutro: ruolo developer, tratto professional, nessun personaggio.`,
    '',
    'Colonne: esito · durata (s) · token totali · picco token del prompt · picco di pressione · decisioni prepare/delegate · deleghe completate/bloccate/fallite · token figlio/restituiti · amplificazione · note.',
    '',
    '| Task | Scheduler | Prova | Esito | Durata s | Token | Picco prompt | Picco pressione | prep/deleg | compl/bloc/fall | figlio/restituiti | Amplif. | Note |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const footer = [
    '',
    '## Come leggerlo',
    '',
    '- Se con lo scheduler acceso non compare mai `delegate` (colonna prep/deleg), la finestra di contesto è troppo grande per questi task: riducila (es. `-c 16384`) e ripeti.',
    '- Tenere la delega automatica se, almeno per un tipo di task, "on" completa dove "off" fallisce o degrada, senza peggiorare gli altri.',
    '- Toglierla (tenendo `spawn_agent` manuale) se gli esiti sono uguali e "on" costa più token o tempo, o se introduce errori.',
    '- Il task C va votato a mano in `answers.md`.',
  ];
  fs.writeFileSync(path.join(outDir, 'results.md'), [...header, ...rows, ...footer].join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'answers.md'), answers.join('\n'));
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`\nRisultati: ${path.join(outDir, 'results.md')}\nRisposte del task C: ${path.join(outDir, 'answers.md')}`);
}

main().catch((error) => {
  console.error('checkpoint-a failed:', error?.message ?? error);
  process.exit(1);
});
