/** Regression tests for bounded, abortable, atomic downloads. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createDefaultRegistry } from '../src/tools/index';
import { PermissionManager } from '../src/safety/permissions';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`PASS ${id} - ${detail}`);
  } else {
    failed++;
    console.log(`FAIL ${id} - ${detail}`);
  }
}

function responseFromChunks(chunks: string[], contentLength?: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === 'content-type') return 'application/octet-stream';
        if (name.toLowerCase() === 'content-length') return contentLength ?? null;
        return null;
      },
    },
    body,
  } as unknown as Response;
}

function interruptedResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(Buffer.from('abc'));
      controller.error(new Error('simulated stream interruption'));
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    body,
  } as unknown as Response;
}

function delayedResponse(delayMs: number): Response {
  let timer: NodeJS.Timeout | undefined;
  let release: (() => void) | undefined;
  let firstPull = true;
  const body = new ReadableStream<Uint8Array>({
    pull(controller): Promise<void> | void {
      if (!firstPull) {
        controller.close();
        return;
      }
      firstPull = false;
      controller.enqueue(Buffer.from('ab'));
      return new Promise((resolve) => {
        release = resolve;
        timer = setTimeout(resolve, delayMs);
      });
    },
    cancel(): void {
      if (timer) clearTimeout(timer);
      release?.();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    body,
  } as unknown as Response;
}

function noTemporaryFiles(directory: string): boolean {
  return fs.readdirSync(directory).every((entry) => !entry.endsWith('.part'));
}

async function run(): Promise<void> {
  console.log('=== Bounded atomic download tests ===\n');
  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-download-config-'));
  const testDirectory = path.join(process.cwd(), 'output', `download-test-${randomUUID()}`);
  const priorHome = process.env.TSUKA_HOME;
  const originalFetch = globalThis.fetch;
  process.env.TSUKA_HOME = testHome;
  fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(testHome, 'providers.json'));
  fs.mkdirSync(testDirectory, { recursive: true });
  fs.writeFileSync(path.join(testHome, 'tsuka.config.json'), JSON.stringify({
    activeProvider: 'ollama',
    workspaceRoot: process.cwd(),
    downloadFetchTimeoutMs: 5_000,
    downloadMaxBytes: 4,
    webSearch: { provider: 'duckduckgo' },
    activeRole: 'developer',
    activeTrait: 'professional',
    activeCharacter: 'custom',
  }));

  try {
    const registry = await createDefaultRegistry();
    const permissionManager = new PermissionManager();
    permissionManager.setAllowAllWrite(true);
    const downloadTool = registry.getTool('download_file');
    const schemas = registry.listForLLM('gpt-4o');
    const schema = schemas.find((item: any) => item.function?.name === 'download_file');
    check('DL.1', downloadTool?.riskLevel === 'RESTRICTED', 'download_file remains a restricted tool');
    check('DL.2', !!schema?.function?.parameters, 'download_file schema is available');

    globalThis.fetch = async () => responseFromChunks(['ab', 'c']);
    const missingHeaderPath = path.join('output', path.basename(testDirectory), 'missing-header.bin');
    const missingHeader = await registry.executeTool('download_file', { url: 'https://example.com/missing', path: missingHeaderPath }, permissionManager);
    check('DL.3', missingHeader.success && fs.readFileSync(path.join(testDirectory, 'missing-header.bin'), 'utf8') === 'abc', 'a missing Content-Length streams successfully');

    const existingPath = path.join(testDirectory, 'existing.bin');
    fs.writeFileSync(existingPath, 'original');
    globalThis.fetch = async () => responseFromChunks(['ab', 'cde'], '2');
    const falseHeaderPath = path.join('output', path.basename(testDirectory), 'existing.bin');
    const falseHeader = await registry.executeTool('download_file', { url: 'https://example.com/false', path: falseHeaderPath }, permissionManager);
    check('DL.4', !falseHeader.success && fs.readFileSync(existingPath, 'utf8') === 'original' && noTemporaryFiles(testDirectory), 'a false Content-Length cannot bypass byte counting or replace an existing destination');

    globalThis.fetch = async () => responseFromChunks(['a', 'b', 'cd']);
    const chunkedPath = path.join('output', path.basename(testDirectory), 'chunked.bin');
    const chunked = await registry.executeTool('download_file', { url: 'https://example.com/chunked', path: chunkedPath }, permissionManager);
    check('DL.5', chunked.success && fs.readFileSync(path.join(testDirectory, 'chunked.bin'), 'utf8') === 'abcd', 'chunked responses stream at the exact byte limit');

    globalThis.fetch = async () => responseFromChunks(['abcde'], '5');
    const preflightPath = path.join('output', path.basename(testDirectory), 'existing.bin');
    const oversize = await registry.executeTool('download_file', { url: 'https://example.com/oversize', path: preflightPath }, permissionManager);
    check('DL.6', !oversize.success && fs.readFileSync(existingPath, 'utf8') === 'original' && noTemporaryFiles(testDirectory), 'an oversized header preserves an existing destination');

    globalThis.fetch = async () => interruptedResponse();
    const interruptedPath = path.join('output', path.basename(testDirectory), 'interrupted.bin');
    const interrupted = await registry.executeTool('download_file', { url: 'https://example.com/interrupted', path: interruptedPath }, permissionManager);
    check('DL.7', !interrupted.success && !fs.existsSync(path.join(testDirectory, 'interrupted.bin')) && noTemporaryFiles(testDirectory), 'an interrupted stream leaves no partial file');

    globalThis.fetch = async () => delayedResponse(100);
    const abortController = new AbortController();
    const abortedPath = path.join('output', path.basename(testDirectory), 'aborted.bin');
    const pending = registry.executeTool('download_file', { url: 'https://example.com/aborted', path: abortedPath }, permissionManager, undefined, undefined, undefined, undefined, undefined, undefined, abortController.signal);
    setTimeout(() => abortController.abort(), 20);
    const aborted = await pending;
    check('DL.8', !aborted.success && !fs.existsSync(path.join(testDirectory, 'aborted.bin')) && noTemporaryFiles(testDirectory), `an abort during streaming cleans up the temporary file (${aborted.output})`);

    const configPath = path.join(testHome, 'tsuka.config.json');
    const timeoutConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    timeoutConfig.downloadFetchTimeoutMs = 1_000;
    fs.writeFileSync(configPath, JSON.stringify(timeoutConfig));
    globalThis.fetch = async () => delayedResponse(1_200);
    const timeoutPath = path.join('output', path.basename(testDirectory), 'timeout.bin');
    const timeoutResult = await registry.executeTool('download_file', { url: 'https://example.com/timeout', path: timeoutPath }, permissionManager);
    check('DL.9', !timeoutResult.success && timeoutResult.output.includes('Timeout') && !fs.existsSync(path.join(testDirectory, 'timeout.bin')) && noTemporaryFiles(testDirectory), 'a timeout during streaming cleans up the temporary file');

    globalThis.fetch = async () => responseFromChunks(['abc']);
    const traversal = await registry.executeTool('download_file', { url: 'https://example.com/traversal', path: '../../../../outside.bin' }, permissionManager);
    check('DL.10', !traversal.success && traversal.output.includes('Access denied'), 'workspace traversal remains blocked before writing');
  } finally {
    globalThis.fetch = originalFetch;
    if (priorHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = priorHome;
    fs.rmSync(testDirectory, { recursive: true, force: true });
    fs.rmSync(testHome, { recursive: true, force: true });
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
