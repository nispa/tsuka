import { ConfigManager } from './config';
import { LLMProvider, setLlmTimeoutMs, type ILLMProvider } from './provider';
import { createDefaultRegistry } from '../tools/index';
import type { IToolRegistry } from '../tools/registry';
import { PermissionManager, type PermissionPromptHandler } from '../safety/permissions';
import { connectMcpServers, type McpConnection, type McpConnectReport } from './mcp/connectMcpServers';

import { loadEnvironmentVariables } from './apphome';

export interface HarnessRuntimeOptions {
  configManager?: ConfigManager;
  permissionHandler?: PermissionPromptHandler;
  connectMcp?: boolean;
  customRegistry?: IToolRegistry;
  customProvider?: ILLMProvider;
}

export interface HarnessRuntime {
  readonly configManager: ConfigManager;
  readonly provider: ILLMProvider;
  readonly registry: IToolRegistry;
  readonly permissionManager: PermissionManager;
  readonly mcpReport?: McpConnectReport;
  close(): Promise<void>;
}

/**
 * Shared composition root: bootstraps harness dependencies, registers native and
 * external tools, instantiates provider and safety managers, and manages lifecycle.
 */
export async function createHarnessRuntime(options?: HarnessRuntimeOptions): Promise<HarnessRuntime> {
  loadEnvironmentVariables();
  const configManager = options?.configManager ?? new ConfigManager();
  setLlmTimeoutMs(configManager.getLlmTimeoutMs());

  const permissionManager = new PermissionManager(options?.permissionHandler);
  const registry = options?.customRegistry ?? (await createDefaultRegistry());

  let mcpReport: McpConnectReport | undefined;
  let mcpConnection: McpConnection | undefined;
  if (options?.connectMcp !== false) {
    mcpConnection = await connectMcpServers(registry, configManager.getMcpServers());
    mcpReport = mcpConnection;
  }

  let provider = options?.customProvider;
  if (!provider) {
    const activeConfig = configManager.getActiveProviderConfig();
    provider = new LLMProvider(activeConfig.baseUrl, configManager.getApiKey(), activeConfig.model, activeConfig.class);
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await mcpConnection?.close();
  };

  return {
    configManager,
    provider,
    registry,
    permissionManager,
    mcpReport,
    close,
  };
}
