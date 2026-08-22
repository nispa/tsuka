/**
 * Adapter: maps MCP tool descriptors onto TSUKA native `Tool` objects so the
 * registry, the tier gating and the PermissionManager treat them exactly like
 * built-in tools. The JSON schema served by the MCP server travels inline on
 * the tool (`schema` field) instead of living in tools_schemas/.
 */

import type { Tool } from '../../tools/registry';
import type { RiskLevel } from '../../safety/permissions';
import type { IMcpClient, McpToolDescriptor } from './types';

/** Registry name for an MCP tool: origin always visible in prompts and permissions. */
export function mcpRegistryName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

/**
 * Renders the content blocks of a tools/call result into a single string.
 * Only text blocks are rendered; other block types are announced as a
 * placeholder so the model knows something came back.
 */
export function renderMcpContent(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): string {
  const parts = result.content.map((block) => {
    if (block.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
    return `[${block.type} content not rendered]`;
  });
  const joined = parts.join('\n');
  if (result.isError) {
    return `The tool reported an execution error:\n${joined}`;
  }
  return joined;
}

export interface McpAdapterOptions {
  serverName: string;
  riskLevel: RiskLevel;
}

/** Builds the TSUKA Tool wrapping one remote MCP tool. */
export function adaptMcpTool(descriptor: McpToolDescriptor, client: IMcpClient, options: McpAdapterOptions): Tool {
  const registryName = mcpRegistryName(options.serverName, descriptor.name);
  return {
    name: registryName,
    riskLevel: options.riskLevel,
    schema: {
      description: descriptor.description || `Remote tool '${descriptor.name}' from MCP server '${options.serverName}'`,
      // MCP inputSchema is already JSON Schema; default keeps validation inert.
      schema: (descriptor.inputSchema as any) ?? { type: 'object', properties: {} },
      requiredTier: 'small',
    },
    execute: async (args: any) => {
      const result = await client.callTool(descriptor.name, args ?? {});
      return renderMcpContent(result);
    },
  };
}
