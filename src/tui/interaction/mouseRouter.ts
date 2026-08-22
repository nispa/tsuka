import { TuiMouseEvent } from '../screen';
import { TuiTabSpec, tabAtColumn } from '../navigation';
import { TuiStore } from '../store';
import { TuiLayoutConfig } from '../layoutConfig';
import { TuiFileItem } from '../types';
import { ChatView } from '../views/Chat';
import { FilesView } from '../views/Files';
import { entryPath } from '../fileExplorer';
import { TuiScreen } from '../screen';
import { computeFilePaneHeights, computeSidebarWidth } from './geometry';

/**
 * Mouse event router extracted from TuiApp: wheel scrolling, header-tab click
 * zones and pane focus/selection. All geometry is computed with the same helpers
 * the frame composer uses, so click zones always match what is on screen.
 */

export interface MouseRouterDeps {
  store: TuiStore;
  layout: TuiLayoutConfig;
  getActiveTab(): 'chat' | 'tools';
  dimensions(): { width: number; height: number };
  /** Files currently listed in the explorer panel. */
  currentFiles(): TuiFileItem[];
  /** First-click select / second-click act on a file entry. */
  openFileEntry(item: TuiFileItem): void;
  /** Single navigation entry point shared with keyboard shortcuts. */
  activateTab(spec: TuiTabSpec): void;
}

export function routeMouseEvent(deps: MouseRouterDeps, mouse: TuiMouseEvent): void {
  const { store } = deps;
  const state = store.getState();
  const dims = deps.dimensions();
  const effectiveWidth = Math.max(20, dims.width - 1);
  const headerHeight = 3;
  const inputHeight = 3;
  const mainHeight = Math.max(5, dims.height - headerHeight - inputHeight);

  const layout = deps.layout;
  const sidebarPos = layout.sidebarPosition;
  const showFiles = layout.showFilesExplorer;

  const sidebarWidth = sidebarPos !== 'hidden' ? computeSidebarWidth(effectiveWidth, layout) : 0;
  const { filesHeight, profileHeight } = computeFilePaneHeights(mainHeight, showFiles, layout);

  // 1. Mouse Wheel Scrolling
  if (mouse.button === 'wheelup') {
    const inSidebar = (sidebarPos === 'left' && mouse.col <= sidebarWidth) ||
                      (sidebarPos === 'right' && mouse.col >= effectiveWidth - sidebarWidth);
    if (inSidebar) {
      if (showFiles && mouse.row > headerHeight + profileHeight) store.scroll('files', -2);
      else store.scroll('sidebar', -2);
    } else {
      if (deps.getActiveTab() === 'chat') store.scroll('chat', 3);
      else store.scroll('tools', -3);
    }
    return;
  }
  if (mouse.button === 'wheeldown') {
    const inSidebar = (sidebarPos === 'left' && mouse.col <= sidebarWidth) ||
                      (sidebarPos === 'right' && mouse.col >= effectiveWidth - sidebarWidth);
    if (inSidebar) {
      if (showFiles && mouse.row > headerHeight + profileHeight) store.scroll('files', 2);
      else store.scroll('sidebar', 2);
    } else {
      if (deps.getActiveTab() === 'chat') store.scroll('chat', -3);
      else store.scroll('tools', 3);
    }
    return;
  }

  // 2. Left Click handling
  if (mouse.button === 'left' && (mouse.action === 'down' || mouse.action === 'move')) {
    if (state.activeModal) {
      if (mouse.action === 'down' && (mouse.row <= 2 || mouse.row >= dims.height - 2)) store.closeModal();
      return;
    }

    // Top Header Click Tabs: zones are computed from the same table the header
    // draws, so a relabelled tab keeps a click zone that matches what is shown.
    if (mouse.row <= headerHeight) {
      if (mouse.action !== 'down') return;
      const clicked = tabAtColumn(effectiveWidth, deps.getActiveTab(), mouse.col);
      if (clicked) deps.activateTab(clicked);
      return;
    }

    // Bottom Input Click
    if (mouse.row >= dims.height - inputHeight) {
      store.setFocus('input');
      return;
    }

    // Middle Body Click
    const isSidebarClick = sidebarPos !== 'hidden' && (
      (sidebarPos === 'left' && mouse.col <= sidebarWidth) ||
      (sidebarPos === 'right' && mouse.col >= effectiveWidth - sidebarWidth)
    );

    if (isSidebarClick) {
      if (!showFiles || mouse.row <= headerHeight + profileHeight) {
        store.setFocus('sidebar');
      } else {
        handleFilesClick(deps, { mouse, effectiveWidth, headerHeight, filesHeight, profileHeight });
      }
    } else {
      store.setFocus(deps.getActiveTab() === 'chat' ? 'chat' : 'tools');
      if (mouse.col >= effectiveWidth - 2) {
        scrollbarJump(store, state.messages.length, { mainHeight, headerHeight, mouse });
      } else if (mouse.action === 'down' && deps.getActiveTab() === 'chat') {
        chatThinkingClick(deps, { mouse, effectiveWidth, sidebarWidth, mainHeight, headerHeight });
      }
    }
  }
}

function handleFilesClick(
  deps: MouseRouterDeps,
  g: { mouse: TuiMouseEvent; effectiveWidth: number; headerHeight: number; filesHeight: number; profileHeight: number }
): void {
  const { store } = deps;
  const state = store.getState();
  store.setFocus('files');
  const files = deps.currentFiles();
  const clickedRow = TuiScreen.paneContentRow(g.mouse.row, g.headerHeight, g.profileHeight);
  const targetIndex = FilesView.indexAtRow(state, g.filesHeight, clickedRow);
  if (targetIndex !== undefined) {
    const isAlreadySelected = state.selectedFileIndex === targetIndex;
    store.setState({ selectedFileIndex: targetIndex });
    const file = files[targetIndex];
    if (file) {
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
  }
}

/** Dragging on the right-edge scrollbar jumps the chat feed proportionally. */
function scrollbarJump(
  store: TuiStore,
  messageCount: number,
  g: { mainHeight: number; headerHeight: number; mouse: TuiMouseEvent }
): void {
  const trackY = Math.max(0, Math.min(g.mainHeight - 1, g.mouse.row - g.headerHeight - 1));
  const scrollRatio = 1 - (trackY / (g.mainHeight - 1));
  const totalMsgs = messageCount * 4;
  const targetOffset = Math.round(scrollRatio * Math.max(0, totalMsgs));
  store.setState({ chatScrollOffset: Math.max(0, targetOffset) });
}

/** A plain click on a reasoning header toggles that message's thinking block. */
function chatThinkingClick(
  deps: MouseRouterDeps,
  g: { mouse: TuiMouseEvent; effectiveWidth: number; sidebarWidth: number; mainHeight: number; headerHeight: number }
): void {
  const { store } = deps;
  const state = store.getState();
  const chatWidth = g.effectiveWidth - g.sidebarWidth;
  const clickedRow = TuiScreen.paneContentRow(g.mouse.row, g.headerHeight);
  // A click on the pane border resolves to no content row at all.
  const thinkTarget = clickedRow >= 0
    ? ChatView.getThinkingHeaderAtRow(state, chatWidth, g.mainHeight, clickedRow)
    : undefined;
  if (thinkTarget) {
    const isExpanded = store.toggleMessageThinking(thinkTarget.id);
    store.notify(`Reasoning (${thinkTarget.authorName || 'Tsuka'}): ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
  }
}
