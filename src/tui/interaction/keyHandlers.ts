import { KeyPressEvent } from '../screen';
import { TuiStore } from '../store';
import { TuiFileItem } from '../types';
import { enterDirectory, parentDirectory, entryPath, PARENT_ENTRY } from '../fileExplorer';
import { FileViewerModal } from '../modals';
import { FilesView } from '../views/Files';
import { copyToClipboard } from '../../core/platform';

/**
 * Focus-specific keyboard handlers extracted from TuiApp: pure routing between raw
 * key events and store actions. The app-level dispatcher owns global keys (tabs,
 * modal keys, interrupt); everything below only sees keys addressed to the focused
 * pane.
 */

export interface KeyHandlerDeps {
  store: TuiStore;
  /** Submits a committed prompt line to the turn runner. */
  submitPrompt(prompt: string): void;
}

export function handleInputKey(deps: KeyHandlerDeps, key: KeyPressEvent): void {
  const { store } = deps;
  if (key.name === 'linefeed' || (key.name === 'return' && (key.shift || key.meta || key.ctrl))) {
    store.insertInputChar('\n');
    return;
  }
  if (key.name === 'return') {
    const prompt = store.commitInput();
    if (prompt) deps.submitPrompt(prompt);
    return;
  }
  if (key.name === 'backspace') { store.deleteInputCharBefore(); return; }
  if (key.name === 'delete') { store.deleteInputCharAfter(); return; }
  if (key.name === 'left') { store.moveInputCursor(-1); return; }
  if (key.name === 'right') { store.moveInputCursor(1); return; }
  if (key.name === 'up') { store.navigateHistory('up'); return; }
  if (key.name === 'down') { store.navigateHistory('down'); return; }
  if (key.char && !key.ctrl && !key.meta) store.insertInputChar(key.char);
}

export function handleChatKey(deps: KeyHandlerDeps, key: KeyPressEvent): void {
  const { store } = deps;
  if (key.name === 'up') store.scroll('chat', 2);
  else if (key.name === 'down') store.scroll('chat', -2);
  else if (key.name === 'pageup') store.scroll('chat', 10);
  else if (key.name === 'pagedown') store.scroll('chat', -10);
  else if (key.name === 'c' || key.name === 'y') {
    const state = store.getState();
    const lastAssistantMsg = [...state.messages].reverse().find((m) => m.role === 'assistant' && m.content);
    if (lastAssistantMsg) {
      const ok = copyToClipboard(lastAssistantMsg.content);
      if (ok) store.notify('Copied last response to clipboard!', 'success');
      else store.notify('Clipboard copy failed', 'error');
    } else {
      store.notify('No message content to copy', 'warn');
    }
  } else if (key.name === 't' || key.name === 'return' || key.name === 'space') {
    const state = store.getState();
    const lastWithThinking = [...state.messages].reverse().find((m) => m.thinkingContent);
    if (lastWithThinking) {
      const isExpanded = store.toggleMessageThinking(lastWithThinking.id);
      store.notify(`Reasoning (${lastWithThinking.authorName || 'Tsuka'}): ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
    } else {
      const isExpanded = store.toggleThinkingExpansion();
      store.notify(`Reasoning traces: ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
    }
  }
}

export function handleSidebarKey(deps: KeyHandlerDeps, key: KeyPressEvent): void {
  if (key.name === 'up') deps.store.scroll('sidebar', -1);
  else if (key.name === 'down') deps.store.scroll('sidebar', 1);
}

export function handleToolsKey(deps: KeyHandlerDeps, key: KeyPressEvent): void {
  const { store } = deps;
  if (key.name === 'up') store.scroll('tools', -2);
  else if (key.name === 'down') store.scroll('tools', 2);
  else if (key.name === 'pageup') store.scroll('tools', -10);
  else if (key.name === 'pagedown') store.scroll('tools', 10);
  else if (key.name === 'escape') {
    const current = store.getState().toolsFilter;
    if (current) {
      store.setState({ toolsFilter: '' });
    } else {
      store.setFocus('input');
    }
  } else if (key.name === 'backspace') {
    const current = store.getState().toolsFilter || '';
    store.setState({ toolsFilter: current.slice(0, -1), toolsScrollOffset: 0 });
  } else if (key.char && !key.ctrl && !key.meta) {
    const current = store.getState().toolsFilter || '';
    store.setState({ toolsFilter: current + key.char, toolsScrollOffset: 0 });
  }
}

export interface FilesKeyHandlerDeps extends KeyHandlerDeps {
  /** Browses into another directory; false means already at the target. */
  browseTo(cwd: string): boolean;
}

/** Files currently listed in the explorer panel. */
function visibleFiles(store: TuiStore): TuiFileItem[] {
  return FilesView.visibleFiles(store.getState());
}

export function handleFilesKey(deps: FilesKeyHandlerDeps, key: KeyPressEvent): void {
  const { store } = deps;
  const state = store.getState();
  const files = visibleFiles(store);

  // Left works even on an empty folder: it is the way back out of it.
  if (key.name === 'left') {
    if (!deps.browseTo(parentDirectory(state.filesCwd || ''))) {
      store.notify('Already at the workspace root', 'info');
    }
    return;
  }
  if (files.length === 0) return;

  const selected = files[state.selectedFileIndex];

  if (key.name === 'up') {
    const next = Math.max(0, state.selectedFileIndex - 1);
    const scroll = next < state.filesScrollOffset ? next : state.filesScrollOffset;
    store.setState({ selectedFileIndex: next, filesScrollOffset: scroll });
  } else if (key.name === 'down') {
    const next = Math.min(files.length - 1, state.selectedFileIndex + 1);
    const innerHeight = 6;
    const scroll = next >= state.filesScrollOffset + innerHeight ? next - innerHeight + 1 : state.filesScrollOffset;
    store.setState({ selectedFileIndex: next, filesScrollOffset: scroll });
  } else if (key.name === 'right') {
    // Right only descends: on a file there is nothing to enter.
    if (selected?.isDir) deps.browseTo(enterDirectory(state.filesCwd || '', selected.name));
  } else if (key.name === 'return') {
    if (selected) openFileEntry(store, deps.browseTo, selected);
  } else if (key.name === 'i' || key.name === 'space') {
    if (selected && selected.name !== PARENT_ENTRY) {
      insertPathIntoInput(store, entryPath(state.filesCwd || '', selected.name));
    }
  } else if (key.name === 'escape') {
    store.setFocus('input');
  }
}

/** Enter on a directory browses it; on a file it opens the preview. */
export function openFileEntry(
  store: TuiStore,
  browseTo: (cwd: string) => boolean,
  item: TuiFileItem
): void {
  const state = store.getState();
  if (item.isDir) {
    browseTo(enterDirectory(state.filesCwd || '', item.name));
    return;
  }
  FileViewerModal.openFileModal(store, entryPath(state.filesCwd || '', item.name));
}

/** Appends a file path to the prompt buffer and moves focus to the input. */
export function insertPathIntoInput(store: TuiStore, insertPath: string): void {
  const currentInput = store.getState().inputText;
  store.setInputText((currentInput ? currentInput + ' ' : '') + insertPath);
  store.setFocus('input');
  store.notify(`Inserted '${insertPath}' into input prompt`, 'info');
}
