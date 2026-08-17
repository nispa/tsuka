import assert from 'assert';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { TuiBridge } from '../src/tui/bridge';
import { PermissionManager } from '../src/safety/permissions';
import { HeaderView } from '../src/tui/views/Header';
import { SidebarView } from '../src/tui/views/Sidebar';
import { ChatView } from '../src/tui/views/Chat';
import { InputView } from '../src/tui/views/Input';
import { ToolsView } from '../src/tui/views/Tools';
import { FilesView } from '../src/tui/views/Files';
import { ModalView } from '../src/tui/views/Modal';

console.log('--- Test TuiStore Lifecycle & State ---');
{
  const store = new TuiStore();
  const state0 = store.getState();
  assert.strictEqual(state0.activeCharacterName, 'tsuka');
  assert.strictEqual(state0.focus, 'input');

  // Test focus cycling: input -> chat -> sidebar -> files -> tools -> input
  store.cycleFocus();
  assert.strictEqual(store.getState().focus, 'chat');
  store.cycleFocus();
  assert.strictEqual(store.getState().focus, 'sidebar');
  store.cycleFocus();
  assert.strictEqual(store.getState().focus, 'files');
  store.cycleFocus();
  assert.strictEqual(store.getState().focus, 'tools');
  store.cycleFocus();
  assert.strictEqual(store.getState().focus, 'input');

  // Test input manipulation
  store.setInputText('hello');
  store.insertInputChar('!');
  assert.strictEqual(store.getState().inputText, 'hello!');
  store.deleteInputCharBefore();
  assert.strictEqual(store.getState().inputText, 'hello');

  const committed = store.commitInput();
  assert.strictEqual(committed, 'hello');
  assert.strictEqual(store.getState().inputText, '');
  assert.deepStrictEqual(store.getState().inputHistory, ['hello']);

  // Test messages & streaming
  const msgId = store.addMessage({
    role: 'assistant',
    content: 'Initial',
    authorName: 'Tsuka',
  });
  assert.strictEqual(store.getState().messages.length, 1);

  store.appendStreamingChunk(msgId, ' + chunk');
  assert.strictEqual(store.getState().messages[0].content, 'Initial + chunk');

  store.appendStreamingChunk(msgId, 'thought 1', true);
  assert.strictEqual(store.getState().messages[0].thinkingContent, 'thought 1');

  // Test tools
  const toolId = store.startTool('read_file', '{"path": "test.txt"}');
  assert.strictEqual(store.getState().activeTools.length, 1);
  assert.strictEqual(store.getState().activeTools[0].status, 'running');

  store.finishTool(toolId, 'file content here', true);
  assert.strictEqual(store.getState().activeTools[0].status, 'completed');
  assert.strictEqual(store.getState().activeTools[0].output, 'file content here');
  console.log('✔ TuiStore test passed');
}

console.log('--- Test TuiScreen ANSI & Box Drawing ---');
{
  const text = 'Hello \x1b[32mWorld\x1b[0m';
  assert.strictEqual(TuiScreen.stripAnsi(text), 'Hello World');
  assert.strictEqual(TuiScreen.stringWidth(text), 11);

  const padded = TuiScreen.truncateOrPad('Test', 10);
  assert.strictEqual(TuiScreen.stringWidth(padded), 10);

  const box = TuiScreen.drawBox('Title', ['Line 1', 'Line 2'], 30, 6, true);
  assert.strictEqual(box.length, 6);
  assert.ok(box[0].includes('Title'));
  console.log('✔ TuiScreen box drawing test passed');
}

