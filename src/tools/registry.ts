import type { PermissionManager } from '../safety/permissions';
import type { ILLMProvider, ChatStats, ReasoningEffort } from '../core/provider';
import type { StreamChannel } from '../core/thinkParser';
import type { AgentEventHandler } from '../core/agentEvents';
import type { WorkflowDispatcher } from '../core/workflowDispatcher';

import type {
  Tool,
  ToolResult,
  ToolSchemaData,
  ToolExecutionContext,
  ToolSetController,
  ModelCapabilityTier,
  ToolLLMDescriptor,
  IToolRegistry,
} from './types';
import { loadToolSchema, validateToolArgs, fallbackSchema } from './schema';
import {
  getModelTier,
  hasNativeFunctionCalling,
  isToolEligibleForLLM,
  TIER_HIERARCHY,
  LARGE_MODEL_PATTERNS,
  WORKFLOW_ESCALATION_TOOLS,
} from './tierPolicy';
import {
  executeAuthorizedTool,
  formatPermissionDetails,
  type ExecuteAuthorizedToolOptions,
} from './execution';

export class ToolRegistry implements IToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private alwaysAllow: Set<string> = new Set();

  register(tool: Tool, options?: { alwaysAllow?: boolean }): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`A tool with name '${tool.name}' is already registered.`);
    }
    this.tools.set(tool.name, tool);
    if (options?.alwaysAllow) {
      this.alwaysAllow.add(tool.name);
    }
  }

  unregister(name: string): boolean {
    this.alwaysAllow.delete(name);
    return this.tools.delete(name);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Filters tools matching the active role, model capability tier, and reasoning effort.
   */
  listForLLM(
    modelName: string,
    allowedTools?: string[],
    effort?: ReasoningEffort,
    providerBaseUrl?: string,
    providerClass?: import('../core/cloudProvider').ProviderClass,
    explicitlyEnabledTools?: readonly string[]
  ): ToolLLMDescriptor[] {
    const modelTier = getModelTier(modelName, effort, providerBaseUrl, providerClass);
    const currentTierLevel = TIER_HIERARCHY[modelTier];
    const result: ToolLLMDescriptor[] = [];

    for (const tool of this.tools.values()) {
      const schemaData = tool.schema ?? loadToolSchema(tool.name);
      if (!explicitlyEnabledTools?.includes(tool.name) && !isToolEligibleForLLM(tool, schemaData, currentTierLevel, allowedTools, this.alwaysAllow)) {
        continue;
      }

      result.push({
        type: 'function',
        function: {
          name: tool.name,
          description: schemaData.description,
          parameters: schemaData.schema,
        },
      });
    }

    return result;
  }

  async executeTool(
    name: string,
    args: unknown,
    permissionManager: PermissionManager,
    provider?: ILLMProvider,
    requesterLabel?: string,
    workflowDispatcher?: WorkflowDispatcher,
    onChunk?: (chunk: string, channel?: StreamChannel, authorName?: string) => void,
    onStats?: (stats: ChatStats, agentLabel?: string) => void,
    onEvent?: AgentEventHandler,
    signal?: AbortSignal,
    toolSet?: ToolSetController
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: `Error: Tool '${name}' is not registered.`,
      };
    }

    return executeAuthorizedTool(tool, args, {
      registry: this,
      permissionManager,
      provider,
      requesterLabel,
      workflowDispatcher,
      toolSet,
      onChunk,
      onStats,
      onEvent,
      signal,
    });
  }
}

// Re-exports for backward compatibility
export type {
  Tool,
  ToolResult,
  ToolSchemaData,
  ToolExecutionContext,
  ToolSetController,
  ModelCapabilityTier,
  ToolLLMDescriptor,
  IToolRegistry,
  ExecuteAuthorizedToolOptions,
};

export {
  loadToolSchema,
  validateToolArgs,
  fallbackSchema,
  getModelTier,
  hasNativeFunctionCalling,
  isToolEligibleForLLM,
  TIER_HIERARCHY,
  LARGE_MODEL_PATTERNS,
  WORKFLOW_ESCALATION_TOOLS,
  executeAuthorizedTool,
  formatPermissionDetails,
};
