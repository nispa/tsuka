import type { OpenAI } from 'openai';
import type { ChatMessage } from '../types';
import type { ChatOptions, ChatToolDefinition } from './types';
import { samplingParamsForRequest } from './sampling';
import { LOGPROBS_TOP_N } from './telemetry';

/**
 * Maps internal ChatMessage structures into typed OpenAI wire message parameters.
 */
export function formatWireMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content ?? '',
        tool_call_id: m.tool_call_id || '',
      };
    }
    if (m.role === 'assistant') {
      const toolCalls = m.tool_calls?.map((tc): OpenAI.Chat.ChatCompletionMessageToolCall => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
      return {
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      };
    }
    if (m.role === 'system') {
      return {
        role: 'system',
        content: m.content ?? '',
        ...(m.name ? { name: m.name } : {}),
      };
    }
    return {
      role: 'user',
      content: m.content ?? '',
      ...(m.name ? { name: m.name } : {}),
    };
  });
}

/**
 * Formats tool definitions into the OpenAI Function Calling wire schema.
 */
export function formatWireTools(tools?: ChatToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool): OpenAI.Chat.ChatCompletionTool => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

export interface BuildChatCompletionParamsOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  stream: boolean;
  logprobsEnabled?: boolean;
  maxTokensCeiling: number;
  options?: ChatOptions;
}

type CompatibleReasoningParam = { reasoning_effort?: ChatOptions['reasoningEffort'] };
export type CompatibleChatCompletionParams =
  | (Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, 'reasoning_effort'> & CompatibleReasoningParam)
  | (Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, 'reasoning_effort'> & CompatibleReasoningParam);

/**
 * Builds the complete request payload for OpenAI-compatible chat completion endpoints.
 */
export function buildChatCompletionParams(
  opts: BuildChatCompletionParamsOptions
): CompatibleChatCompletionParams {
  const wireMessages = formatWireMessages(opts.messages);
  const wireTools = formatWireTools(opts.tools);

  const common = {
    model: opts.model,
    messages: wireMessages,
    tools: wireTools,
    tool_choice: wireTools && wireTools.length > 0 ? 'auto' as const : undefined,
    max_tokens: opts.maxTokensCeiling,
    ...(opts.options?.reasoningEffort ? { reasoning_effort: opts.options.reasoningEffort } : {}),
    ...samplingParamsForRequest(opts.options, opts.model),
  };

  if (opts.stream) {
    return {
      ...common,
      stream: true,
      stream_options: { include_usage: true },
      ...(opts.logprobsEnabled ? { logprobs: true, top_logprobs: LOGPROBS_TOP_N } : {}),
    };
  }
  return { ...common, stream: false };
}