console.log('--- Test TuiBridge & Permission Integration ---');
(async () => {
  const store = new TuiStore();
  const perm = new PermissionManager();
  const bridge = new TuiBridge(store, perm);

  // Test permission modal intercept
  const permPromise = perm.checkPermission('edit_file', 'modify index.ts', 'RESTRICTED', 'Coder');
  await Promise.resolve(); // Allow promise queue to execute promptForDecision
  const activeModal = store.getState().activeModal;
  assert.ok(activeModal !== null);
  assert.strictEqual(activeModal?.type, 'permission');
  assert.strictEqual(activeModal?.permissionReq?.toolName, 'edit_file');

  // Simulate user approval
  activeModal?.permissionReq?.resolve('yes');
  const granted = await permPromise;
  assert.strictEqual(granted, true);
  assert.strictEqual(store.getState().activeModal, null);

  // Test chunk & event handlers
  const onChunk = bridge.createChunkHandler();
  onChunk('Streaming data...', 'content');
  assert.strictEqual(store.getState().messages.length, 1);
  assert.strictEqual(store.getState().messages[0].content, 'Streaming data...');

  const onEvent = bridge.createEventHandler();
  onEvent({ type: 'tool_start', name: 'grep_search', args: { query: 'foo' } });
  assert.strictEqual(store.getState().activeTools[0].name, 'grep_search');
  assert.strictEqual(store.getState().activeTools[0].status, 'running');

  onEvent({ type: 'tool_end', name: 'grep_search', success: true, output: 'match 1' });
  assert.strictEqual(store.getState().activeTools[0].status, 'completed');
  assert.strictEqual(store.getState().activeTools[0].output, 'match 1');

  // Test round_continue creates separate message for next round reasoning
  onEvent({ type: 'round_continue', round: 1, maxRounds: 15 });
  onChunk('Thinking for round 2...', 'reasoning');
  assert.strictEqual(store.getState().messages.length, 2);
  assert.strictEqual(store.getState().messages[1].thinkingContent, 'Thinking for round 2...');

  onChunk('Answer for round 2', 'content');
  assert.strictEqual(store.getState().messages[1].content, 'Answer for round 2');

  // Test multi-phase reasoning within same round splits cleanly
  onChunk('Thinking phase 2...', 'reasoning');
  assert.strictEqual(store.getState().messages.length, 3);
  assert.strictEqual(store.getState().messages[2].thinkingContent, 'Thinking phase 2...');

  // Test subagent reasoning with distinct authorName
  onChunk('Subagent thinking...', 'reasoning', 'Coder');
  assert.strictEqual(store.getState().messages.length, 4);
  assert.strictEqual(store.getState().messages[3].authorName, 'Coder');
  assert.strictEqual(store.getState().messages[3].thinkingContent, 'Subagent thinking...');

  // Test subagent tool execution attribution
  onEvent({ type: 'tool_start', name: 'read_file', args: { path: 'file.ts' }, agentLabel: 'Coder' });
  assert.strictEqual(store.getState().activeTools[0].name, 'read_file (@Coder)');

  console.log('✔ TuiBridge & Permission integration test passed');
})().catch((err) => {
  console.error('✘ TUI Test failed:', err);
  process.exit(1);
});

console.log('--- Test Views Rendering & Thinking Toggle ---');
{
  const store = new TuiStore();
  store.addMessage({ role: 'user', content: 'What is 2+2?' });
  store.addMessage({
    role: 'assistant',
    content: 'It is 4.',
    thinkingContent: 'Calculate 2+2 in mind',
    toolCalls: [
      { id: '1', name: 'read_file', args: '{"path": "index.ts"}', status: 'completed', output: 'content here' }
    ]
  });
  
  // Test collapsed thinking (default)
  let state = store.getState();
  let chat = ChatView.render(state, 60, 20);
  assert.strictEqual(chat.length, 20);
  assert.ok(chat.some((line) => line.includes('Thought') && line.includes('Ctrl+T')));
  assert.ok(chat.some((line) => line.includes('read_file') && line.includes('index.ts')));

  // Test expanded thinking globally
  const isExpanded = store.toggleThinkingExpansion();
  assert.strictEqual(isExpanded, true);
  state = store.getState();
  chat = ChatView.render(state, 60, 20);
  assert.strictEqual(chat.length, 20);
  assert.ok(chat.some((line) => line.includes('Chain of Thought') && line.includes('Ctrl+T')));

  // Test per-message thinking toggle
  const assistantMsgId = state.messages[1].id;
  const msgAtRow = ChatView.getMessageAtRow(state, 60, 20, 5);
  assert.ok(msgAtRow !== undefined);
  
  store.toggleThinkingExpansion(); // Reset global to false
  const perMsgExpanded = store.toggleMessageThinking(assistantMsgId);
  assert.strictEqual(perMsgExpanded, true);
  assert.strictEqual(store.getState().messages[1].isThinkingExpanded, true);

  const header = HeaderView.render(state, 80);
  assert.ok(header.length >= 3);

  const sidebar = SidebarView.render(state, 24, 20);
  assert.strictEqual(sidebar.length, 20);

  const input = InputView.render(state, 80, 3);
  assert.strictEqual(input.length, 3);

  const tools = ToolsView.render(state, 56, 20);
  assert.strictEqual(tools.length, 20);

  const files = FilesView.render(state, 24, 10);
  assert.strictEqual(files.length, 10);

  console.log('✔ View rendering test passed');
}

