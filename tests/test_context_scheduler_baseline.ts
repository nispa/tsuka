/**
 * Characterization test suite for T22.1 (Context Scheduler and Pluggable Memory baseline).
 *
 * Verifies and locks down baseline behaviors across subsystems that Phase 9 will touch:
 * 1. Calibrated token estimation, tool schema overhead, tool call/response paired pruning, and reasoning effort reduction.
 * 2. Provider promptTokens observation and ContextTracker ring buffer activity recording.
 * 3. Current /context outputs in CLI and TUI.
 * 4. spawn_agent inside and outside blackboard, event/stats forwarding, and failure handling.
 * 5. MemoryBackend registry, default 'json', unknown backend error, CRUD operations, and memoryMaxChars capping.
 *
 * Execution: npx tsx tests/test_context_scheduler_baseline.ts
 */

import './isolateMemory';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Agent } from '../src/core/agent';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { calculateReasoningBudget, estimateMessagesTokens } from '../src/core/contextBudget';
import { ConversationHistory } from '../src/core/conversationHistory';
import { ContextTracker } from '../src/core/contextTracker';
import { Blackboard } from '../src/core/blackboard';
import { MemoryStore, listMemoryBackends, createMemoryBackend, resolveMemoryBackendName } from '../src/core/memory';
import { JsonMemoryBackend } from '../src/core/memory/jsonBackend';
import { handleContext } from '../src/cli/commands/session';
import { SESSION_COMMANDS } from '../src/tui/commands/sessionCommands';
import { spawnAgentTool } from '../src/tools/impl/spawnAgent';
import { logSink } from '../src/core/logSink';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

async function captureLogs<T>(fn: () => Promise<T> | T): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const originalLog = logSink.log;
  const originalWarn = logSink.warn;
  const originalError = logSink.error;

  logSink.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); };
  logSink.warn = (...args: any[]) => { logs.push(args.map(String).join(' ')); };
  logSink.error = (...args: any[]) => { logs.push(args.map(String).join(' ')); };

  try {
    const result = await fn();
    return { result, logs };
  } finally {
    logSink.log = originalLog;
    logSink.warn = originalWarn;
    logSink.error = originalError;
  }
}

