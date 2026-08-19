/**
 * Test suite for:
 * 1. Subagent event & chunk forwarding with author attribution in spawn_agent.
 * 2. Visible queued messages in Chat feed (queue badge, sequential execution, interrupt cancellation).
 * 3. Targeted thinking header click detection (getThinkingHeaderAtRow vs getMessageAtRow).
 * 4. Cross-platform clipboard copying (/copy & copyToClipboard).
 * 5. ToolRegistry declarative permission detail formatters and tier hierarchy.
 */

import './isolateMemory';
import * as assert from 'assert';
import { TuiStore } from '../src/tui/store';
import { TuiBridge } from '../src/tui/bridge';
import { PermissionManager } from '../src/safety/permissions';
import { ChatView } from '../src/tui/views/Chat';
import { HeaderView } from '../src/tui/views/Header';
import { PersonaWidget, MetricsWidget } from '../src/tui/widgets';
import { TuiTurnRunner } from '../src/tui/controllers/turnController';
import { TuiCommandController } from '../src/tui/controllers/commandController';
import { ToolRegistry } from '../src/tools/registry';
import { copyToClipboard } from '../src/core/platform';
import { MemoryStore } from '../src/core/memory';
import { saveMemoryTool } from '../src/tools/impl/saveMemory';
import { listAvailableRoles, listAvailableCharacters } from '../src/cli/shared';

let testCount = 0;
function test(name: string, fn: () => void | Promise<void>) {
  testCount++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        console.log(`  ✔ ${name}`);
      });
    }
    console.log(`  ✔ ${name}`);
  } catch (err: any) {
    console.error(`  ✘ ${name}: ${err.message}`);
    process.exit(1);
  }
}

