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

  console.log('✔ TuiBridge & Permission integration test passed');
})().catch((err) => {
  console.error('✘ TUI Test failed:', err);
  process.exit(1);
});

console.log('--- Test Views Rendering ---');
{
  const store = new TuiStore();
  store.addMessage({ role: 'user', content: 'What is 2+2?' });
  store.addMessage({ role: 'assistant', content: 'It is 4.', thinkingContent: 'Calculate 2+2' });
  const state = store.getState();

  const header = HeaderView.render(state, 80);
  assert.ok(header.length >= 3);

  const sidebar = SidebarView.render(state, 24, 20);
  assert.strictEqual(sidebar.length, 20);

  const chat = ChatView.render(state, 56, 20);
  assert.strictEqual(chat.length, 20);

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
