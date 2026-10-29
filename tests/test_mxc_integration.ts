/**
 * T25.2: execute_command under the real `mxc` backend.
 *
 * Runs only where it can mean something: Windows (the only OS verified in T25.0), a Node that
 * MXC streams on, and the optional SDK installed. Anywhere else it prints why it is skipped and
 * exits 0, so CI on Node 20/22 and on Linux stays green without pretending to have checked.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetLogSink, setLogSink } from '../src/core/logSink';

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await delay(20);
  }
  return fs.existsSync(filePath);
}

function ps(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const CANARY = 'TSUKA_T252_CANARY_TOKEN';
const MARKER = 'TSUKA_T252_MARKER';

async function main(): Promise<void> {
  console.log('=== MXC sandbox integration (T25.2) ===\n');

  if (process.platform !== 'win32') {
    console.log(`SKIP — MXC integration is verified on Windows only (T25.0); this host is ${process.platform}.`);
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-mxc-'));
  const testHome = path.join(base, 'home');
  const workspace = path.join(base, 'workspace');
  fs.mkdirSync(testHome);
  fs.mkdirSync(workspace);
  fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(testHome, 'providers.json'));
  fs.writeFileSync(path.join(testHome, 'tsuka.config.json'), JSON.stringify({
    activeProvider: 'ollama',
    workspaceRoot: workspace,
    sandbox: { backend: 'mxc' },
  }));
  const priorHome = process.env.TSUKA_HOME;
  process.env.TSUKA_HOME = testHome;
  process.env[CANARY] = 'sk-mxc-canary-must-not-arrive';
  process.env[MARKER] = 'marker-arrives';

  const writes: Array<{ at: number; text: string }> = [];
  setLogSink({ log: () => {}, warn: () => {}, error: () => {}, write: (text) => writes.push({ at: Date.now(), text }) });

  try {
    const { describeActiveSandbox } = await import('../src/safety/sandbox');
    const status = describeActiveSandbox();
    if (!status.available) {
      console.log(`SKIP — mxc sandbox unavailable here: ${status.reason}`);
      return;
    }
    console.log(`(sandbox: ${status.detail})\n`);
    const { executeCommandTool } = await import('../src/tools/impl/executeCommand');
    const run = (command: string, signal?: AbortSignal) =>
      executeCommandTool.execute({ command, timeout_ms: 30_000 }, signal ? { signal } : undefined);

    // --- filesystem ---
    const inside = await run(`Set-Content -LiteralPath inside.txt -Value written-inside; Get-Content inside.txt`);
    check('MX.1', inside.includes('written-inside') && fs.existsSync(path.join(workspace, 'inside.txt')),
      'writing inside the workspace works and lands on the host');

    const outsidePath = path.join(base, 'outside.txt');
    await run(`Set-Content -LiteralPath ${ps(outsidePath)} -Value escaped`);
    const profilePath = path.join(os.homedir(), `tsuka-t252-${Date.now()}.txt`);
    await run(`Set-Content -LiteralPath ${ps(profilePath)} -Value escaped`);
    check('MX.2', !fs.existsSync(outsidePath) && !fs.existsSync(profilePath), 'writing next to the workspace or in the user profile is denied');
    fs.rmSync(profilePath, { force: true });

    const siblingPath = path.join(base, 'sibling-secret.txt');
    fs.writeFileSync(siblingPath, 'sibling-secret-content');
    const sibling = await run(`Get-Content -LiteralPath ${ps(siblingPath)}`);
    check('MX.3', !sibling.includes('sibling-secret-content'), 'reading a sibling file of the workspace is denied');

    // --- network and environment ---
    const net = await run(`try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 http://example.com).StatusCode } catch { 'net-denied' }`);
    check('MX.4', net.includes('net-denied') && !/\b200\b/.test(net), 'outbound network is denied by default');

    const env = await run(`Write-Output "canary=[$env:${CANARY}] marker=[$env:${MARKER}]"`);
    check('MX.5', env.includes('canary=[]') && env.includes('marker=[marker-arrives]'),
      'the credential canary does not reach the container, ordinary variables do');

    // --- the tool's own behavior is unchanged ---
    const quoted = await run(`Write-Output 'say "hi" C:\\dir\\'; exit 3`);
    check('MX.6', quoted.includes('say "hi" C:\\dir\\') && quoted.includes('[Process exited with code: 3]'),
      'quotes and backslashes survive the command line; a non-zero exit is reported');

    writes.length = 0;
    const started = Date.now();
    const streamed = await run(`Write-Output first-chunk; Start-Sleep -Milliseconds 1200; Write-Output second-chunk`);
    const first = writes.find((w) => w.text.includes('first-chunk'));
    const second = writes.find((w) => w.text.includes('second-chunk'));
    check('MX.7', !!first && !!second && second.at - first.at >= 800 && streamed.includes('second-chunk'),
      `output streams while the command runs (first after ${first ? first.at - started : '?'} ms, gap ${first && second ? second.at - first.at : '?'} ms)`);

    // --- abort reaches the grandchild ---
    const readyPath = path.join(workspace, 'ready.txt');
    const survivorPath = path.join(workspace, 'survivor.txt');
    const childScript = `Start-Sleep -Milliseconds 2500; Set-Content -LiteralPath ${ps(survivorPath)} -Value survived`;
    const controller = new AbortController();
    const running = run([
      `Set-Content -LiteralPath ${ps(readyPath)} -Value ready`,
      `$child = Start-Process -FilePath powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-Command',${ps(childScript)})`,
      'Wait-Process -Id $child.Id',
    ].join('; '), controller.signal);
    const childStarted = await waitForFile(readyPath, 10_000);
    await delay(500);
    controller.abort();
    const aborted = await running;
    await delay(3_000);
    check('MX.8', childStarted && /cancelled by user/i.test(aborted) && !fs.existsSync(survivorPath),
      'abort terminates the container, grandchild included (its delayed write never happens)');
  } finally {
    resetLogSink();
    delete process.env[CANARY];
    delete process.env[MARKER];
    if (priorHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = priorHome;
    fs.rmSync(base, { recursive: true, force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  resetLogSink();
  console.error('Fatal test error:', error);
  process.exit(1);
});
