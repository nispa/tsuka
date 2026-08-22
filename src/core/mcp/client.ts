/**
 * MCP client implementing the initialize handshake, tools/list and tools/call
 * over a pluggable transport (default: StdioTransport). Wire-protocol literals
 * (protocol version, method names) are owned by this module, per constants.ts.
 */

import { StdioTransport, McpTransportError } from './stdioTransport';
import type {
  IMcpClient,
  McpCallResult,
  McpToolDescriptor,
} from './types';
import { MCP_DEFAULTS } from '../constants';

/** Latest protocol version this client speaks; servers may negotiate older ones. */
const PROTOCOL_VERSION = '2024-11-05';

export interface McpClientOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Per-request timeout in ms (falls back to MCP_DEFAULTS.requestTimeoutMs). */
  timeoutMs?: number;
}

interface InitializeResult {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
}

export class McpClient implements IMcpClient {
  private transport: StdioTransport | null = null;
  private isReady = false;

  constructor(private readonly options: McpClientOptions) {}

  get connected(): boolean {
    return this.isReady && !!this.transport?.alive;
  }

  /** Human-readable server label for logs (never includes env values). */
  get label(): string {
    const args = (this.options.args ?? []).join(' ');
    return args.length > 0 ? `${this.options.command} ${args}` : this.options.command;
  }

  async connect(): Promise<void> {
    if (this.isReady) return;
    this.transport = new StdioTransport({
      command: this.options.command,
      args: this.options.args,
      env: this.options.env,
      requestTimeoutMs: this.options.timeoutMs ?? MCP_DEFAULTS.requestTimeoutMs,
    });
    this.transport.start();

    const initResult = await this.transport.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'tsuka', version: '0.6.0' },
      },
      MCP_DEFAULTS.initializeTimeoutMs
    ) as InitializeResult;

    // A server replying with a different major protocol version is a hard
    // mismatch we cannot reason about; anything else is accepted.
    const negotiated = initResult?.protocolVersion ?? PROTOCOL_VERSION;
    if (!negotiated.startsWith('202') && !negotiated.startsWith('20')) {
      throw new McpTransportError(`MCP server '${this.label}' replied with unsupported protocol version '${negotiated}'`);
    }

    this.transport.notify('notifications/initialized');
    this.isReady = true;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined = undefined;
    do {
      const params: Record<string, unknown> = {};
      if (cursor) params.cursor = cursor;
      const result = await this.transport!.request('tools/list', params) as {
        tools?: McpToolDescriptor[];
        nextCursor?: string;
      };
      if (Array.isArray(result?.tools)) {
        tools.push(...result.tools);
      }
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<McpCallResult> {
    const result = await this.transport!.request('tools/call', { name, arguments: args ?? {} }) as McpCallResult;
    if (!result || !Array.isArray(result.content)) {
      throw new McpTransportError(`MCP tool '${name}' returned an unexpected response shape`);
    }
    return result;
  }

  async close(): Promise<void> {
    this.isReady = false;
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  /** Synchronous best-effort teardown for process 'exit' handlers. */
  closeSync(): void {
    this.isReady = false;
    if (this.transport) {
      this.transport.closeSync();
      this.transport = null;
    }
  }
}
