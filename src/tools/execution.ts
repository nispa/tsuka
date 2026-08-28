import type { PermissionManager, RiskLevel } from '../safety/permissions';
import type { ILLMProvider, ChatStats } from '../core/provider';
import type { StreamChannel } from '../core/thinkParser';
import type { AgentEventHandler } from '../core/agentEvents';
import type { WorkflowDispatcher } from '../core/workflowDispatcher';
import { sanitizeToolCallArguments } from './jsonRepair';
import { loadToolSchema, validateToolArgs } from './schema';
import type { Tool, ToolResult, ToolExecutionContext, ToolSetController, IToolRegistry } from './types';

type ToolArgumentRecord = Record<string, unknown>;
type DetailFormatter = (args: ToolArgumentRecord) => string | undefined;

function asArgumentRecord(args: unknown): ToolArgumentRecord {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? args as ToolArgumentRecord
    : {};
}

const TOOL_DETAIL_FORMATTERS: Record<string, DetailFormatter> = {
  execute_command: (a) => typeof a.command === 'string' ? a.command : undefined,
  write_file: (a) => (a?.path ? `Write/overwrite ${a.path}` : undefined),
  edit_file: (a) => (a?.path ? `Edit ${a.path}` : undefined),
  delete_file: (a) => (a?.path ? `Delete ${a.path}` : undefined),
  request_goal: (a) => (a?.goal ? `Escalate to /goal: "${a.goal}" (Reason: ${a.reason || 'unspecified'})` : undefined),
  request_team: (a) => (a?.team_name || a?.task ? `Convene team ${a.team_name || ''}: "${a.task}" (Reason: ${a.reason || 'unspecified'})` : undefined),
  request_call: (a) => (a?.topic ? `Start call on "${a.topic}" (Reason: ${a.reason || 'unspecified'})` : undefined),
};

export function formatPermissionDetails(toolName: string, args: unknown): string {
  const custom = TOOL_DETAIL_FORMATTERS[toolName]?.(asArgumentRecord(args));
  if (custom) return custom;
  try {
    return JSON.stringify(args) ?? String(args);
  } catch {
    return 'complex arguments';
  }
}

export interface ExecuteAuthorizedToolOptions {
  registry?: IToolRegistry;
  permissionManager: PermissionManager;
  provider?: ILLMProvider;
  requesterLabel?: string;
  workflowDispatcher?: WorkflowDispatcher;
  toolSet?: ToolSetController;
  onChunk?: (chunk: string, channel?: StreamChannel, authorName?: string) => void;
  onStats?: (stats: ChatStats, agentLabel?: string) => void;
  onEvent?: AgentEventHandler;
  signal?: AbortSignal;
}

/**
 * Executes a tool through the unified validation, risk classification, and permission workflow.
 */
export async function executeAuthorizedTool(
  tool: Tool,
  rawArgs: unknown,
  options: ExecuteAuthorizedToolOptions
): Promise<ToolResult> {
  const effectiveArgs = typeof rawArgs === 'string' ? sanitizeToolCallArguments(rawArgs).parsed : rawArgs;

  const schemaData = tool.schema ?? loadToolSchema(tool.name);
  if (schemaData.schema?.type === 'object' && schemaData.schema?.properties) {
    const validationError = validateToolArgs(effectiveArgs, schemaData.schema, tool.name);
    if (validationError) {
      return {
        success: false,
        output: `Validation error for tool '${tool.name}': ${validationError}. Please review parameters and retry.`
      };
    }
  }

  const details = formatPermissionDetails(tool.name, effectiveArgs);

  // T18.1: a tool may refine its own risk for this specific call. The refinement is trusted
  // only to the extent the tool is: it ships with the tool's own source, so it is exactly as
  // reviewable as `riskLevel` itself. A throwing or malformed classifier falls back to the
  // static level rather than to something permissive.
  let effectiveRisk: RiskLevel = tool.riskLevel;
  if (tool.classifyRisk) {
    try {
      const refined = tool.classifyRisk(effectiveArgs);
      if (refined === 'SAFE' || refined === 'RESTRICTED' || refined === 'DANGEROUS') {
        effectiveRisk = refined;
      }
    } catch {
      effectiveRisk = tool.riskLevel;
    }
  }

  const isApproved = await options.permissionManager.checkPermission(
    tool.name,
    details,
    effectiveRisk,
    options.requesterLabel
  );

  if (!isApproved) {
    return {
      success: false,
      output: `Error: Operation '${tool.name}' denied by user. Request cancelled.`
    };
  }

  const execContext: ToolExecutionContext = {
    registry: options.registry,
    provider: options.provider,
    permissionManager: options.permissionManager,
    requesterLabel: options.requesterLabel,
    workflowDispatcher: options.workflowDispatcher,
    toolSet: options.toolSet,
    onChunk: options.onChunk,
    onStats: options.onStats,
    onEvent: options.onEvent,
    signal: options.signal
  };

  try {
    const output = await tool.execute(effectiveArgs, execContext);
    return {
      success: true,
      output
    };
  } catch (error: any) {
    return {
      success: false,
      output: `Error executing tool '${tool.name}': ${error.message}`
    };
  }
}
