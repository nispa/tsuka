import * as fs from 'fs';
import { homePath } from '../core/apphome';
import { RiskLevel, PermissionManager } from '../safety/permissions';
import { getModelProfile } from '../core/modelProfile';
import type { ReasoningEffort } from '../core/provider';
import { sanitizeToolCallArguments } from './jsonRepair';
import { logSink } from '../core/logSink';
import { WorkflowScope } from '../core/workflowScope';
import type { StreamChannel } from '../core/thinkParser';
import type { AgentEventHandler } from '../core/agentEvents';

/**
 * Optional execution context passed into tool executors (e.g. registry access
 * for hot-registering tools created by create_tool, or subagent event/chunk forwarding).
 */
export interface ToolExecutionContext {
  registry?: ToolRegistry;
  provider?: any;
  permissionManager?: PermissionManager;
  commandCtx?: any;
  /** Requesting agent label (e.g. character aiName) for logging and note authorship attribution. */
  requesterLabel?: string;
  onChunk?: (chunk: string, channel?: StreamChannel, authorName?: string) => void;
  onStats?: (stats: any) => void;
  onEvent?: AgentEventHandler;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  riskLevel: RiskLevel;
  execute: (args: any, context?: ToolExecutionContext) => Promise<string>;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

const TIER_HIERARCHY: Record<'small' | 'medium' | 'large', number> = {
  small: 1,
  medium: 2,
  large: 3,
};

const LARGE_MODEL_PATTERNS = ['gpt-', 'claude-', 'gemini-', 'meta-llama/llama-3.3-70b', 'deepseek-'];

const WORKFLOW_ESCALATION_TOOLS = new Set(['request_goal', 'request_team', 'request_call']);

type DetailFormatter = (args: any) => string | undefined;

const TOOL_DETAIL_FORMATTERS: Record<string, DetailFormatter> = {
  execute_command: (a) => a?.command,
  write_file: (a) => (a?.path ? `Write/overwrite ${a.path}` : undefined),
  edit_file: (a) => (a?.path ? `Edit ${a.path}` : undefined),
  delete_file: (a) => (a?.path ? `Delete ${a.path}` : undefined),
  request_goal: (a) => (a?.goal ? `Escalate to /goal: "${a.goal}" (Reason: ${a.reason || 'unspecified'})` : undefined),
  request_team: (a) => (a?.team_name || a?.task ? `Convene team ${a.team_name || ''}: "${a.task}" (Reason: ${a.reason || 'unspecified'})` : undefined),
  request_call: (a) => (a?.topic ? `Start call on "${a.topic}" (Reason: ${a.reason || 'unspecified'})` : undefined),
};

function formatPermissionDetails(toolName: string, args: any): string {
  const custom = TOOL_DETAIL_FORMATTERS[toolName]?.(args);
  if (custom) return custom;
  try {
    return JSON.stringify(args);
  } catch {
    return 'complex arguments';
  }
}

/**
 * Resolves the model capability tier (small, medium, large).
 * Uses measured benchmark capability fingerprinting if available;
 * otherwise falls back to model name heuristics.
 */
export function getModelTier(modelName: string, effort?: ReasoningEffort): 'small' | 'medium' | 'large' {
  const profile = getModelProfile(modelName, effort);
  if (profile) {
    return profile.tier;
  }

  const lower = modelName.toLowerCase();
  if (LARGE_MODEL_PATTERNS.some((p) => lower.includes(p))) {
    return 'large';
  }

  const match = lower.match(/(\d+)b/);
  if (match) {
    const size = parseInt(match[1], 10);
    return size <= 12 ? 'small' : size <= 35 ? 'medium' : 'large';
  }

  return 'small';
}

const NATIVE_FUNCTION_CALLING_THRESHOLD = 0.9;

/**
 * Checks whether the model possesses reliably measured native function calling capability (T8.9).
 */
export function hasNativeFunctionCalling(modelName: string, effort?: ReasoningEffort): boolean {
  const profile = getModelProfile(modelName, effort);
  return !!profile && profile.scores.toolCalling >= NATIVE_FUNCTION_CALLING_THRESHOLD;
}

export interface ToolSchemaData {
  description: string;
  schema: any;
  requiredTier: 'small' | 'medium' | 'large';
}

/**
 * Lightweight tool arguments validation against parameter JSON schema.
 */
function validateToolArgs(args: any, schema: any, toolName: string): string | null {
  if (!args || typeof args !== 'object') {
    return "Missing or invalid arguments (expected JSON object)";
  }

  if (args._error === 'invalid_json_arguments') {
    return `Invalid or malformed JSON arguments (expected valid JSON object). Re-try calling '${toolName}' with valid JSON syntax`;
  }

  const required: string[] = schema.required || [];
  for (const field of required) {
    if (args[field] === undefined || args[field] === null) {
      return `Missing required parameter '${field}'`;
    }
  }

  const properties = schema.properties || {};
  for (const [field, propSchema] of Object.entries(properties) as [string, any][]) {
    const value = args[field];
    if (value === undefined || value === null) continue;

    const expectedType = propSchema.type;
    if (!expectedType) continue;

    const actualType = typeof value;
    if (expectedType === 'string' && actualType !== 'string') {
      return `'${field}' must be a string, received ${actualType}`;
    }
    if ((expectedType === 'integer' || expectedType === 'number') && actualType !== 'number' && actualType !== 'string') {
      return `'${field}' must be a number, received ${actualType}`;
    }
    if (expectedType === 'integer' && typeof value === 'string' && !/^-?\d+$/.test(value)) {
      return `'${field}' must be an integer, received "${value}"`;
    }
  }

  return null;
}

function fallbackSchema(name: string): ToolSchemaData {
  return {
    description: `Tool ${name}`,
    schema: { type: 'object', properties: {} },
    requiredTier: 'small'
  };
}

const schemaCache = new Map<string, { mtimeMs: number; data: ToolSchemaData }>();

/**
 * Loads tool description, parameter schema, and minimum required tier from tools_schemas/*.json.
 */
export function loadToolSchema(name: string): ToolSchemaData {
  try {
    const customSchemaPath = homePath('custom_tools_schemas', `${name}.json`);
    const coreSchemaPath = homePath('tools_schemas', `${name}.json`);
    const schemaPath = fs.existsSync(customSchemaPath) ? customSchemaPath : coreSchemaPath;

    if (!fs.existsSync(schemaPath)) {
      return fallbackSchema(name);
    }

    const mtimeMs = fs.statSync(schemaPath).mtimeMs;
    const cached = schemaCache.get(name);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.data;
    }

    const raw = fs.readFileSync(schemaPath, 'utf-8');
    const data = JSON.parse(raw);
    const schemaData: ToolSchemaData = {
      description: data.description || '',
      schema: data.parameters || { type: 'object', properties: {} },
      requiredTier: data.requiredTier || 'small'
    };
    schemaCache.set(name, { mtimeMs, data: schemaData });
    return schemaData;
  } catch (error: any) {
    logSink.error(`Error loading JSON schema for '${name}': ${error.message}`);
    return fallbackSchema(name);
  }
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private alwaysAllow: Set<string> = new Set();

