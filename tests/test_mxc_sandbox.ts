/**
 * T25.2: the `mxc` backend against an injected fake SDK — runs everywhere, no MXC needed.
 *
 * Pins the policy TSUKA builds (paths, network, UI, environment), the mapping of streams, exit
 * and kill onto the ExecutionSandbox contract, dispose() on every branch, and the explicit
 * refusal when the backend cannot run (never a fallback to host).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { resetLogSink, setLogSink } from '../src/core/logSink';
import { buildChildEnv } from '../src/core/credentials';
import { getShellConfig } from '../src/core/platform';
import {
  buildMxcRequest, createMxcSandbox, mxcNodeProblem,
  MxcContainerRequest, MxcProcessLike, MxcSandboxDeps, MxcSdkLike,
} from '../src/safety/sandbox/mxcSandbox';
import type { SandboxLaunchRequest } from '../src/safety/sandbox';

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

const CANARY = 'TSUKA_T252_FAKE_API_KEY';

class FakeMxcProcess implements MxcProcessLike {
  readonly standardOutput = new PassThrough();
  readonly standardError = new PassThrough();
  kills = 0;
  disposals = 0;
  private settle!: (result: { exitCode: number; timedOut: boolean }) => void;
  private fail!: (err: Error) => void;
  private readonly done = new Promise<{ exitCode: number; timedOut: boolean }>((resolve, reject) => {
    this.settle = resolve;
    this.fail = reject;
  });

  wait() { return this.done; }
  kill(): void {
    this.kills++;
    this.finish(1);
  }
  dispose(): void { this.disposals++; }

  finish(exitCode: number): void {
    this.standardOutput.end();
    this.standardError.end();
    this.settle({ exitCode, timedOut: false });
  }
  crash(message: string): void {
    this.standardOutput.end();
    this.standardError.end();
    this.fail(Object.assign(new Error(message), { code: 'backend_unavailable' }));
  }
}

/** A fake SDK whose spawn() is resolved by the test, so ordering races can be staged. */
function fakeSdk(methods = ['processcontainer']) {
  const spawned: Array<{ request: MxcContainerRequest; process: FakeMxcProcess; release: () => void; reject: (err: Error) => void }> = [];
  const sdk: MxcSdkLike = {
    getPlatformSupport: () => ({ isSupported: true, availableMethods: methods }),
    spawn: (request) => new Promise((resolve, reject) => {
      const process = new FakeMxcProcess();
      spawned.push({ request, process, release: () => resolve(process), reject });
    }),
  };
  return { sdk, spawned };
}

