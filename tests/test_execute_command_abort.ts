/**
 * Regression tests for T23.5: execute_command cancellation owns the full process lifecycle.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeCommandTool } from '../src/tools/impl/executeCommand';
import { isWindows } from '../src/core/platform';
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

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildTreeCommand(readyPath: string, survivorPath: string): string {
  if (isWindows()) {
    const childScript = `Start-Sleep -Milliseconds 2500; Set-Content -LiteralPath ${quotePowerShell(survivorPath)} -Value survived`;
    return [
      `Set-Content -LiteralPath ${quotePowerShell(readyPath)} -Value ready`,
      `$child = Start-Process -FilePath powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-Command',${quotePowerShell(childScript)})`,
      'Wait-Process -Id $child.Id',
    ].join('; ');
  }
  return `printf ready > '${readyPath}'; (sleep 2.5; printf survived > '${survivorPath}') & wait`;
}

class CountingSignal extends EventTarget {
  aborted = false;
  additions = 0;
  removals = 0;

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (type === 'abort') this.additions++;
    super.addEventListener(type, callback, options);
  }

  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (type === 'abort') this.removals++;
    super.removeEventListener(type, callback, options);
  }
}

async function main(): Promise<void> {
  console.log('=== Test execute_command process-tree abort ===\n');
  setLogSink({ log: () => {}, warn: () => {}, error: () => {}, write: () => {} });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-command-abort-'));

  try {
    const preAborted = new AbortController();
    preAborted.abort();
    const preResult = await executeCommandTool.execute(
      { command: 'this-command-must-not-launch' },
      { signal: preAborted.signal }
    );
    check('P23.5.1', /cancelled before launch/i.test(preResult), 'an already-aborted signal prevents spawn');

    const readyPath = path.join(tempDir, 'ready.txt');
    const survivorPath = path.join(tempDir, 'survivor.txt');
    const controller = new AbortController();
    const running = executeCommandTool.execute(
      { command: buildTreeCommand(readyPath, survivorPath), timeout_ms: 10_000 },
      { signal: controller.signal }
    );
    const childStarted = await waitForFile(readyPath, 2_000);
    controller.abort();
    const abortResult = await running;
    await delay(2_800);
    check('P23.5.2a', childStarted, 'the fixture launched its descendant before cancellation');
    check('P23.5.2b', /cancelled by user/i.test(abortResult), 'active cancellation is visible and not reported as success');
    check('P23.5.2c', !fs.existsSync(survivorPath), 'the descendant was terminated before its delayed write');

    const timeoutReadyPath = path.join(tempDir, 'timeout-ready.txt');
    const timeoutSurvivorPath = path.join(tempDir, 'timeout-survivor.txt');
    const timeoutResult = await executeCommandTool.execute({
      command: buildTreeCommand(timeoutReadyPath, timeoutSurvivorPath),
      timeout_ms: 1_000,
    });
    await delay(2_800);
    check('P23.5.3a', /timed out/i.test(timeoutResult), 'timeout reports a terminal failure');
    check('P23.5.3b', !fs.existsSync(timeoutSurvivorPath), 'timeout also terminates the descendant tree');

    const countingSignal = new CountingSignal();
    const marker = `cleanup_${Date.now()}`;
    const command = isWindows() ? `Write-Output ${marker}` : `printf ${marker}`;
    const normalResult = await executeCommandTool.execute(
      { command },
      { signal: countingSignal as unknown as AbortSignal }
    );
    check('P23.5.4a', normalResult.includes(marker), 'normal completion remains unchanged');
    check(
      'P23.5.4b',
      countingSignal.additions === 1 && countingSignal.removals === 1,
      'normal completion removes its abort listener exactly once'
    );

    const raceController = new AbortController();
    const racePromise = executeCommandTool.execute({ command }, { signal: raceController.signal });
    setTimeout(() => raceController.abort(), 0);
    const raceResult = await racePromise;
    check(
      'P23.5.5',
      raceResult.includes(marker) || /cancelled by user/i.test(raceResult),
      'completion and cancellation race resolves through one valid terminal state'
    );
  } finally {
    resetLogSink();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  resetLogSink();
  console.error('Fatal test error:', error);
  process.exit(1);
});
