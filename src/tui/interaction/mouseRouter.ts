import { TuiMouseEvent } from '../screen';
import { TuiTabSpec } from '../navigation';
import { TuiStore } from '../store';
import { TuiFileItem, TuiFocus } from '../types';
import { ChatView } from '../views/Chat';
import { FilesView } from '../views/Files';
import { entryPath } from '../fileExplorer';
import type { PaneRect, TuiFrame } from '../layoutEngines';

/**
 * Mouse event router: wheel scrolling, navigation clicks and pane focus/selection.
 * Everything is hit-tested against the regions of the frame currently on screen, as
 * reported by the layout engine that drew it — so any layout, built-in or plug-in,
 * gets correct click zones without this module knowing its geometry.
 */

export interface MouseRouterDeps {
  store: TuiStore;
  /** The frame last painted; undefined before the first render. */
  getFrame(): TuiFrame | undefined;
  getActiveTab(): 'chat' | 'tools';
  dimensions(): { width: number; height: number };
  /** Files currently listed in the explorer panel. */
  currentFiles(): TuiFileItem[];
  /** First-click select / second-click act on a file entry. */
  openFileEntry(item: TuiFileItem): void;
  /** Single navigation entry point shared with keyboard shortcuts. */
  activateTab(spec: TuiTabSpec): void;
}

/** Scroll step per wheel-up notch; wheel-down is the opposite (chat offsets grow upwards). */
const WHEEL_UP_STEP: Record<Exclude<TuiFocus, 'input'>, number> = { chat: 3, tools: -3, sidebar: -2, files: -2 };

function paneAt(frame: TuiFrame, col: number, row: number): [TuiFocus, PaneRect] | undefined {
  for (const [id, rect] of Object.entries(frame.panes) as Array<[TuiFocus, PaneRect]>) {
    if (col >= rect.x && col < rect.x + rect.width && row >= rect.y && row < rect.y + rect.height) return [id, rect];
  }
  return undefined;
}

/** 0-based content row inside a framed pane (every frame style has one row above the content). */
function contentRow(rect: PaneRect, row: number): number {
  return row - rect.y - 1;
}

export function routeMouseEvent(deps: MouseRouterDeps, mouse: TuiMouseEvent): void {
  const { store } = deps;
  const frame = deps.getFrame();
  if (!frame) return;
  const hit = paneAt(frame, mouse.col, mouse.row);

  if (mouse.button === 'wheelup' || mouse.button === 'wheeldown') {
    if (!hit || hit[0] === 'input') return;
    const step = WHEEL_UP_STEP[hit[0]];
    store.scroll(hit[0], mouse.button === 'wheelup' ? step : -step);
    return;
  }

  if (mouse.button !== 'left' || (mouse.action !== 'down' && mouse.action !== 'move')) return;

  const state = store.getState();
  if (state.activeModal) {
    const { height } = deps.dimensions();
    if (mouse.action === 'down' && (mouse.row <= 2 || mouse.row >= height - 2)) store.closeModal();
    return;
  }

  const tab = frame.tabs.find((zone) => mouse.row === zone.y && mouse.col >= zone.x && mouse.col < zone.x + zone.width);
  if (tab) {
    if (mouse.action === 'down') deps.activateTab(tab.spec);
    return;
  }

  if (!hit) return;
  const [pane, rect] = hit;
  if (pane === 'files') {
    handleFilesClick(deps, mouse, rect);
    return;
  }
  store.setFocus(pane);
  if (pane !== 'chat' && pane !== 'tools') return;
  // The scrollbar is the pane's right edge (plus one column of slack).
  if (mouse.col >= rect.x + rect.width - 2) {
    scrollbarJump(store, state.messages.length, mouse, rect);
  } else if (mouse.action === 'down' && pane === 'chat') {
    chatThinkingClick(deps, mouse, rect);
  }
}

function handleFilesClick(deps: MouseRouterDeps, mouse: TuiMouseEvent, rect: PaneRect): void {
  const { store } = deps;
  const state = store.getState();
  store.setFocus('files');
  const files = deps.currentFiles();
  const targetIndex = FilesView.indexAtRow(state, rect.height, contentRow(rect, mouse.row));
  if (targetIndex === undefined) return;
  const isAlreadySelected = state.selectedFileIndex === targetIndex;
  store.setState({ selectedFileIndex: targetIndex });
  const file = files[targetIndex];
  if (!file) return;
  // First click selects, second click acts: enter the directory or preview the file.
  if (isAlreadySelected) {
    deps.openFileEntry(file);
  } else if (file.isDir) {
    store.notify(`Click again to open '${file.name}'`, 'info');
  } else {
    const insertPath = entryPath(state.filesCwd || '', file.name);
    const currentInput = store.getState().inputText;
    store.setInputText((currentInput ? currentInput + ' ' : '') + insertPath);
    store.notify(`Selected '${insertPath}' (Click again to preview)`, 'info');
  }
}

/** Dragging on the pane's scrollbar jumps the chat feed proportionally. */
function scrollbarJump(store: TuiStore, messageCount: number, mouse: TuiMouseEvent, rect: PaneRect): void {
  const track = Math.max(1, rect.height - 2);
  const trackY = Math.max(0, Math.min(track - 1, contentRow(rect, mouse.row)));
  const scrollRatio = 1 - trackY / Math.max(1, track - 1);
  const totalMsgs = messageCount * 4;
  store.setState({ chatScrollOffset: Math.max(0, Math.round(scrollRatio * Math.max(0, totalMsgs))) });
}

/** A plain click on a reasoning header toggles that message's thinking block. */
function chatThinkingClick(deps: MouseRouterDeps, mouse: TuiMouseEvent, rect: PaneRect): void {
  const { store } = deps;
  const state = store.getState();
  const row = contentRow(rect, mouse.row);
  // A click on the pane's frame resolves to no content row at all.
  const thinkTarget = row >= 0 ? ChatView.getThinkingHeaderAtRow(state, rect.width, rect.height, row) : undefined;
  if (thinkTarget) {
    const isExpanded = store.toggleMessageThinking(thinkTarget.id);
    store.notify(`Reasoning (${thinkTarget.authorName || 'Tsuka'}): ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
  }
}
