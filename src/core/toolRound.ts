import { IToolRegistry, ToolSetController } from '../tools/registry';
import { PermissionManager } from '../safety/permissions';
import { ILLMProvider, ChatStats } from './provider';
import { AgentEventHandler } from './agentEvents';
import { StreamChannel } from './thinkParser';
import { ChatMessage, ToolCall, ISubagentRunner } from './types';
import type { WorkflowDispatcher } from './workflowDispatcher';

export interface ToolRoundContext {
  registry: IToolRegistry;
  permissionManager: PermissionManager;
  provider: ILLMProvider;
  requesterLabel?: string;
  workflowDispatcher?: WorkflowDispatcher;
  onChunk?: (chunk: string, channel?: StreamChannel) => void;
  onStats?: (stats: ChatStats, agentLabel?: string) => void;
  onEvent?: AgentEventHandler;
  signal?: AbortSignal;
  toolSet?: ToolSetController;
  subagentRunner?: ISubagentRunner;
  /** Optional callback evaluated after each tool execution. Returning { abort: true } halts execution of subsequent calls in this round. */
  onToolExecuted?: (exec: ToolExecutionRecord) => { abort?: boolean; reason?: string } | void;
}

export interface ToolExecutionRecord {
  toolName: string;
  success: boolean;
  output: string;
  isValidationError?: boolean;
}

export interface ToolRoundResult {
  messages: ChatMessage[];
  executions: ToolExecutionRecord[];
  abortReason?: string;
}

/** Executes one ordered batch of model tool calls and returns tool messages to append. */
export async function executeToolRound(
  toolCalls: ToolCall[],
  parsedArgsList: unknown[],
  context: ToolRoundContext
): Promise<ToolRoundResult> {
  const messages: ChatMessage[] = [];
  const executions: ToolExecutionRecord[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i];
    const toolName = toolCall.function.name;
    const toolArgs = parsedArgsList[i] ?? {};

    if (context.signal?.aborted) {
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: '[Execution cancelled: generation interrupted by user]'
      });
      continue;
    }

    context.onEvent?.({ type: 'tool_start', name: toolName, args: toolArgs, agentLabel: context.requesterLabel });

    const result = await context.registry.executeTool(
      toolName,
      toolArgs,
      context.permissionManager,
      context.provider,
      context.requesterLabel,
      context.workflowDispatcher,
      context.onChunk,
      context.onStats,
      context.onEvent,
      context.signal,
      context.toolSet,
      context.subagentRunner
    );

    executions.push({
      toolName,
      success: result.success,
      output: result.output,
      isValidationError: result.isValidationError,
    });

    messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      name: toolName,
      content: result.output
    });

    context.onEvent?.({
      type: 'tool_end',
      name: toolName,
      args: toolArgs,
      success: result.success,
      output: result.output,
      agentLabel: context.requesterLabel
    });

    if (context.onToolExecuted) {
      const decision = context.onToolExecuted(executions[executions.length - 1]);
      if (decision?.abort) {
        for (let j = i + 1; j < toolCalls.length; j++) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCalls[j].id,
            name: toolCalls[j].function.name,
            content: `[Execution cancelled: ${decision.reason || 'safety limit reached'}]`
          });
        }
        return { messages, executions, abortReason: decision.reason };
      }
    }
  }

  return { messages, executions };
}
