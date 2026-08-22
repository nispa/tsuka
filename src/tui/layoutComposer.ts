import { TUI_DEFAULTS } from '../core/constants';
import { TuiStore } from './store';
import { TuiState } from './types';
import { HeaderView } from './views/Header';
import { SidebarView } from './views/Sidebar';
import { ChatView } from './views/Chat';
import { InputView } from './views/Input';
import { ToolsView } from './views/Tools';
import { FilesView } from './views/Files';
import { ModalView } from './views/Modal';
import { TuiLayoutConfig } from './layoutConfig';
import { computeFilePaneHeights, computeInputHeight, computeSidebarWidth } from './interaction/geometry';

/**
 * Pure composition of one full-screen frame from the reactive store state.
 * Extracted from TuiApp so rendering has no dependency on the app orchestrator:
 * same inputs -> same lines, no side effects.
 */
export function composeFrame(
  state: TuiState,
  width: number,
  height: number,
  activeTab: 'chat' | 'tools',
  layout: TuiLayoutConfig
): string[] {
  const effectiveWidth = Math.max(TUI_DEFAULTS.minEffectiveWidth, width - 1);

  const headerLines = HeaderView.render(state, effectiveWidth, activeTab);
  const inputHeight = computeInputHeight(state.inputText);
  const mainHeight = Math.max(
    TUI_DEFAULTS.minMainHeight,
    height - headerLines.length - inputHeight
  );

  const sidebarPos = layout.sidebarPosition;
  const showFiles = layout.showFilesExplorer;

  let sidebarWidth = 0;
  let mainWidth = effectiveWidth;

  if (sidebarPos !== 'hidden') {
    sidebarWidth = computeSidebarWidth(effectiveWidth, layout);
    mainWidth = Math.max(10, effectiveWidth - sidebarWidth);
  }

  let sidebarColumnLines: string[] = [];
  if (sidebarPos !== 'hidden') {
    if (showFiles) {
      const { filesHeight, profileHeight } = computeFilePaneHeights(mainHeight, showFiles, layout);
      const profileLines = SidebarView.render(state, sidebarWidth, profileHeight, layout.visibleWidgets);
      const filesLines = FilesView.render(state, sidebarWidth, filesHeight);
      sidebarColumnLines = [...profileLines, ...filesLines];
    } else {
      sidebarColumnLines = SidebarView.render(state, sidebarWidth, mainHeight, layout.visibleWidgets);
    }
  }

  const mainLines = activeTab === 'chat'
    ? ChatView.render(state, mainWidth, mainHeight)
    : ToolsView.render(state, mainWidth, mainHeight);

  const compositeBody: string[] = [];
  for (let i = 0; i < mainHeight; i++) {
    if (sidebarPos === 'hidden') {
      compositeBody.push(mainLines[i] || ' '.repeat(mainWidth));
    } else if (sidebarPos === 'right') {
      const mainPart = mainLines[i] || ' '.repeat(mainWidth);
      const sidePart = sidebarColumnLines[i] || ' '.repeat(sidebarWidth);
      compositeBody.push(mainPart + sidePart);
    } else {
      const sidePart = sidebarColumnLines[i] || ' '.repeat(sidebarWidth);
      const mainPart = mainLines[i] || ' '.repeat(mainWidth);
      compositeBody.push(sidePart + mainPart);
    }
  }

  const inputLines = InputView.render(state, effectiveWidth, inputHeight);
  let screenBuffer = [...headerLines, ...compositeBody, ...inputLines];

  if (state.activeModal) {
    screenBuffer = ModalView.renderOverlay(state.activeModal, screenBuffer, effectiveWidth, height);
  }

  return screenBuffer;
}
