import type { RiskLevel, PermissionManager } from '../safety/permissions';
import type { ILLMProvider, ChatStats, ReasoningEffort, ChatToolDefinition } from '../core/provider';
import type { StreamChannel } from '../core/thinkParser';
import type { AgentEventHandler } from '../core/agentEvents';
import type { ProviderClass } from '../core/cloudProvider';
import type { WorkflowDispatcher } from '../core/workflowDispatcher';
import type { ISubagentRunner } from '../core/types';

export type ModelCapabilityTier = 'small' | 'medium' | 'large';

/**
 * Minimal view the calling Agent exposes over its own active tool set (T14.14).
 * Lets `load_tools` promote a deferred tool without the registry — shared by every
 * agent — having to know about the concrete Agent.
 */
export interface ToolSetController {
  /** Tools whose full schema travels in the `tools` array on every round. */
  getAllowedTools(): string[] | undefined;
  /** Tools available on demand, not yet sent to the model. */
  getDeferredTools(): string[];
  /** Moves the named tools from deferred to active. */
  activateTools(names: string[]): { activated: string[]; alreadyActive: string[]; unknown: string[] };
}

/** Swappable contract for ToolRegistry (Directive 8) */
export interface IToolRegistry {
  register(tool: Tool, options?: { alwaysAllow?: boolean }): void;
  unregister(name: string): boolean;
  getTool(name: string): Tool | undefined;
  getAllTools(): Tool[];
  listForLLM(
    modelName: string,
    allowedTools?: string[],
    effort?: ReasoningEffort,
    providerBaseUrl?: string,
    providerClass?: ProviderClass,
    /** Tools explicitly granted by the user for this request, overriding role and tier. */
    explicitlyEnabledTools?: readonly string[]
  ): ToolLLMDescriptor[];
  executeTool(
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
    toolSet?: ToolSetController,
    subagentRunner?: ISubagentRunner
  ): Promise<ToolResult>;
}

export interface ToolExecutionContext {
  registry?: IToolRegistry;
  provider?: ILLMProvider;
  permissionManager?: PermissionManager;
  workflowDispatcher?: WorkflowDispatcher;
  /** Subagent runner dependency for child delegation (T22.7). */
  subagentRunner?: ISubagentRunner;
  /** Calling Agent's tool set (T14.14): present only when the Agent exposes one. */
  toolSet?: ToolSetController;
  /** Requesting agent label (e.g. character aiName) for logging and note authorship attribution. */
  requesterLabel?: string;
  onChunk?: (chunk: string, channel?: StreamChannel, authorName?: string) => void;
  onStats?: (stats: ChatStats, agentLabel?: string) => void;
  onEvent?: AgentEventHandler;
  signal?: AbortSignal;
}

export interface ToolSchemaData {
  description: string;
  schema: Record<string, unknown>;
  requiredTier: ModelCapabilityTier;
}

export interface Tool<TArgs = unknown> {
  name: string;
  /** Static worst-case risk of the tool as a capability. Always the fallback. */
  riskLevel: RiskLevel;
  /**
   * Inline schema for tools whose definition does not live in tools_schemas/
   * (T20.1: MCP tools receive it from their server). When present it takes
   * precedence over `loadToolSchema(name)`; native tools leave it unset.
   */
  schema?: ToolSchemaData;
  /**
   * Optional per-invocation refinement (T18.1). `execute_command` is DANGEROUS as a capability,
   * but `git status` and `curl … | sh` are not the same request; a tool that can tell them apart
   * implements this so the permission tier follows the actual arguments. Implementations must
   * deny by default: anything they do not positively recognize stays at `riskLevel`.
   */
  classifyRisk?(args: TArgs): RiskLevel;
  execute(args: TArgs, context?: ToolExecutionContext): Promise<string>;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

export type ToolLLMDescriptor = ChatToolDefinition;
