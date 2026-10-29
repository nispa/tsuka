/**
 * T25.1: execute_command launches its shell through the ExecutionSandbox contract.
 *
 * A fake backend selected by `sandbox.backend` must receive the command, the workspace cwd and
 * the credential-free environment; its terminate() must run on timeout and on abort; an unknown
 * or unavailable backend must refuse without launching anything (fail closed, never `host`).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetLogSink, setLogSink } from '../src/core/logSink';
import type { SandboxExit, SandboxLaunchRequest, SandboxProcess } from '../src/safety/sandbox';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

const CANARY = 'TSUKA_T251_CANARY_API_KEY';

/** Scripted process: the test decides when output arrives and how it ends. */
class FakeProcess implements SandboxProcess {
  readonly exited: Promise<SandboxExit>;
  terminations: number[] = [];
  private stdout: Array<(text: string) => void> = [];
  private settle!: (exit: SandboxExit) => void;

  constructor() {
    this.exited = new Promise((resolve) => { this.settle = resolve; });
  }

  onStdout(listener: (text: string) => void): void { this.stdout.push(listener); }
  onStderr(): void {}

  emit(text: string): void { this.stdout.forEach((listener) => listener(text)); }
  exit(code: number): void { this.settle({ exitCode: code }); }

  async terminate(gracePeriodMs: number): Promise<void> {
    this.terminations.push(gracePeriodMs);
    this.settle({ exitCode: null });
  }
}

async function main(): Promise<void> {
  console.log('=== Execution sandbox contract (T25.1) ===\n');
  setLogSink({ log: () => {}, warn: () => {}, error: () => {}, write: () => {} });

  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-sandbox-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-sandbox-ws-'));
  const configPath = path.join(testHome, 'tsuka.config.json');
  const writeConfig = (backend: string) => fs.writeFileSync(configPath, JSON.stringify({
    activeProvider: 'ollama',
    workspaceRoot: workspace,
    sandbox: { backend },
  }));
  const priorHome = process.env.TSUKA_HOME;
  process.env.TSUKA_HOME = testHome;
  process.env[CANARY] = 'sk-sandbox-canary';
  fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(testHome, 'providers.json'));

  try {
    const { registerExecutionSandbox } = await import('../src/safety/sandbox');
    const { executeCommandTool } = await import('../src/tools/impl/executeCommand');
    const { TOOLS_DEFAULTS } = await import('../src/core/constants');

    const launches: Array<{ request: SandboxLaunchRequest; process: FakeProcess }> = [];
    registerExecutionSandbox({
      name: 'fake',
      describe: () => ({ name: 'fake', available: true }),
      launch: (request) => {
        const process = new FakeProcess();
        launches.push({ request, process });
        return process;
      },
    });
    registerExecutionSandbox({
      name: 'offline',
      describe: () => ({ name: 'offline', available: false, reason: 'requires Node >= 99' }),
      launch: () => { throw new Error('offline sandbox must never launch'); },
    });
    writeConfig('fake');

    // --- the backend receives the request ---
    const normal = executeCommandTool.execute({ command: 'echo sandboxed' });
    const first = launches[0];
    check('SB.1', first?.request.command === 'echo sandboxed', 'the command reaches the backend verbatim');
    check('SB.2', !!first && path.resolve(first.request.cwd) === path.resolve(workspace), 'cwd is the configured workspace root');
    check('SB.3', !!first && first.request.env[CANARY] === undefined && !!(first.request.env.PATH ?? first.request.env.Path),
      'env comes from buildChildEnv: PATH kept, credential canary removed');
    first?.process.emit('sandboxed\n');
    first?.process.exit(0);
    const normalResult = await normal;
    check('SB.4', normalResult.includes('sandboxed') && first?.process.terminations.length === 0,
      'streamed output is returned on a clean exit, without terminating');

    // --- timeout and abort go through terminate() ---
    const timedOut = await executeCommandTool.execute({ command: 'hang', timeout_ms: TOOLS_DEFAULTS.commandMinTimeoutMs });
    const timeoutProcess = launches[1]?.process;
    check('SB.5', /timed out/i.test(timedOut) && timeoutProcess?.terminations[0] === TOOLS_DEFAULTS.commandTerminationGraceMs,
      'timeout calls terminate() with the configured grace period');

    const controller = new AbortController();
    const aborted = executeCommandTool.execute({ command: 'hang', timeout_ms: 10_000 }, { signal: controller.signal });
    controller.abort();
    const abortResult = await aborted;
    check('SB.6', /cancelled by user/i.test(abortResult) && launches[2]?.process.terminations.length === 1,
      'abort calls terminate() exactly once');

    // --- fail closed: nothing launches, nothing falls back to host ---
    const before = launches.length;
    writeConfig('offline');
    const offlineResult = await executeCommandTool.execute({ command: 'echo must-not-run' });
    check('SB.7', /not available: requires Node >= 99/.test(offlineResult) && /Nothing was executed/.test(offlineResult),
      'an unavailable backend refuses with its reason');

    writeConfig('no-such-sandbox');
    const unknownResult = await executeCommandTool.execute({ command: 'echo must-not-run' });
    check('SB.8', /Unknown execution sandbox 'no-such-sandbox'/.test(unknownResult) && /host/.test(unknownResult) && launches.length === before,
      'an unknown backend refuses and lists the registered ones; no backend launched');

    // --- the tool is decoupled from the mechanism ---
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'tools', 'impl', 'executeCommand.ts'), 'utf-8');
    check('SB.9', !/child_process|getShellConfig/.test(source), 'execute_command no longer imports child_process or the shell config');
  } finally {
    resetLogSink();
    delete process.env[CANARY];
    if (priorHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = priorHome;
    fs.rmSync(testHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  resetLogSink();
  console.error('Fatal test error:', error);
  process.exit(1);
});
