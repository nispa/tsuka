/**
 * Test for the /call multi-agent conference preparation and logic.
 * Run: npx tsx tests/test_call.ts
 */
import { resolveCharacter, loadRole, loadTrait, loadSystemPrompt } from '../src/cli/shared';
import { handleCall, parseCallInvocation } from '../src/cli/commands/call';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

async function run() {
  console.log('=== Test Multi-Agent Conference (/call) ===\n');

  // Resolve characters by craft
  const researcher = resolveCharacter('researcher');
  const dev = resolveCharacter('developer');
  const auditor = resolveCharacter('security_auditor');

  check('CALL.1', !!researcher && !!dev && !!auditor, 'base roles resolved correctly from the catalog');

  const byAiName = dev ? resolveCharacter(dev.aiName.toUpperCase()) : null;
  check('CALL.1b', !!dev && byAiName?.name === dev.name, 'an aiName resolves case-insensitively to the same call participant');

  const parsed = parseCallInvocation('@geordi @doctor "Find a robust solution"');
  check('CALL.1c', parsed.selectedNames.join(',') === 'geordi,doctor' && parsed.topic === 'Find a robust solution', 'quoted call syntax preserves complete character identifiers');

  if (researcher && dev && auditor) {
    const topic = 'System architecture analysis';
    const participants = [researcher, dev, auditor];

    for (const p of participants) {
      const role = loadRole(p.role);
      const trait = loadTrait(p.trait);
      const sysPrompt = loadSystemPrompt(role, trait, 'test-model', undefined, p, topic);

      check(`CALL.2.${p.aiName}`, sysPrompt.includes(p.aiName) && sysPrompt.includes(role.systemPrompt), `system prompt correct for ${p.aiName}`);
    }
  }

  const workflowChunks: Array<{ text: string; author?: string }> = [];
  const workflowStats: string[] = [];
  const savedMessages: Array<{ role: string; content: string }> = [];
  let providerRequest = 0;
  let toolExecutions = 0;
  const fakeProvider = {
    getCurrentModel: () => 'test-model',
    getBaseUrl: () => 'http://localhost:11434/v1',
    chatWithTools: async (_messages: unknown[], _tools: unknown[], onChunk: (text: string) => void) => {
      providerRequest++;
      const stats = { durationMs: 1, tokenCount: 1, tokensPerSecond: 1, promptTokens: 1, totalTokens: 2 };
      if (providerRequest % 2 === 1) {
        return {
          content: '',
          toolCalls: [{ id: `tool_${providerRequest}`, type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"README.md"}' } }],
          stats,
        };
      }
      const content = `conference answer ${providerRequest / 2}`;
      // Exercise the common streaming path; the returned content remains the transcript source.
      onChunk(content);
      return { content, stats };
    },
  };
  await handleCall({
    listAvailableCharacters: () => [resolveCharacter('geordi')!, resolveCharacter('spock')!],
    loadRole,
    loadTrait,
    provider: fakeProvider,
    registry: {
      listForLLM: (_model: string, allowedTools?: string[]) => allowedTools?.includes('read_file')
        ? [{ type: 'function' as const, function: { name: 'read_file', description: 'Reads a file.', parameters: {} } }]
        : [],
      executeTool: async () => {
        toolExecutions++;
        return { success: true, output: 'README contents' };
      },
    },
    permissionManager: {},
    configManager: { getDefaultReasoningEffort: () => undefined },
    agent: { current: { getMessages: () => savedMessages } },
    workflowEvents: {
      onChunk: (text, _channel, author) => workflowChunks.push({ text, author }),
      onStats: (_stats, author) => workflowStats.push(author || ''),
      onEvent: () => {},
      reset: () => {},
    },
  } as any, '@geordi @spock "Discuss the harness"');

  check(
    'CALL.3',
    workflowChunks.length === 6 && workflowChunks[0].author === 'Geordi' && workflowChunks[1].author === 'Spock' && workflowStats.length === 12,
    'final conference responses are forwarded to the TUI workflow sink with their participant names'
  );
  check(
    'CALL.4',
    toolExecutions === 6 && savedMessages.at(-1)?.content.includes('conference answer 6') === true,
    'each participant analyzes a tool result before its final response enters the transcript'
  );

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
