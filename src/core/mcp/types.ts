/**
 * MCP (Model Context Protocol) client contracts and wire types.
 *
 * TSUKA speaks MCP as a client over the stdio transport only: every configured
 * server is a child process exchanging newline-delimited JSON-RPC 2.0 frames.
 * `IMcpClient` is the swappable contract (AGENTS.md directive 8): a future
 * Streamable-HTTP implementation plugs in behind the same interface without
 * touching the registry or the adapter.
 */

import type { McpServerConfigEntry } from '../config/types';

/** One entry of the `mcpServers` section in tsuka.config.json. */
export type McpServerConfig = McpServerConfigEntry;

/** JSON-RPC 2.0 request envelope sent to an MCP server. */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 notification (no id, no response expected). */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 error object inside a response. */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 2.0 response envelope received from an MCP server. */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

/** Tool descriptor returned by the `tools/list` MCP method. */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** JSON Schema of the tool arguments (MCP calls it inputSchema). */
  inputSchema?: Record<string, unknown>;
}

/** Content block returned by `tools/call`. Only text blocks are rendered today. */
export interface McpContentBlock {
  type: string;
  text?: string;
}

/** Result payload of a successful `tools/call`. */
export interface McpCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

/** Swappable MCP client contract (directive 8). */
export interface IMcpClient {
  /** Performs the initialize handshake; resolves once the server is ready. */
  connect(): Promise<void>;
  /** Lists tools exposed by the server, following pagination cursors. */
  listTools(): Promise<McpToolDescriptor[]>;
  /** Invokes one tool and returns its content blocks. */
  callTool(name: string, args: Record<string, unknown> | undefined): Promise<McpCallResult>;
  /** Gracefully terminates the connection (kills the child process). */
  close(): Promise<void>;
  /** True between a successful connect() and close(). */
  readonly connected: boolean;
}
