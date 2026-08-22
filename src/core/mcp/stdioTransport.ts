/**
 * Stdio transport for the MCP client: launches the server as a child process
 * and exchanges newline-delimited JSON-RPC 2.0 frames over stdin/stdout.
 *
 * Requests are correlated by monotonically increasing numeric ids; each one
 * carries its own timeout so a wedged server can never hang a tool round.
 * Server-initiated requests and notifications are not supported by this
 * transport (nothing in TSUKA subscribes to them): notifications are dropped,
 * server requests are answered with a method-not-found error so the peer
 * never waits on us.
 */

import { spawn, ChildProcess } from 'child_process';
import { logSink } from '../logSink';
import type { JsonRpcRequest, JsonRpcNotification, JsonRpcResponse } from './types';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Default per-request timeout in ms. */
  requestTimeoutMs: number;
}

export class McpTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpTransportError';
  }
}

export class StdioTransport {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private closedByUs = false;

  constructor(private readonly options: StdioTransportOptions) {}

  /** True while the child process is alive and piped. */
  get alive(): boolean {
    return !!this.child && !this.killed;
  }

  private get killed(): boolean {
    return this.closedByUs || (!!this.child && this.child.exitCode !== null);
  }

  /**
   * Spawns the server process. Resolves once stdio streams are wired; the MCP
   * handshake itself is the client's job.
   */
  start(): void {
    if (this.child) {
      throw new McpTransportError('Transport already started');
    }
    // Directive 4: the merged env may carry credentials — it is passed to the
    // child but never logged, here or anywhere else in the MCP package.
    this.child = spawn(this.options.command, this.options.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.options.env ?? {}) },
      windowsHide: true,
      shell: false,
    });

    const stderrChunks: string[] = [];
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (chunk: string) => this.onData(chunk));
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (chunk: string) => {
      // Kept bounded: surfaced only on abnormal exit or first lines as diagnostics.
      if (stderrChunks.length < 20) stderrChunks.push(chunk);
    });
    this.child.on('error', (err) => {
      logSink.error(`MCP server '${this.options.command}' failed to start: ${err.message}`);
      this.failAllPending(new McpTransportError(`MCP server '${this.options.command}' failed to start: ${err.message}`));
    });
    this.child.on('exit', (code, signal) => {
      if (!this.closedByUs) {
        const tail = stderrChunks.join('').trim().split('\n').pop() ?? '';
        const reason = tail ? ` Last output: ${tail.slice(0, 200)}` : '';
        logSink.error(`MCP server '${this.options.command}' exited unexpectedly (code=${code}, signal=${signal}).${reason}`);
        this.failAllPending(new McpTransportError(`MCP server '${this.options.command}' exited unexpectedly (code=${code}, signal=${signal}).${reason}`));
      }
    });
  }

  /**
   * Sends one request and resolves with the `result` member of the response.
   * Rejects with a descriptive Error on timeout, transport death, JSON-RPC
   * error responses, and unparseable frames.
   */
  request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    if (!this.alive) {
      return Promise.reject(new McpTransportError(`MCP server '${this.options.command}' is not running`));
    }
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const effectiveTimeout = timeoutMs ?? this.options.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpTransportError(`MCP request '${method}' timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child!.stdin!.write(JSON.stringify(request) + '\n', (err) => {
          if (err) {
            this.pending.delete(id);
            clearTimeout(timer);
            reject(new McpTransportError(`Failed writing to MCP server stdin: ${err.message}`));
          }
        });
      } catch (err: any) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new McpTransportError(`Failed writing to MCP server stdin: ${err?.message ?? String(err)}`));
      }
    });
  }

  /** Fire-and-forget notification (no id, no reply). */
  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.alive) return;
    const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    try {
      this.child!.stdin!.write(JSON.stringify(notification) + '\n');
    } catch {}
  }

  /** Kills the child process and rejects every still-pending request. */
  async close(): Promise<void> {
    this.closeSync();
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once('exit', done);
      // Do not wait forever on a stubborn process.
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        resolve();
      }, 2000).unref();
    });
    this.child = null;
  }

  /**
   * Synchronous best-effort teardown for 'exit' handlers (which cannot await):
   * rejects pending requests and signals the process without waiting for it.
   */
  closeSync(): void {
    this.closedByUs = true;
    const child = this.child;
    this.child = null;
    this.failAllPending(new McpTransportError('MCP transport closed'));
    if (!child) return;
    try { child.kill(); } catch {}
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      this.onFrame(line);
    }
  }

  private onFrame(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      logSink.warn(`Discarded malformed frame from MCP server '${this.options.command}'`);
      return;
    }
    if (message.id === undefined || message.id === null) return; // notification
    const pending = this.pending.get(Number(message.id));
    if (!pending) return;

    this.pending.delete(Number(message.id));
    clearTimeout(pending.timer);

    const response = message as JsonRpcResponse;
    if (response.error) {
      pending.reject(new McpTransportError(`MCP error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private failAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
