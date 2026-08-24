/** Regression coverage for wrapped memory and multiline tool output in the TUI. */
import './isolateMemory';
import * as assert from 'assert';
import chalk from 'chalk';
import { GLOBAL_SCOPE, MemoryFact } from '../src/core/memory';
import { ModalKeyHandler, SystemModals } from '../src/tui/modals';
import { TuiStore } from '../src/tui/store';
import { ChatView } from '../src/tui/views/Chat';
import { ModalView } from '../src/tui/views/Modal';
import { ToolsView } from '../src/tui/views/Tools';

if (chalk.level === 0) chalk.level = 1;

function plain(lines: string[]): string[] {
  return lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));
}

const now = new Date().toISOString();
const fact: MemoryFact = {
  id: 'memory-viewer-regression',
  summary: 'Scrollable memory detail',
  content:
    'BEGIN remembered context with enough words to wrap across several terminal rows. '.repeat(5) +
    '\nA second paragraph must remain readable instead of escaping past the modal border. '.repeat(5) +
    '\nEND unique memory tail.',
  source: 'test',
  timestamp: now,
  scope: GLOBAL_SCOPE,
  kind: 'fatto',
  hits: 1,
  lastUsed: now,
};

const modalStore = new TuiStore();
SystemModals.openMemoryActionModal(modalStore, fact);
modalStore.getState().activeModal?.onSelect?.('view');

let modal = modalStore.getState().activeModal;
assert.strictEqual(modal?.type, 'text_viewer', 'View Full Text must use the scrollable text viewer');
assert.ok((modal?.textViewer?.totalLines || 0) > 10, 'Long memory content must be wrapped into visual rows');

const blankScreen = Array.from({ length: 24 }, () => ' '.repeat(80));
let overlay = plain(ModalView.renderOverlay(modal!, blankScreen, 80, 24));
assert.ok(overlay.some((line) => line.includes('BEGIN remembered context')), 'The beginning of the memory is visible');
assert.ok(overlay.every((line) => line.length <= 80), 'The viewer never paints beyond the terminal width');

ModalKeyHandler.handleKey({ name: 'end' }, modal!, modalStore);
modal = modalStore.getState().activeModal;
overlay = plain(ModalView.renderOverlay(modal!, blankScreen, 80, 24));
assert.ok(overlay.some((line) => line.includes('END unique memory tail')), 'End navigation reveals the memory tail');

ModalKeyHandler.handleKey({ name: 'return' }, modal!, modalStore);
assert.strictEqual(modalStore.getState().activeModal?.type, 'slash_menu', 'Closing the viewer returns to memory actions');

const output = 'Memory results:\n- FIRST recovered fact remains readable\n- LAST recovered fact remains readable';
const chatStore = new TuiStore();
chatStore.addMessage({
  role: 'assistant',
  content: '',
  toolCalls: [{ id: 'recall-1', name: 'recall_memory', args: '{}', output, status: 'completed' }],
});
const chat = plain(ChatView.render(chatStore.getState(), 62, 18));
assert.ok(chat.some((line) => line.includes('FIRST recovered fact')), 'Chat shows the first output row');
assert.ok(chat.some((line) => line.includes('LAST recovered fact')), 'Chat shows later output rows instead of a one-line preview');

const toolsStore = new TuiStore({
  activeTools: [{ id: 'recall-1', name: 'recall_memory', args: '{}', output, status: 'completed', startedAt: 1, completedAt: 2 }],
});
const tools = plain(ToolsView.render(toolsStore.getState(), 62, 18));
assert.ok(tools.some((line) => line.includes('FIRST recovered fact')), 'Tools inspector shows the first output row');
assert.ok(tools.some((line) => line.includes('LAST recovered fact')), 'Tools inspector shows the complete multiline output');

console.log('✔ TUI memory viewer and multiline tool output tests passed');
