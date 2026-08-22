/**
 * Connects the MCP servers configured in tsuka.config.json to a ToolRegistry.
 * A server that fails to start or to list its tools degrades visibly (logSink
 * warning) and never blocks startup: the rest of the harness works untouched.
 *
 * Active clients are tracked module-wide so the CLI/TUI entry points can shut
 * every child process down on exit via shutdownMcpServers().
 */

import type { ToolRegistry } from '../../tools/registry';
import { logSink } from '../logSink';
import { McpClient } from './client';
import { adaptMcpTool } from './adapter';
import type { IMcpClient, McpServerConfig } from './types';
import { MCP_DEFAULTS } from '../constants';

const activeClients: IMcpClient[] = [];
let shutdownHookInstalled = false;

export interface McpConnectReport {
  connected: string[];
  failed: string[];
  toolsRegistered: number;
}

/**
 * Connects every enabled server and registers its tools with the
 * `mcp__<server>__<tool>` naming convention. Name collisions (with native
 * tools or across servers) are skipped with a warning.
 */
export async function connectMcpServers(
  registry: ToolRegistry,
  servers: Record<string, McpServerConfig> | undefined,
): Promise<McpConnectReport> {
  const report: McpConnectReport = { connected: [], failed: [], toolsRegistered: 0 };
  if (!servers) return report;

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    if (serverConfig.enabled === false) continue;

    const client = new McpClient({
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env,
      timeoutMs: serverConfig.timeoutMs,
    });

    try {
      await client.connect();
      const descriptors = await client.listTools();
      if (descriptors.length === 0) {
        logSink.warn(`MCP server '${serverName}' is connected but exposes no tools`);
      }

      let registered = 0;
      for (const descriptor of descriptors) {
        if (!descriptor || typeof descriptor.name !== 'string' || descriptor.name.length === 0) continue;
        const tool = adaptMcpTool(descriptor, client, {
          serverName,
          riskLevel: serverConfig.riskLevel ?? MCP_DEFAULTS.defaultRiskLevel,
        });
        try {
          registry.register(tool);
          registered++;
        } catch (error: any) {
          logSink.warn(`Skipping MCP tool '${tool.name}': ${error.message}`);
        }
      }

      activeClients.push(client);
      installShutdownHook();
      report.connected.push(serverName);
      report.toolsRegistered += registered;
      logSink.log(`MCP server '${serverName}' connected: ${registered} tool(s) available`);
    } catch (error: any) {
      report.failed.push(serverName);
      logSink.error(`MCP server '${serverName}' failed to start (${error.message}). Its tools are unavailable; TSUKA continues without it.`);
      try { await client.close(); } catch {}
    }
  }

  return report;
}

/** Closes every connected MCP server. Safe to call multiple times. */
export async function shutdownMcpServers(): Promise<void> {
  while (activeClients.length > 0) {
    const client = activeClients.pop()!;
    try {
      await client.close();
    } catch {}
  }
}

function installShutdownHook(): void {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;
  process.on('exit', () => {
    // Synchronous best-effort kill: 'exit' handlers cannot await.
    for (const client of activeClients.splice(0)) {
      try { (client as McpClient).closeSync(); } catch {}
    }
  });
}