function deps(overrides: Partial<MxcSandboxDeps> & { sdk?: MxcSdkLike }): MxcSandboxDeps {
  const sdk = overrides.sdk ?? fakeSdk().sdk;
  return {
    loadSdk: () => sdk,
    nodeVersion: '26.12.1',
    platform: 'win32',
    network: () => 'deny',
    ...overrides,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function main(): Promise<void> {
  console.log('=== MXC backend contract (T25.2, fake SDK) ===\n');
  setLogSink({ log: () => {}, warn: () => {}, error: () => {}, write: () => {} });
  process.env[CANARY] = 'sk-fake-canary';

  const workspace = path.resolve(os.tmpdir(), 'tsuka-mxc-ws');
  // Windows spells SystemRoot in mixed case; given explicitly so the check runs on any host.
  const env = { ...buildChildEnv(), SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  const launch: SandboxLaunchRequest = { command: 'Write-Output hi', cwd: workspace, workspaceRoot: workspace, env };

  // --- policy ---
  const policy = buildMxcRequest(launch, 'processcontainer', 'deny', 'win32');
  check('MC.1', JSON.stringify(policy.filesystem) === JSON.stringify({ readwritePaths: [workspace], readonlyPaths: [] }) && policy.workingDirectory === workspace,
    'the workspace is the only read-write path and the working directory');
  check('MC.2', policy.network.egress.default === 'deny' && buildMxcRequest(launch, 'processcontainer', 'allow', 'win32').network.egress.default === 'allow',
    'egress follows sandbox.network (deny by default)');
  check('MC.3', policy.ui.disable === false && policy.containment.type === 'processcontainer',
    'UI stays enabled (T25.0: user32 needs it) on the stable per-OS backend');
  check('MC.4', policy.environment[CANARY] === undefined && !!policy.environment.SYSTEMROOT && !!policy.environment.LOCALAPPDATA &&
    Object.keys(policy.environment).filter((key) => key.toUpperCase() === 'SYSTEMROOT').length === 1,
    'environment: no credential canary; SYSTEMROOT and LOCALAPPDATA present exactly once');
  const staging = path.resolve(os.tmpdir(), 'tsuka-mxc-staging');
  const branch = buildMxcRequest({ ...launch, workspaceRoot: staging }, 'processcontainer', 'deny', 'win32');
  check('MC.5', branch.filesystem.readwritePaths[0] === staging && branch.filesystem.readonlyPaths[0] === workspace,
    'in a PARALLEL branch only the staging folder is writable; the real workspace is read-only');
  check('MC.6', policy.command.startsWith(getShellConfig().shell) && /"Write-Output hi"$/.test(policy.command) &&
    buildMxcRequest({ ...launch, command: `echo 'a b'` }, 'bubblewrap', 'deny', 'linux').command.endsWith(`'echo '\\''a b'\\'''`),
    'the command line is the host shell invocation, quoted per platform');

  // --- availability ---
  check('MC.7', mxcNodeProblem('26.4.0') !== null && mxcNodeProblem('26.8.0') === null && mxcNodeProblem('24.20.1') !== null &&
    mxcNodeProblem('24.21.0') === null && mxcNodeProblem('25.9.0') !== null && mxcNodeProblem('20.18.0') !== null && mxcNodeProblem('27.0.0') === null,
    'Node gate: >= 24.21 or >= 26.8, odd/older lines refused, newer majors accepted');
  let loads = 0;
  const oldNode = createMxcSandbox(deps({ nodeVersion: '22.12.0', loadSdk: () => { loads++; return fakeSdk().sdk; } })).describe();
  check('MC.8', !oldNode.available && /Node >= 24\.21 or >= 26\.8/.test(oldNode.reason ?? '') && loads === 0,
    'an old Node is refused with the versions to install, before the SDK is even loaded');
  const missing = createMxcSandbox(deps({ loadSdk: () => { throw new Error("Cannot find module '@microsoft/mxc-sdk/v1'"); } })).describe();
  check('MC.9', !missing.available && /npm install --include=optional/.test(missing.reason ?? ''), 'a missing package says how to install it');
  const noMethod = createMxcSandbox(deps({ sdk: fakeSdk(['hyperlight']).sdk })).describe();
  const noOs = createMxcSandbox(deps({ platform: 'aix' })).describe();
  check('MC.10', !noMethod.available && /processcontainer/.test(noMethod.reason ?? '') && !noOs.available && /aix/.test(noOs.reason ?? ''),
    'an unavailable container backend or OS is refused with the reason');
  check('MC.11', /processcontainer, workspace only, network deny/.test(createMxcSandbox(deps({})).describe().detail ?? ''),
    'an available backend describes what it confines');

  // --- lifecycle ---
  const normal = fakeSdk();
  const normalProc = createMxcSandbox(deps({ sdk: normal.sdk })).launch(launch);
  const chunks: string[] = [];
  normalProc.onStdout((text) => chunks.push(text));
  await tick();
  normal.spawned[0].release();
  await tick();
  normal.spawned[0].process.standardOutput.write('streamed ');
  await tick();
  const beforeExit = chunks.join('');
  normal.spawned[0].process.standardOutput.write('output');
  normal.spawned[0].process.finish(7);
  const normalExit = await normalProc.exited;
  check('MC.12', beforeExit === 'streamed ' && chunks.join('') === 'streamed output' && normalExit.exitCode === 7 && normal.spawned[0].process.disposals === 1,
    'stdout streams before exit, the exit code maps through, dispose() runs once');

  const killed = fakeSdk();
  const killedProc = createMxcSandbox(deps({ sdk: killed.sdk })).launch(launch);
  await tick();
  killed.spawned[0].release();
  await tick();
  await killedProc.terminate(750);
  const killedExit = await killedProc.exited;
  check('MC.13', killed.spawned[0].process.kills === 1 && killedExit.exitCode === null && killed.spawned[0].process.disposals === 1,
    'terminate() kills the container, reports a signal-like exit, disposes');

  const early = fakeSdk();
  const earlyProc = createMxcSandbox(deps({ sdk: early.sdk })).launch(launch);
  const earlyTerminate = earlyProc.terminate(750);
  await tick();
  early.spawned[0].release();
  await earlyTerminate;
  await earlyProc.exited;
  check('MC.14', early.spawned[0].process.kills === 1 && early.spawned[0].process.disposals === 1,
    'a terminate() that arrives before the container starts kills it as soon as it exists');

  const crashed = fakeSdk();
  const crashedProc = createMxcSandbox(deps({ sdk: crashed.sdk })).launch(launch);
  await tick();
  crashed.spawned[0].release();
  await tick();
  crashed.spawned[0].process.crash('stream setup failed');
  const crashError = await crashedProc.exited.then(() => null, (err: Error) => err);
  check('MC.15', /MXC \[backend_unavailable\]: stream setup failed/.test(crashError?.message ?? '') && crashed.spawned[0].process.disposals === 1,
    'a failing wait() rejects with the MXC code and still disposes');

  const refused = fakeSdk();
  const refusedProc = createMxcSandbox(deps({ sdk: refused.sdk })).launch(launch);
  await tick();
  refused.spawned[0].reject(Object.assign(new Error('policy rejected'), { code: 'policy_validation' }));
  const refusedError = await refusedProc.exited.then(() => null, (err: Error) => err);
  check('MC.16', /MXC \[policy_validation\]: policy rejected/.test(refusedError?.message ?? ''), 'a refused spawn rejects with the MXC code');

  // --- through the tool: unavailable means nothing runs, no host fallback ---
  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-mxc-home-'));
  const priorHome = process.env.TSUKA_HOME;
  try {
    process.env.TSUKA_HOME = testHome;
    fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(testHome, 'providers.json'));
    fs.writeFileSync(path.join(testHome, 'tsuka.config.json'), JSON.stringify({ activeProvider: 'ollama', sandbox: { backend: 'mxc' } }));
    const { registerExecutionSandbox, describeActiveSandbox, formatSandboxStatus } = await import('../src/safety/sandbox');
    const { executeCommandTool } = await import('../src/tools/impl/executeCommand');
    const blocked = fakeSdk();
    registerExecutionSandbox(createMxcSandbox(deps({ sdk: blocked.sdk, nodeVersion: '26.4.0' })));
    const result = await executeCommandTool.execute({ command: 'Write-Output must-not-run' });
    check('MC.17', /execution sandbox 'mxc' is not available: MXC needs Node/.test(result) && /Nothing was executed/.test(result) && blocked.spawned.length === 0,
      'execute_command refuses with the reason and never launches');
    const line = formatSandboxStatus(describeActiveSandbox());
    check('MC.18', /^mxc UNAVAILABLE: MXC needs Node .* execute_command will refuse to run$/.test(line), 'the status line shown at startup and in /info names the refusal');
  } finally {
    if (priorHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = priorHome;
    fs.rmSync(testHome, { recursive: true, force: true });
    delete process.env[CANARY];
    resetLogSink();
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  resetLogSink();
  console.error('Fatal test error:', error);
  process.exit(1);
});