  constructor() {}

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
  listForLLM(modelName: string, allowedTools?: string[], effort?: ReasoningEffort): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: any;
    };
  }> {
    const modelTier = getModelTier(modelName, effort);
    const currentTierLevel = TIER_HIERARCHY[modelTier];
    const result: Array<{
      type: 'function';
      function: { name: string; description: string; parameters: any };
    }> = [];

    for (const tool of this.tools.values()) {
      if (allowedTools && !allowedTools.includes(tool.name) && !this.alwaysAllow.has(tool.name)) {
        continue;
      }

      const schemaData = loadToolSchema(tool.name);
      const requiredTierLevel = TIER_HIERARCHY[schemaData.requiredTier || 'small'];
      if (currentTierLevel < requiredTierLevel) {
        continue;
      }

      if (WorkflowScope.isInsideWorkflow() && WORKFLOW_ESCALATION_TOOLS.has(tool.name)) {
        continue;
      }

      result.push({
        type: 'function',
        function: {
          name: tool.name,
          description: schemaData.description,
          parameters: schemaData.schema
        }
      });
    }

    return result;
  }

  async executeTool(
    name: string,
    args: any,
    permissionManager: PermissionManager,
    provider?: any,
    requesterLabel?: string,
    commandCtx?: any,
    onChunk?: (chunk: string, channel?: StreamChannel, authorName?: string) => void,
    onStats?: (stats: any) => void,
    onEvent?: AgentEventHandler,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: `Error: Tool '${name}' is not registered.`
      };
    }

    const effectiveArgs = typeof args === 'string' ? sanitizeToolCallArguments(args).parsed : args;

    const schemaData = loadToolSchema(name);
    if (schemaData.schema?.type === 'object' && schemaData.schema?.properties) {
      const validationError = validateToolArgs(effectiveArgs, schemaData.schema, name);
      if (validationError) {
        return {
          success: false,
          output: `Validation error for tool '${name}': ${validationError}. Please review parameters and retry.`
        };
      }
    }

    const details = formatPermissionDetails(name, effectiveArgs);

    const isApproved = await permissionManager.checkPermission(name, details, tool.riskLevel, requesterLabel);
    if (!isApproved) {
      return {
        success: false,
        output: `Error: Operation '${name}' denied by user. Request cancelled.`
      };
    }

    try {
      const output = await tool.execute(effectiveArgs, {
        registry: this,
        provider,
        permissionManager,
        requesterLabel,
        commandCtx,
        onChunk,
        onStats,
        onEvent,
        signal
      });
      return {
        success: true,
        output
      };
    } catch (error: any) {
      return {
        success: false,
        output: `Error executing tool '${name}': ${error.message}`
      };
    }
  }
}
