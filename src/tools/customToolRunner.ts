import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TOOLS_DEFAULTS } from '../core/constants';
import type { Tool, ToolExecutionContext } from './types';
import { getEffectiveRoot } from './impl/utils';

/**
 * Out-of-process execution of self-authored tools (T23.8, option A).
 *
 * A generated module never runs inside TSUKA: each validation or call starts a fresh
 * Node child under the permission model — filesystem read/write only inside the
 * workspace root, no network, no child processes, no workers, no addons, no
 * eval/Function — with an empty environment (API keys never reach it), a heap
 * ceiling, a wall-clock timeout and a capped stdout. The module receives `fs` and
 * `path` and nothing else; its result travels back as one JSON line.
 *
 * Node documents its permission model as a seat belt for trusted code, not a sandbox
 * against malicious code. What this buys is defense in depth and the integrity of the
 * TSUKA process (a crash, a runaway loop or a memory blow-up stays in the child); it
 * does not make generated code safe, which is why self-authoring stays opt-in and
 * every call stays DANGEROUS.
 */

/**
 * Child program, passed with -e so no file outside the workspace needs to be readable.
 * The module source is wrapped in a function whose parameters inject `fs` and `path`;
 * the extra block lets modules written by older create_tool versions keep their own
 * `const fs = require(...jailedFs)` line, which the local require maps to the same fs.
 */
const CHILD_PROGRAM = `
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const send = (message) => process.stdout.write(JSON.stringify(message));
const toStderr = (...parts) => process.stderr.write(parts.map(String).join(' ') + '\\n');
console.log = console.info = console.warn = console.error = console.debug = toStderr;
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  try {
    const { source, name, mode, args } = JSON.parse(input);
    const localRequire = (id) => {
      if (id === 'fs') return fs;
      if (id === 'path') return path;
      if (/jailedFs$/.test(id)) return { jailedFs: fs };
      throw new Error('Module not allowed in custom tools: ' + id);
    };
    const module = { exports: {} };
    const wrapper = vm.runInThisContext('(function (exports, require, module, fs, path) {\\n{\\n' + source + '\\n}\\n})', { filename: name + '.js' });
    wrapper(module.exports, localRequire, module, fs, path);
    const tool = Object.values(module.exports).find((v) => v && typeof v.name === 'string' && typeof v.execute === 'function');
    if (!tool) throw new Error('module does not export a valid Tool instance');
    if (tool.name !== name) throw new Error("module exports tool '" + tool.name + "', expected '" + name + "'");
    if (mode === 'validate') return send({ ok: true });
    const result = await tool.execute(args || {});
    send({ ok: true, result: typeof result === 'string' ? result : JSON.stringify(result) });
  } catch (error) {
    send({ ok: false, error: String((error && error.message) || error) });
  }
});
`;

/** Node flags the confinement relies on; without --allow-net the network would stay open. */
const REQUIRED_FLAGS = ['--permission', '--allow-net', '--allow-fs-read', '--allow-fs-write'];

export function isCustomToolIsolationSupported(): boolean {
  return REQUIRED_FLAGS.every((flag) => process.allowedNodeEnvironmentFlags.has(flag));
}

export interface CustomToolRunRequest {
  name: string;
  source: string;
  mode: 'validate' | 'execute';
  args?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Runs one validation or call of a generated module in a confined child process. */
export function runCustomToolIsolated(request: CustomToolRunRequest): Promise<string> {
  if (!isCustomToolIsolationSupported()) {
    // Fail closed: running the module in-process, or without the network restriction,
    // would silently drop the confinement this runner exists to provide.
    return Promise.reject(
      new Error(`Custom tools need Node.js >= 25 (permission model with --allow-net); running ${process.version}. Refusing to execute unconfined.`)
    );
  }

  const root = path.resolve(getEffectiveRoot());
  const timeoutMs = request.timeoutMs ?? TOOLS_DEFAULTS.customToolTimeoutMs;
  // Nothing is inherited. On Windows libuv re-adds only the base variables a process
  // needs to start (PATH, SystemRoot, TEMP, USERPROFILE, ...), never user secrets.
  const env: NodeJS.ProcessEnv = {};

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${root}`,
        `--allow-fs-write=${root}`,
        '--disallow-code-generation-from-strings',
        `--max-old-space-size=${TOOLS_DEFAULTS.customToolMaxMemoryMb}`,
        '-e',
        CHILD_PROGRAM,
      ],
      { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );

    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop(new Error(`Custom tool '${request.name}' exceeded ${timeoutMs} ms and was terminated.`)), timeoutMs);
    const onAbort = () => stop(new Error(`Custom tool '${request.name}' was interrupted.`));
    if (request.signal?.aborted) onAbort();
    else request.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > TOOLS_DEFAULTS.customToolMaxOutputBytes) {
        stop(new Error(`Custom tool '${request.name}' produced more than ${TOOLS_DEFAULTS.customToolMaxOutputBytes} bytes of output.`));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      // Only kept for the error message; bounded like the result.
      if (stderr.length < TOOLS_DEFAULTS.customToolMaxOutputBytes) stderr += chunk;
    });
    child.on('error', (error) => stop(error));
    child.on('close', (code) => {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      if (failure) return reject(failure);
      let reply: { ok?: boolean; result?: string; error?: string } | undefined;
      try {
        reply = JSON.parse(stdout);
      } catch {
        const detail = stderr.trim().split('\n').slice(-3).join(' | ') || `exit code ${code}`;
        return reject(new Error(`Custom tool '${request.name}' crashed: ${detail}`));
      }
      if (reply?.ok) resolve(reply.result ?? '');
      else reject(new Error(`Custom tool '${request.name}' failed: ${reply?.error ?? 'unknown error'}`));
    });

    child.stdin.on('error', () => {
      // The child may die (e.g. startup failure) before reading its input; close reports it.
    });
    child.stdin.end(JSON.stringify({ source: request.source, name: request.name, mode: request.mode, args: request.args }));
  });
}

/** Registry entry for a generated module on disk: every call re-reads the file and runs it isolated. */
export function isolatedCustomTool(name: string, filePath: string): Tool {
  return {
    name,
    // Generated code never lowers its own confirmation tier (T14.22).
    riskLevel: 'DANGEROUS',
    execute: async (args: unknown, context?: ToolExecutionContext) =>
      runCustomToolIsolated({ name, source: fs.readFileSync(filePath, 'utf-8'), mode: 'execute', args, signal: context?.signal }),
  };
}