async function main(): Promise<void> {
  console.log('=== Context, Handoff and Memory Baseline Tests (T22.1) ===\n');

  // ---------------------------------------------------------------------------
  // SECTION 1: Calibrated Estimation, Pruning, and Reasoning Budget
  // ---------------------------------------------------------------------------
  {
    // 1.1 Pure token estimation
    const chars = 350;
    const charsPerToken = 3.5;
    const est = estimateMessagesTokens([{ content: 'x'.repeat(chars) }], charsPerToken);
    check('CSB1.1', est === 100, `estimateMessagesTokens(${chars} chars, ${charsPerToken}) calculates 100 tokens`);

    // 1.2 Agent message and tool sizing + tool schema overhead + calibration shift
    const provider = new MockLLMProvider([
      {
        content: 'hello',
        stats: { promptTokens: 300, tokenCount: 20, totalTokens: 320 },
      },
    ]);
    const registry = new ToolRegistry();
    registry.register({
      name: 'test_tool',
      riskLevel: 'SAFE',
      execute: async () => 'tool result',
    });
    const permissions = new PermissionManager();
    const agent = new Agent(provider, registry, permissions, 'System instruction with sufficient characters for measurement', ['test_tool']);

    const initialCharsPerToken = agent.getCharsPerTokenRatio();
    const messagesOnlyEst = agent.estimateMessagesTokens(agent.getMessages());
    const totalEstBeforeRun = agent.estimateTotalContextTokens();

    // Before run: tools are not yet sent to LLM so toolsChars is 0, totalEst equals messagesOnlyEst
    check('CSB1.2a', messagesOnlyEst > 0, `Agent estimates initial messages token footprint (> 0, got ${messagesOnlyEst})`);
    check('CSB1.2b', totalEstBeforeRun === messagesOnlyEst, `Before prompt dispatch, total context tokens equals messages-only tokens`);

    // Run agent: triggers tools listing, calculates tool schema footprint, and updates calibration from stats
    await agent.run('test user prompt');

    const totalEstAfterRun = agent.estimateTotalContextTokens();
    const messagesEstAfterRun = agent.estimateMessagesTokens(agent.getMessages());
    const updatedCharsPerToken = agent.getCharsPerTokenRatio();

    check(
      'CSB1.2c',
      totalEstAfterRun > messagesEstAfterRun,
      `Agent accounts for tool schema overhead in total context estimate (messages: ${messagesEstAfterRun}, total: ${totalEstAfterRun})`
    );
    check(
      'CSB1.2d',
      updatedCharsPerToken !== initialCharsPerToken,
      `Calibration ratio updated from provider promptTokens (${initialCharsPerToken} -> ${updatedCharsPerToken})`
    );

    // 1.3 Tool-Call / Tool Response Pruning
    // When history is pruned, history must never start on an orphaned 'tool' response message.
    const history = new ConversationHistory();
    history.replace([
      { role: 'system', content: 'Base system prompt' },
      { role: 'user', content: 'Turn 1 user request' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'test_tool', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'Result 1 from tool execution' },
      { role: 'assistant', content: 'Turn 1 completion summary' },
      { role: 'user', content: 'Turn 2 recent request' },
    ]);

    // Prune with a budget that drops older non-system messages
    history.prune(4, 50, 0, (m) => Math.ceil(String(m.content || '').length / 3.5));
    const prunedMsgs = history.messages;

    // Verify system message is preserved at index 0
    check('CSB1.3a', prunedMsgs[0]?.role === 'system', 'ConversationHistory.prune preserves system message at index 0');

    // Verify history never starts with an orphaned tool response
    check('CSB1.3b', prunedMsgs[1]?.role !== 'tool', 'ConversationHistory.prune ensures non-system history does not start on orphan tool response');

    // 1.4 Reasoning budget reduction when context approaches limit
    const highBudget = calculateReasoningBudget(500, 65536, 'high');
    check('CSB1.4a', highBudget.effectiveEffort === 'high', "Ample budget preserves 'high' reasoning effort");

    const steppedDownBudget = calculateReasoningBudget(60000, 65536, 'high');
    check('CSB1.4b', steppedDownBudget.effectiveEffort !== 'high', "Constrained budget steps down reasoning effort from 'high'");
  }

  // ---------------------------------------------------------------------------
  // SECTION 2: Provider Real promptTokens and ContextTracker
  // ---------------------------------------------------------------------------
  {
    const tracker = ContextTracker.getInstance();
    tracker.clear();

    const provider = new MockLLMProvider([
      {
        content: 'Turn 1 response',
        stats: { promptTokens: 420, tokenCount: 80, totalTokens: 500 },
      },
    ]);
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const agent = new Agent(provider, registry, permissions, 'System prompt', []);

    let observedStats: any;
    await agent.run(
      'User query 1',
      undefined,
      (stats) => {
        observedStats = stats;
        tracker.addEntry({
          timestamp: new Date().toISOString(),
          agentName: 'test_agent',
          tokenCount: stats.tokenCount,
          promptTokens: stats.promptTokens,
          action: 'User query 1',
        });
      }
    );

    check('CSB2.1a', observedStats?.promptTokens === 420, `Provider real promptTokens forwarded to onStats (got ${observedStats?.promptTokens})`);
    const entries = tracker.getAll();
    check('CSB2.1b', entries.length >= 1, `ContextTracker recorded agent activity entry (count: ${entries.length})`);
    const lastEntry = entries[entries.length - 1];
    check('CSB2.1c', lastEntry?.promptTokens === 420, `ContextEntry captured real promptTokens 420 (got ${lastEntry?.promptTokens})`);
    check('CSB2.1d', lastEntry?.tokenCount === 80, `ContextEntry captured completion tokens 80 (got ${lastEntry?.tokenCount})`);

    // Ring buffer bounded capacity
    const originalMax = tracker.getMaxEntries();
    tracker.setMaxEntries(10);
    check('CSB2.2a', tracker.getMaxEntries() === 10, 'ContextTracker capacity successfully clamped to 10');

    for (let i = 0; i < 15; i++) {
      tracker.addEntry({
        timestamp: new Date().toISOString(),
        agentName: `agent_${i}`,
        tokenCount: 10,
        promptTokens: 100,
        action: `action_${i}`,
      });
    }

    const clampedEntries = tracker.getAll();
    check('CSB2.2b', clampedEntries.length === 10, `ContextTracker ring buffer strictly bounded to 10 entries (got ${clampedEntries.length})`);
    check('CSB2.2c', clampedEntries[0].agentName === 'agent_5', `Oldest entries evicted FIFO (first is agent_5)`);
    check('CSB2.2d', clampedEntries[9].agentName === 'agent_14', `Newest entry preserved at tail (last is agent_14)`);

    const recent = tracker.getRecent(3);
    check('CSB2.2e', recent.length === 3 && recent[0].agentName === 'agent_14', 'getRecent returns newest records first');
    check('CSB2.2f', tracker.totalTokens() === 100, `totalTokens calculates aggregate output tokens (expected 100, got ${tracker.totalTokens()})`);

    tracker.setMaxEntries(originalMax);
    tracker.clear();
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: Current Output of /context in CLI and TUI
  // ---------------------------------------------------------------------------
  {
    // 3.1 CLI /context command output structure
    const provider = new MockLLMProvider([{ content: 'ready' }]);
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const agent = new Agent(provider, registry, permissions, 'System role', []);
    await agent.run('init');

    const cliCtx = {
      agent: { current: agent },
      recreateAgent: () => agent,
      permissionManager: permissions,
      provider,
      registry,
      configManager: {
        getMaxHistoryTokens: () => 65536,
        getRuntimeContextTokens: () => null,
      },
    } as any;

    const { logs } = await captureLogs(async () => {
      await handleContext(cliCtx, '');
    });

    const rendered = logs.join('\n');
    check('CSB3.1a', rendered.includes('CONTEXT STATUS'), "CLI /context outputs 'CONTEXT STATUS' header");
    check('CSB3.1b', rendered.includes('Context:'), "CLI /context displays 'Context:' bar");
    check('CSB3.1c', rendered.includes('Messages by role:'), "CLI /context displays 'Messages by role:' breakdown");

    // 3.2 TUI /context command output structure
    const tuiContextCommand = SESSION_COMMANDS.find((cmd) => cmd.name === '/context');
    check('CSB3.2a', !!tuiContextCommand, "TUI session commands register '/context'");

    const addedMessages: any[] = [];
    const mockStore = {
      getState: () => ({
        stats: { usedTokens: 1250, percentage: 25, maxTokens: 5000 },
        messages: [{ role: 'system' }, { role: 'user' }],
      }),
      addMessage: (m: any) => { addedMessages.push(m); },
    };

    tuiContextCommand!.run({ store: mockStore } as any);
    check('CSB3.2b', addedMessages.length === 1, 'TUI /context added exactly one message to store');
    check('CSB3.2c', addedMessages[0]?.content.includes('Context Breakdown:'), "TUI message contains 'Context Breakdown:' header");
    check('CSB3.2d', addedMessages[0]?.content.includes('Used: 1250 tokens (25%)'), "TUI message contains 'Used: 1250 tokens (25%)'");
    check('CSB3.2e', addedMessages[0]?.content.includes('Max Budget: 5000 tokens'), "TUI message contains 'Max Budget: 5000 tokens'");
  }

  // ---------------------------------------------------------------------------
  // SECTION 4: spawn_agent Inside and Outside Blackboard, Event Forwarding & Failure
  // ---------------------------------------------------------------------------
  {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-csb-home-'));
    const tmpMemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-csb-mem-'));
    const prevHome = process.env.TSUKA_HOME;
    const prevMem = process.env.TSUKA_MEMORY_FILE;

    process.env.TSUKA_HOME = tmpHome;
    process.env.TSUKA_MEMORY_FILE = path.join(tmpMemDir, 'memory.json');

    try {
      // 4.1 spawn_agent outside blackboard (attaches events, saves report, writes fact)
      const subEvents: any[] = [];
      const subChunks: { chunk: string; channel?: any; author?: string }[] = [];
      const subStats: { stats: any; label?: string }[] = [];

      const provider = new MockLLMProvider([
        {
          toolCalls: [mockToolCall('test_sub_tool', { param: 'test' })],
        },
        { content: 'Subagent completed work successfully.' },
      ]);
      const registry = new ToolRegistry();
      registry.register({
        name: 'test_sub_tool',
        riskLevel: 'SAFE',
        execute: async () => 'tool execution output',
      });
      const permissions = new PermissionManager();

      const execContext = {
        provider,
        registry,
        permissionManager: permissions,
        onEvent: (ev: any) => subEvents.push(ev),
        onChunk: (chunk: string, channel?: any, author?: string) => subChunks.push({ chunk, channel, author }),
        onStats: (stats: any, label?: string) => subStats.push({ stats, label }),
      };

      const out = await spawnAgentTool.execute(
        { task: 'Analyze benchmark data', roleName: 'developer' },
        execContext
      );

      check('CSB4.1a', out.includes('Execution completed'), "spawn_agent output confirms execution completed");
      check('CSB4.1b', subEvents.some((e) => e.type === 'subagent_start' && e.agentLabel === 'developer'), 'Emitted subagent_start with agentLabel developer');
      check('CSB4.1c', subEvents.some((e) => e.type === 'subagent_end' && e.success === true), 'Emitted subagent_end with success: true');
      check('CSB4.1d', subStats.some((s) => s.label === 'developer'), 'Stats forwarded with developer label');
      check(
        'CSB4.1e',
        subChunks.length > 0 && subChunks.every((c) => c.author === 'developer'),
        `Subagent streamed chunks attributed with developer label (count: ${subChunks.length})`
      );
      check(
        'CSB4.1f',
        subEvents.some((e) => e.type === 'tool_start' && e.agentLabel === 'developer' && e.name === 'test_sub_tool'),
        'Subagent emitted tool_start tagged with developer label'
      );
      check(
        'CSB4.1g',
        subEvents.some((e) => e.type === 'tool_end' && e.agentLabel === 'developer' && e.name === 'test_sub_tool' && e.success === true),
        'Subagent emitted tool_end tagged with developer label and success: true'
      );

      // Check report file was written
      const runsDir = path.join(tmpHome, 'runs');
      const hasReport = fs.existsSync(runsDir) && fs.readdirSync(runsDir).length > 0;
      check('CSB4.1h', hasReport, 'Subagent report artifact generated in runs directory');

      // 4.2 spawn_agent inside blackboard
      const bbProvider = new MockLLMProvider([
        { content: 'Subagent workflow step result' },
      ]);
      const runId = Blackboard.newRunId();
      try {
        await Blackboard.withRun(runId, async () => {
          const bb = Blackboard.current();
          assert(bb);
          await spawnAgentTool.execute(
            { task: 'Workflow task', roleName: 'developer' },
            { provider: bbProvider, registry, permissionManager: permissions }
          );
          const notes = bb.read();
          const artifactNote = notes.find((n) => n.key === 'artefatto-sub-agente');
          check('CSB4.2', !!artifactNote, "Inside blackboard, spawn_agent posts 'artefatto-sub-agente' note");
        });
      } finally {
        Blackboard.endRun(runId);
      }

      // 4.3 spawn_agent error handling
      const errEvents: any[] = [];
      const failProvider = new MockLLMProvider([
        { error: { message: 'Provider network failure' } },
      ]);
      let threw = false;
      try {
        await spawnAgentTool.execute(
          { task: 'Failing task', roleName: 'developer' },
          {
            provider: failProvider,
            registry,
            permissionManager: permissions,
            onEvent: (ev: any) => errEvents.push(ev),
          }
        );
      } catch (err: any) {
        threw = true;
        check('CSB4.3a', err.message.includes('Provider network failure'), 'Subagent rethrows execution error');
      }
      check('CSB4.3b', threw, 'spawn_agent failed synchronously on provider error');
      check(
        'CSB4.3c',
        errEvents.some((e) => e.type === 'subagent_end' && e.success === false),
        'Emitted subagent_end with success: false on failure'
      );
    } finally {
      process.env.TSUKA_HOME = prevHome;
      process.env.TSUKA_MEMORY_FILE = prevMem;
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpMemDir, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION 5: MemoryBackend Registry, CRUD, and memoryMaxChars Capping
  // ---------------------------------------------------------------------------
  {
    // 5.1 Memory Backend Registry
    const backends = listMemoryBackends();
    check('CSB5.1a', backends.includes('json'), "listMemoryBackends() registers default 'json' backend");
    check('CSB5.1b', resolveMemoryBackendName() === 'json', "resolveMemoryBackendName() defaults to 'json'");

    const defaultBackend = createMemoryBackend();
    check('CSB5.1c', defaultBackend.name === 'json', "createMemoryBackend() instantiates 'json' backend");

    let unknownThrew = false;
    try {
      createMemoryBackend('nonexistent_storage');
    } catch (err: any) {
      unknownThrew = true;
      check('CSB5.1d', err.message.includes("Unknown memory backend 'nonexistent_storage'"), 'Unknown backend name throws descriptive error');
    }
    check('CSB5.1e', unknownThrew, 'createMemoryBackend threw on unknown backend name');

    // 5.2 CRUD operations on isolated JsonMemoryBackend
    const tmpMemPath = path.join(os.tmpdir(), `tsuka-csb-backend-${Date.now()}.json`);
    try {
      const backend = new JsonMemoryBackend({ filePath: tmpMemPath, maxFacts: 50 });

      // Add
      const fact1 = backend.addFact('System architecture uses modular decoupled layers.', 'arch_agent', {
        summary: 'Modular decoupled architecture',
        tags: ['arch', 'design'],
      });
      check('CSB5.2a', typeof fact1.id === 'string' && fact1.id.length > 0, 'addFact assigns unique fact id');
      check('CSB5.2b', fact1.hits === 0, 'Newly created fact starts with hits = 0');
      check('CSB5.2c', backend.count() === 1, 'backend.count() reflects single stored fact');

      // Search with BM25 ranking and touch
      const searchResults = backend.search('modular decoupled', 5, { touch: true });
      check('CSB5.2d', searchResults.length === 1, 'search finds matching fact via BM25 query');
      check('CSB5.2e', searchResults[0].hits === 1, 'search increments hits when touch is true');

      // Update
      const updated = backend.updateFact(fact1.id, {
        summary: 'Updated architecture summary',
        tags: ['arch', 'modular', 'core'],
      });
      check('CSB5.2f', updated?.summary === 'Updated architecture summary', 'updateFact updates summary');
      check('CSB5.2g', updated?.tags?.includes('core') === true, 'updateFact updates tags');

      // Forget / Remove
      const removed = backend.forgetFact(fact1.id);
      check('CSB5.2h', removed === true, 'forgetFact successfully removes fact by id');
      check('CSB5.2i', backend.count() === 0, 'backend.count() returns 0 after removal');

      // 5.3 memoryMaxChars Capping in formatForPrompt and formatRelevant
      // Each fact line formatted is: "- [2026-09-22][FACT] (test_agent) Short fact entry X." (~55 chars).
      // With cap = 140 chars, exactly 2 facts fit (55 * 2 = 110 chars < 140, 3rd would be 165 > 140).
      // Total facts = 8, so 6 are omitted with notice.
      for (let i = 0; i < 8; i++) {
        backend.addFact(
          `Short fact entry ${i} about lifecycle.`,
          'test_agent',
          { summary: `Fact entry ${i}` }
        );
      }

      const promptFormatted = backend.formatForPrompt(10, 140);
      const promptLines = promptFormatted.split('\n');
      check('CSB5.3a', promptLines.length === 3, `formatForPrompt renders exactly 2 fact lines plus 1 notice line (got ${promptLines.length} lines)`);
      check('CSB5.3b', promptLines[0].startsWith('- [') && promptLines[1].startsWith('- ['), 'Included lines are formatted fact bullets');
      check('CSB5.3c', promptLines[2].includes('… (6 more memories available: use recall_memory to search)'), 'Omission notice accurately reports 6 omitted memories');
      check('CSB5.3d', promptFormatted.includes('Short fact entry 7') && !promptFormatted.includes('Short fact entry 0'), 'Most recent entries (7) are prioritized while older ones (0) are omitted');

      const relevantFormatted = backend.formatRelevant('lifecycle', 10, 140);
      const relevantLines = relevantFormatted.split('\n');
      check('CSB5.3e', relevantLines.length === 3, `formatRelevant renders exactly 2 relevant fact lines plus notice (got ${relevantLines.length} lines)`);
      check('CSB5.3f', relevantLines[0].startsWith('- [') && relevantLines[1].startsWith('- ['), 'Included relevant lines are formatted fact bullets');
      check('CSB5.3g', relevantLines[2].includes('… (6 more relevant memories available: use recall_memory to search)'), 'Relevant omission notice reports 6 omitted memories');
      check('CSB5.3h', relevantFormatted.includes('Short fact entry') && !relevantFormatted.includes('Short fact entry 0'), 'Older matching entries (0) are omitted due to maxChars cap');
    } finally {
      if (fs.existsSync(tmpMemPath)) fs.unlinkSync(tmpMemPath);
    }
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in test_context_scheduler_baseline:', err);
  process.exit(1);
});
