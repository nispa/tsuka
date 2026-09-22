/**
 * Unit and contract tests for the normalized provider boundary (T21.5).
 *
 * Validates wire format conversion, payload building, streaming SSE accumulation,
 * and provider error classification.
 */

import {
  formatWireMessages,
  formatWireTools,
  buildChatCompletionParams,
  StreamAccumulator,
  isMalformedToolCallJsonError,
  isReasoningEffortRejectionError,
  createProviderError,
  LLMProvider,
} from '../src/core/provider';
import type { ChatMessage } from '../src/core/types';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`PASS ${id} - ${detail}`);
  } else {
    failed++;
    console.log(`FAIL ${id} - ${detail}`);
  }
}

async function runTests(): Promise<void> {
  console.log('--- Provider Boundary Contract Tests (T21.5) ---');

  // Group 1: Wire Messages Format
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are an agent' },
    { role: 'user', content: 'List files', name: 'alice' },
    {
      role: 'assistant',
      content: 'Calling tool',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'list_dir', arguments: '{"path":"."}' }
        }
      ]
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'file1.txt\nfile2.txt' }
  ];

  const wireMessages = formatWireMessages(messages);
  check('WIRE.1', wireMessages.length === 4, 'converts all message items');
  check('WIRE.2', wireMessages[0].role === 'system' && wireMessages[0].content === 'You are an agent', 'formats system message');
  check('WIRE.3', wireMessages[1].role === 'user' && 'name' in wireMessages[1] && wireMessages[1].name === 'alice', 'formats user message with name');
  check(
    'WIRE.4',
    wireMessages[2].role === 'assistant' &&
      wireMessages[2].tool_calls?.[0].id === 'call_1' &&
      wireMessages[2].tool_calls?.[0].function.name === 'list_dir',
    'formats assistant message with tool calls'
  );
  check(
    'WIRE.5',
    wireMessages[3].role === 'tool' &&
      wireMessages[3].tool_call_id === 'call_1' &&
      wireMessages[3].content === 'file1.txt\nfile2.txt',
    'formats tool response message with tool_call_id'
  );
  const strictGatewayMessages = formatWireMessages([
    { role: 'system', content: 'System' },
    { role: 'user', content: 'Question' },
    { role: 'assistant', content: null },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'assistant', content: null, tool_calls: messages[2].tool_calls },
  ]);
  check('WIRE.6', strictGatewayMessages.length === 3, 'omits empty assistant turns rejected by strict gateways');
  check('WIRE.7', strictGatewayMessages[2].role === 'assistant' && !!strictGatewayMessages[2].tool_calls?.length, 'preserves tool-call-only assistant turns');

  // Group 2: Wire Tools Format
  const sampleTools = [
    {
      type: 'function' as const,
      function: {
        name: 'read_file',
        description: 'Reads file content',
        parameters: { type: 'object', properties: { path: { type: 'string' } } }
      }
    }
  ];

  const wireTools = formatWireTools(sampleTools);
  check('TOOLS.1', Array.isArray(wireTools) && wireTools.length === 1, 'converts tool descriptors');
  check('TOOLS.2', wireTools?.[0].function.name === 'read_file', 'preserves function name');
  check('TOOLS.3', formatWireTools(undefined) === undefined, 'handles undefined tools cleanly');

  // Group 3: Payload Builder
  const payload = buildChatCompletionParams({
    model: 'test-model',
    messages,
    tools: sampleTools,
    stream: true,
    logprobsEnabled: false,
    maxTokensCeiling: 4096,
    options: {
      temperature: 0.7,
      reasoningEffort: 'medium'
    }
  });

  check('PAYLOAD.1', payload.model === 'test-model', 'sets model in payload');
  check('PAYLOAD.2', payload.stream === true, 'sets stream flag in payload');
  check('PAYLOAD.3', payload.max_tokens === 4096, 'sets max_tokens in payload');
  check('PAYLOAD.4', 'reasoning_effort' in payload && payload.reasoning_effort === 'medium', 'sets reasoning_effort in payload');
  check('PAYLOAD.5', payload.temperature === 0.7, 'sets sampling temperature in payload');

  // Group 4: Stream Accumulator
  const chunksEmitted: Array<{ text: string; channel?: string }> = [];
  const accumulator = new StreamAccumulator({
    onChunk: (text, channel) => chunksEmitted.push({ text, channel }),
    startTime: Date.now() - 100,
    attemptStartTime: Date.now() - 100,
  });

  accumulator.processChunk({
    choices: [{ delta: { content: '<think>Let me think</think>Hello world' } }]
  });

  accumulator.processChunk({
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id: 'call_abc', function: { name: 'calc', arguments: '{"x":' } }
          ]
        }
      }
    ]
  });

  accumulator.processChunk({
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: '42}' } }
          ]
        }
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 }
  });

  const response = accumulator.finalize();
  check('STREAM.1', response.content === 'Hello world', 'separates think tags from final content');
  check('STREAM.2', response.reasoningText?.includes('Let me think') === true, 'accumulates reasoning text');
  check('STREAM.3', response.toolCalls?.length === 1 && response.toolCalls[0].function.arguments === '{"x":42}', 'assembles fragmented tool call chunks');
  check('STREAM.4', response.stats?.totalTokens === 25, 'extracts token usage stats');

  // Group 5: Error Classification
  check('ERR.1', isMalformedToolCallJsonError('Failed to parse tool call arguments as json') === true, 'detects malformed JSON error');
  check('ERR.2', isMalformedToolCallJsonError('Connection reset by peer') === false, 'rejects unrelated error');
  check('ERR.3', isReasoningEffortRejectionError('Unrecognized parameter: reasoning_effort') === true, 'detects reasoning effort rejection');

  const richErr = createProviderError('Timeout expired', 'My partial reasoning');
  check('ERR.4', richErr.message === 'Timeout expired' && richErr.partialReasoning === 'My partial reasoning', 'enriches error with partial reasoning');

  const provider = new LLMProvider('http://localhost:1/v1', 'test-key', 'test-model');
  const failingStream = {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { reasoning: 'Reasoning before failure' } }] };
      throw new Error('stream disconnected');
    }
  };
  (provider as unknown as {
    client: { chat: { completions: { create: () => Promise<typeof failingStream> } } };
  }).client = {
    chat: { completions: { create: async () => failingStream } }
  };

  let interruptedReasoning = '';
  try {
    await provider.chatWithTools([{ role: 'user', content: 'test' }], undefined, () => {});
  } catch (error) {
    interruptedReasoning = (error as Error & { partialReasoning?: string }).partialReasoning ?? '';
  }
  check(
    'ERR.5',
    interruptedReasoning.includes('Reasoning before failure'),
    'preserves reasoning emitted before a streaming failure'
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