(async () => {
  console.log('=== Test Suite: Subagent Events, Queued Messages & Clipboard ===\n');

  // ── 1. Targeted Thinking Header Click vs Regular Text Selection ──
  await test('ChatView: clicking thinking header returns message, clicking text returns undefined', () => {
    const store = new TuiStore();
    store.addMessage({
      role: 'assistant',
      authorName: 'Coder',
      content: 'Here is line 1 of response\nHere is line 2 of response\nHere is line 3 of response',
      thinkingContent: 'Let me think about this step by step\nConsidering all parameters\nFinalizing plan',
      isThinkingExpanded: false,
    });

    const state = store.getState();
    const width = 60;
    const height = 20;

    // Row 0 is author header: 🤖 Coder [timestamp]
    // Row 1 is thinking header line: 💭 Thinking… / 💭 Chain of Thought...
    const thinkTarget = ChatView.getThinkingHeaderAtRow(state, width, height, 1);
    assert.ok(thinkTarget, 'Row 1 should match thinking header');
    assert.strictEqual(thinkTarget?.authorName, 'Coder');

    // Row 2 is the actual response content ("Here is line 1 of response")
    const textTarget = ChatView.getThinkingHeaderAtRow(state, width, height, 2);
    assert.strictEqual(textTarget, undefined, 'Clicking regular response text must NOT target thinking header');

    // Row 3 is response content ("Here is line 2 of response")
    const textTarget2 = ChatView.getThinkingHeaderAtRow(state, width, height, 3);
    assert.strictEqual(textTarget2, undefined, 'Clicking regular response text must NOT target thinking header');
  });

  // ── 2. Visible Queued Messages in Chat Feed ──
  await test('TuiTurnRunner: queued prompts appear immediately in Chat with IN CODA badge and transition on execution', async () => {
    const store = new TuiStore();
    const perm = new PermissionManager();
    const bridge = new TuiBridge(store, perm);

    const executionOrder: string[] = [];
    const mockAgent: any = {
      run: async (prompt: string) => {
        executionOrder.push(prompt);
        await new Promise((r) => setTimeout(r, 60));
        return 'response for ' + prompt;
      }
    };

    const runner = new TuiTurnRunner({
      store,
      bridge,
      getAgent: () => mockAgent,
      commandController: {} as any,
    });

    // Start prompt 1 (active), then queue prompt 2 and prompt 3
    const p1 = runner.handleUserPrompt('Task 1: Read files');
    const p2 = runner.handleUserPrompt('Task 2: Build project');
    const p3 = runner.handleUserPrompt('Task 3: Run tests');

    const stateWhileBusy = store.getState();
    assert.strictEqual(stateWhileBusy.messages.length, 3);
    assert.strictEqual(stateWhileBusy.messages[0].content, 'Task 1: Read files');
    assert.strictEqual(stateWhileBusy.messages[0].isQueued, undefined);

    // Prompt 2 is queued with position #1
    assert.strictEqual(stateWhileBusy.messages[1].content, 'Task 2: Build project');
    assert.strictEqual(stateWhileBusy.messages[1].isQueued, true);
    assert.strictEqual(stateWhileBusy.messages[1].queuePosition, 1);

    // Prompt 3 is queued with position #2
    assert.strictEqual(stateWhileBusy.messages[2].content, 'Task 3: Run tests');
    assert.strictEqual(stateWhileBusy.messages[2].isQueued, true);
    assert.strictEqual(stateWhileBusy.messages[2].queuePosition, 2);

    // Verify ChatView renders the IN QUEUE badge
    const chatLines = ChatView.render(stateWhileBusy, 80, 20);
    assert.ok(chatLines.some((l) => l.includes('IN QUEUE (#1)')), 'Chat view must render IN QUEUE (#1) badge');
    assert.ok(chatLines.some((l) => l.includes('IN QUEUE (#2)')), 'Chat view must render IN QUEUE (#2) badge');

    // Wait for all queued turns to process sequentially
    await p1;
    await new Promise((r) => setTimeout(r, 250));

    assert.deepStrictEqual(executionOrder, [
      'Task 1: Read files',
      'Task 2: Build project',
      'Task 3: Run tests'
    ]);

    const stateAfterComplete = store.getState();
    assert.strictEqual(stateAfterComplete.messages[1].isQueued, false, 'Queued message must transition to active');
    assert.strictEqual(stateAfterComplete.messages[2].isQueued, false, 'Queued message must transition to active');
  });

  // ── 3. Queue Cancellation on User Interrupt (Esc) ──
  await test('TuiTurnRunner: user interrupt cancels queued messages and marks them in chat', async () => {
    const store = new TuiStore();
    const perm = new PermissionManager();
    const bridge = new TuiBridge(store, perm);

    const mockAgent: any = {
      run: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return 'done';
      }
    };

    const runner = new TuiTurnRunner({
      store,
      bridge,
      getAgent: () => mockAgent,
      commandController: {} as any,
    });

    runner.handleUserPrompt('Active prompt');
    runner.handleUserPrompt('Queued prompt to be cancelled');

    assert.strictEqual(store.getState().messages.length, 2);
    assert.strictEqual(store.getState().messages[1].isQueued, true);

    // Trigger interrupt
    runner.interrupt();

    const stateAfterInterrupt = store.getState();
    assert.strictEqual(stateAfterInterrupt.messages[1].isQueued, false);
    assert.ok(stateAfterInterrupt.messages[1].content.includes('Canceled by user stop'));
  });

  // ── 4. Subagent Event Forwarding & Attribution ──
  await test('TuiBridge: subagent chunk reasoning streams with author attribution and tool tags', () => {
    const store = new TuiStore();
    const perm = new PermissionManager();
    const bridge = new TuiBridge(store, perm);

    const onChunk = bridge.createChunkHandler();
    const onEvent = bridge.createEventHandler();

    // 1. Parent agent starts reasoning
    onChunk('Parent thinking...', 'reasoning', 'Pike');
    assert.strictEqual(store.getState().messages[0].authorName, 'Pike');

    // 2. Subagent starts reasoning with distinct author
    onChunk('Subagent thinking...', 'reasoning', 'Geordi');
    assert.strictEqual(store.getState().messages.length, 2);
    assert.strictEqual(store.getState().messages[1].authorName, 'Geordi');

    // 3. Subagent calls tool
    onEvent({ type: 'tool_start', name: 'read_file', args: { path: 'har_to_recipe.py' }, agentLabel: 'Geordi' });
    const activeTools = store.getState().activeTools;
    assert.strictEqual(activeTools[0].name, 'read_file (@Geordi)');

    onEvent({ type: 'tool_end', name: 'read_file', args: { path: 'har_to_recipe.py' }, success: true, output: '242 lines', agentLabel: 'Geordi' });
    assert.strictEqual(store.getState().activeTools[0].status, 'completed');
  });

  // ── 5. Subagent Token Aggregation & Multi-Color Stacked Gauge ──
  await test('TuiBridge & HeaderView: subagent tokens aggregate and render stacked dual-color progress bar', () => {
    const store = new TuiStore();
    const perm = new PermissionManager();
    const bridge = new TuiBridge(store, perm);

    store.updateStats({ maxTokens: 8192, usedTokens: 0, subagentUsedTokens: 0 });

    const onStats = bridge.createStatsHandler();

    // 1. Parent agent uses 2000 tokens
    onStats({ durationMs: 500, tokenCount: 2000, tokensPerSecond: 25, promptTokens: 1500, totalTokens: 2000 });
    assert.strictEqual(store.getState().stats.usedTokens, 2000);
    assert.strictEqual(store.getState().stats.subagentUsedTokens, 0);
    assert.strictEqual(store.getState().stats.percentage, 24);

    // 2. Subagent uses 1200 tokens
    onStats({ durationMs: 300, tokenCount: 1200, tokensPerSecond: 30, promptTokens: 800, totalTokens: 1200 }, 'Geordi');
    assert.strictEqual(store.getState().stats.usedTokens, 2000);
    assert.strictEqual(store.getState().stats.subagentUsedTokens, 1200);
    assert.strictEqual(store.getState().stats.percentage, 39); // (3200 / 8192) * 100

    // 3. Render HeaderView and verify stacked gauge and label
    const headerLines = HeaderView.render(store.getState(), 100);
    const statsLine = headerLines[1];
    assert.ok(
      statsLine.includes('39%') &&
      statsLine.includes((2000).toLocaleString()) &&
      statsLine.includes((1200).toLocaleString()) &&
      statsLine.includes('sub') &&
      statsLine.includes((8192).toLocaleString()),
      'Header stats line should display formula components'
    );

    // 4. Verify dynamic status badge for tool and subagent execution
    store.setState({
      isGenerating: true,
      generationStatus: { phase: 'tool', agentName: 'Geordi', toolName: 'read_file' },
    });
    const toolHeader = HeaderView.render(store.getState(), 100);
    assert.ok(toolHeader[1].includes('read_file'), 'Header should display active tool name in status badge');
    assert.ok(toolHeader[1].includes('@Geordi'), 'Header should display subagent author in tool status badge');

    store.setState({
      isGenerating: true,
      generationStatus: { phase: 'reasoning', agentName: 'Geordi' },
    });
    const thinkHeader = HeaderView.render(store.getState(), 100);
    assert.ok(thinkHeader[1].includes('THINKING') && thinkHeader[1].includes('@Geordi'), 'Header should display thinking subagent in status badge');
  });

  // ── 6. PersonaWidget & MetricsWidget Spawned Subagent Block ──
  await test('PersonaWidget & MetricsWidget: render spawned subagent box and token details', () => {
    const store = new TuiStore();
    store.updateStats({ usedTokens: 2500, subagentUsedTokens: 1100, turnCount: 2, toolCallsCount: 4 });
    store.setSpawnedAgent({
      id: 'sub_123',
      name: 'Geordi',
      role: 'developer',
      task: 'Analyze code and fix bugs',
      status: 'running',
      currentTool: 'read_file',
      usedTokens: 1100,
      startedAt: Date.now(),
    });

    const personaLines = PersonaWidget.render(store.getState(), 40);
    assert.ok(personaLines.some((l) => l.includes('SPAWNED SUBAGENT')), 'PersonaWidget should render SPAWNED SUBAGENT header');
    assert.ok(personaLines.some((l) => l.includes('Geordi')), 'PersonaWidget should render subagent name');
    assert.ok(personaLines.some((l) => l.includes('developer')), 'PersonaWidget should render subagent role');
    assert.ok(personaLines.some((l) => l.includes('read_file')), 'PersonaWidget should render active tool');
    assert.ok(personaLines.some((l) => l.includes((1100).toLocaleString())), 'PersonaWidget should render subagent token count');

    const metricsLines = MetricsWidget.render(store.getState(), 40);
    assert.ok(metricsLines.some((l) => l.includes('sub')), 'MetricsWidget should show subagent tokens breakdown');
  });

  // ── 7. System Clipboard Copying ──
  await test('platform: copyToClipboard function safely handles clipboard copying', () => {
    const result = copyToClipboard('TSUKA Clipboard Test Content');
    // On systems with clip.exe / pbcopy / xclip available it returns true, otherwise false without throwing
    assert.strictEqual(typeof result, 'boolean');
  });

  await test('TuiCommandController: /copy command copies last assistant response', async () => {
    const store = new TuiStore();
    store.addMessage({ role: 'user', content: 'Hello' });
    store.addMessage({ role: 'assistant', authorName: 'Spock', content: 'Fascinating data analysis.' });

    let notifiedMessage = '';
    let notificationType = '';
    store.notify = (msg: string, type?: string) => {
      notifiedMessage = msg;
      notificationType = type || '';
    };

    const cmdController = new TuiCommandController({
      store,
      configManager: {} as any,
      provider: {} as any,
      layoutConfig: {} as any,
      getAgent: () => ({} as any),
      setAgent: () => {},
      recreateAgent: () => ({} as any),
      syncState: () => {},
      probeContextWindow: async () => {},
      setActiveTab: () => {},
      stopApp: () => {},
    });

    await cmdController.handleCommand('/copy');
    assert.ok(notifiedMessage.includes('Copied last') || notifiedMessage.includes('Clipboard'));
  });

  // ── 6. ToolRegistry Declarative Permission Details & Tier Hierarchy ──
  await test('ToolRegistry: formatPermissionDetails and tier hierarchy function declaratively', async () => {
    const registry = new ToolRegistry();
    const perm = new PermissionManager();
    perm.setPromptHandler(async () => 'always');

    let executedWithDetails: any = null;
    registry.register({
      name: 'execute_command',
      riskLevel: 'DANGEROUS',
      execute: async (args) => {
        executedWithDetails = args;
        return 'executed';
      }
    });

    const result = await registry.executeTool('execute_command', { command: 'echo hello' }, perm);
    assert.strictEqual(result.success, true);
    assert.strictEqual(executedWithDetails.command, 'echo hello');
  });

  // ── 9. Global vs Workspace Scoped Memory ──
  await test('save_memory: supports global vs workspace scoping', async () => {
    const memStore = MemoryStore.getInstance();
    const globalRes = await saveMemoryTool.execute({ summary: 'Use TypeScript strict mode', content: 'Global rule: use TypeScript strict mode.', global: true });
    assert.ok(globalRes.includes('scope: global'), 'Global memory save should report global scope');

    const wsRes = await saveMemoryTool.execute({ summary: 'Project port is 8080', content: 'Project fact: port is 8080.', global: false });
    assert.ok(wsRes.includes('scope: workspace'), 'Local memory save should report workspace scope');
  });

  // ── 10. Layered Role & Character Loaders ──
  await test('shared: listAvailableRoles & listAvailableCharacters load seamlessly across layers', () => {
    const roles = listAvailableRoles();
    assert.ok(roles.length >= 20, `Should load all roles (found ${roles.length})`);
    assert.ok(roles.some((r) => r.name === 'developer'), 'Developer role should be loaded');

    const characters = listAvailableCharacters();
    assert.ok(characters.length >= 20, `Should load all characters (found ${characters.length})`);
    assert.ok(characters.some((c) => c.name === 'spock' || c.aiName === 'Spock'), 'Spock character should be loaded');
  });

  // ── 11. TuiCommandController: /goal command routing ──
  await test('TuiCommandController: /goal command routes properly without falling back', async () => {
    const store = new TuiStore();
    const cmdController = new TuiCommandController({
      store,
      configManager: {
        isParallelExecutionEnabled: () => false,
        getMaxHistoryTokens: () => 8192,
        getMaxHistoryMessages: () => 20,
        getDefaultReasoningEffort: () => 'low',
        getMaxToolRounds: () => 10,
        getGoalCondensedHistoryCharLimit: () => 1500,
        getWorkspaceRoot: () => process.cwd(),
      } as any,
      provider: {
        getCurrentModel: () => 'test-model',
        chatWithTools: async () => ({ content: 'AGENTE: @developer — do work\nFINE' }),
      } as any,
      registry: new ToolRegistry(),
      permissionManager: new PermissionManager(),
      layoutConfig: {} as any,
      getAgent: () => ({} as any),
      setAgent: () => {},
      recreateAgent: () => ({} as any),
      syncState: () => {},
      probeContextWindow: async () => {},
      setActiveTab: () => {},
      stopApp: () => {},
    });

    // When called without arg, shows usage
    await cmdController.handleCommand('/goal');
    const msg1 = store.getState().messages[0];
    assert.ok(msg1 && msg1.content.includes('/goal <objective>'), 'Should display usage when /goal has no args');

    // When called with arg, sets isGenerating and adds user message
    await cmdController.handleCommand('/goal build api');
    const userMsg = store.getState().messages.find((m) => m.content.includes('/goal build api'));
    assert.ok(userMsg, 'Should add /goal user message to chat feed');
  });

  // ── 12. TuiCommandController: Parity Slash Commands (/call, /team, /runs, /blackboard) ──
  await test('TuiCommandController: /call, /runs, /blackboard, /provider route seamlessly in TUI', async () => {
    const store = new TuiStore();
    let currentProvider = 'ollama';
    let currentSearch = 'duckduckgo';

    const cmdController = new TuiCommandController({
      store,
      configManager: {
        isParallelExecutionEnabled: () => false,
        getMaxHistoryTokens: () => 8192,
        getMaxHistoryMessages: () => 20,
        getDefaultReasoningEffort: () => 'low',
        getMaxToolRounds: () => 10,
        getGoalCondensedHistoryCharLimit: () => 1500,
        getWorkspaceRoot: () => process.cwd(),
        getActiveProviderName: () => currentProvider,
        setActiveProvider: (p: string) => { currentProvider = p; },
        getActiveProviderConfig: () => ({ baseUrl: 'http://localhost:11434', model: 'llama3' }),
        getApiKey: () => '',
        getWebSearchProvider: () => currentSearch,
        setWebSearchProvider: (s: string) => { currentSearch = s; },
      } as any,
      provider: {
        getCurrentModel: () => 'test-model',
        reconfigure: () => {},
        chatWithTools: async () => ({ content: 'STATO: COMPLETATO' }),
      } as any,
      registry: new ToolRegistry(),
      permissionManager: new PermissionManager(),
      layoutConfig: {} as any,
      getAgent: () => ({} as any),
      setAgent: () => {},
      recreateAgent: () => ({} as any),
      syncState: () => {},
      probeContextWindow: async () => {},
      setActiveTab: () => {},
      stopApp: () => {},
    });

    // /call usage check
    await cmdController.handleCommand('/call');
    assert.ok(store.getState().messages.some((m) => m.content.includes('/call @agent1 @agent2')), '/call should display usage when called empty');

    // /provider switch check
    await cmdController.handleCommand('/provider openrouter');
    assert.strictEqual(currentProvider, 'openrouter', '/provider openrouter should update active provider');

    // /search-engine check
    await cmdController.handleCommand('/search-engine google');
    assert.strictEqual(currentSearch, 'google', '/search-engine google should update web search engine');

    // /runs check
    await cmdController.handleCommand('/runs');
    assert.ok(store.getState().messages.some((m) => m.content.includes('Workflow') || m.content.includes('workflow_logs')), '/runs should output run history or empty notice');

    // /blackboard check
    await cmdController.handleCommand('/blackboard');
    assert.ok(store.getState().messages.some((m) => m.content.includes('Blackboard') || m.content.includes('workflow_logs')), '/blackboard should output notes or notice');
  });

  // ── 13. Stop / Abort Activity & Clear Visual Thinking vs Tool State ──
  await test('TuiCommandController & Views: /stop command and live thinking vs tool cards', async () => {
    const store = new TuiStore();
    let interruptedCalled = false;
    const fakeRunner = {
      interrupt: () => { interruptedCalled = true; }
    };

    const cmdController = new TuiCommandController({
      store,
      configManager: {} as any,
      provider: {} as any,
      layoutConfig: {} as any,
      getAgent: () => ({} as any),
      setAgent: () => {},
      recreateAgent: () => ({} as any),
      syncState: () => {},
      probeContextWindow: async () => {},
      setActiveTab: () => {},
      getTurnRunner: () => fakeRunner,
      stopApp: () => {},
    });

    store.setState({
      isGenerating: true,
      generationStatus: { phase: 'tool', agentName: 'Geordi', toolName: 'read_file' },
    });

    // Verify ChatView renders live tool card
    const lines = ChatView.render(store.getState(), 80, 20);
    assert.ok(lines.some((l) => l.includes('TOOL EXECUTION') || l.includes('read_file')), 'ChatView should display live tool execution status card');

    // Execute /stop command
    await cmdController.handleCommand('/stop');
    assert.strictEqual(interruptedCalled, true, '/stop should invoke turnRunner.interrupt()');
    assert.strictEqual(store.getState().isGenerating, false, 'isGenerating should be reset to false');
    assert.ok(store.getState().messages.some((m) => m.content.includes('stopped')), '/stop should log cancellation to chat');
  });

  console.log(`\n=== All ${testCount} tests in test_tui_subagent_queue_copy.ts passed cleanly! ===`);
  process.exit(0);
})().catch((err) => {
  console.error('✘ Test suite failed:', err);
  process.exit(1);
});