console.log('--- Test LayoutConfigManager & Widgets ---');
{
  const { LayoutConfigManager, LAYOUT_PRESETS, TUI_THEMES, DEFAULT_LAYOUT_CONFIG } = require('../src/tui/layoutConfig');
  const { PersonaWidget, MetricsWidget, ToolActivityWidget, QuickKeysWidget } = require('../src/tui/widgets');

  const config = LayoutConfigManager.load();
  assert.ok(config !== null);
  assert.ok(typeof config.sidebarWidthPercent === 'number');
  assert.ok(Array.isArray(config.visibleWidgets));

  assert.ok(LAYOUT_PRESETS.default !== undefined);
  assert.ok(LAYOUT_PRESETS.wide !== undefined);
  assert.ok(LAYOUT_PRESETS.right !== undefined);
  assert.ok(LAYOUT_PRESETS.zen !== undefined);

  assert.ok(TUI_THEMES.cyan !== undefined);
  assert.ok(TUI_THEMES.neon !== undefined);
  assert.ok(TUI_THEMES.amber !== undefined);
  assert.ok(TUI_THEMES.matrix !== undefined);

  const store = new TuiStore();
  const state = store.getState();

  const personaLines = PersonaWidget.render(state, 24);
  assert.ok(personaLines.length > 0);

  const metricsLines = MetricsWidget.render(state, 24);
  assert.ok(metricsLines.length > 0);

  const toolLines = ToolActivityWidget.render(state, 24);
  assert.ok(toolLines.length > 0);

  const quickKeysLines = QuickKeysWidget.render(state, 24);
  assert.ok(quickKeysLines.length > 0);

  const sidebarFiltered = SidebarView.render(state, 24, 15, ['persona', 'metrics']);
  assert.strictEqual(sidebarFiltered.length, 15);

  console.log('✔ LayoutConfigManager & Widgets test passed');
}

console.log('--- Test TuiTurnRunner Sequential Prompt Queue ---');
(async () => {
  const { TuiTurnRunner } = require('../src/tui/controllers/turnController');
  const store = new TuiStore();
  const perm = new PermissionManager();
  const bridge = new TuiBridge(store, perm);

  let runCount = 0;
  const executedPrompts: string[] = [];

  const mockAgent: any = {
    run: async (prompt: string) => {
      runCount++;
      executedPrompts.push(prompt);
      await new Promise((r) => setTimeout(r, 100)); // Simulate async execution delay
      return 'done';
    }
  };

  const mockCommandController: any = {
    handleCommand: async () => {}
  };

  const runner = new TuiTurnRunner({
    store,
    bridge,
    getAgent: () => mockAgent,
    commandController: mockCommandController
  });

  // Launch prompt 1 and immediately queue prompt 2 & 3
  const p1 = runner.handleUserPrompt('First prompt');
  const p2 = runner.handleUserPrompt('Second prompt (queued)');
  const p3 = runner.handleUserPrompt('Third prompt (queued)');

  // Verify queued messages appear immediately with [IN CODA] status in chat feed
  const pendingState = store.getState();
  assert.strictEqual(pendingState.messages.length, 3);
  assert.strictEqual(pendingState.messages[1].isQueued, true);
  assert.strictEqual(pendingState.messages[1].queuePosition, 1);
  assert.strictEqual(pendingState.messages[2].isQueued, true);
  assert.strictEqual(pendingState.messages[2].queuePosition, 2);

  const pendingChat = ChatView.render(pendingState, 60, 20);
  assert.ok(pendingChat.some((l) => l.includes('IN QUEUE')));

  await p1;
  // Wait for queue to drain
  await new Promise((r) => setTimeout(r, 350));

  assert.strictEqual(runCount, 3);
  assert.deepStrictEqual(executedPrompts, ['First prompt', 'Second prompt (queued)', 'Third prompt (queued)']);
  assert.strictEqual(store.getState().isGenerating, false);

  console.log('✔ TuiTurnRunner prompt queue test passed');
})().catch((err) => {
  console.error('✘ TurnRunner test failed:', err);
  process.exit(1);
});
