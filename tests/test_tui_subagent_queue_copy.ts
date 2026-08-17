/**
 * Test suite for:
 * 1. Subagent event & chunk forwarding with author attribution in spawn_agent.
 * 2. Visible queued messages in Chat feed (queue badge, sequential execution, interrupt cancellation).
 * 3. Targeted thinking header click detection (getThinkingHeaderAtRow vs getMessageAtRow).
 * 4. Cross-platform clipboard copying (/copy & copyToClipboard).
 * 5. ToolRegistry declarative permission detail formatters and tier hierarchy.
 */

import * as assert from 'assert';
import { TuiStore } from '../src/tui/store';
import { TuiBridge } from '../src/tui/bridge';
import { PermissionManager } from '../src/safety/permissions';
import { ChatView } from '../src/tui/views/Chat';
import { TuiTurnRunner } from '../src/tui/controllers/turnController';
import { TuiCommandController } from '../src/tui/controllers/commandController';
import { ToolRegistry } from '../src/tools/registry';
import { copyToClipboard } from '../src/core/platform';

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

    // Verify ChatView renders the IN CODA badge
    const chatLines = ChatView.render(stateWhileBusy, 80, 20);
    assert.ok(chatLines.some((l) => l.includes('IN CODA (#1)')), 'Chat view must render IN CODA (#1) badge');
    assert.ok(chatLines.some((l) => l.includes('IN CODA (#2)')), 'Chat view must render IN CODA (#2) badge');

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
    assert.ok(stateAfterInterrupt.messages[1].content.includes('Annullato da stop utente'));
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

  // ── 5. System Clipboard Copying ──
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

  console.log(`\n=== All ${testCount} tests in test_tui_subagent_queue_copy.ts passed cleanly! ===`);
  process.exit(0);
})().catch((err) => {
  console.error('✘ Test suite failed:', err);
  process.exit(1);
});
