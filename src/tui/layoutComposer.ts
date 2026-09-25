import { TuiStore } from './store';
import { TuiState } from './types';
import { HeaderView } from './views/Header';
import { SidebarView } from './views/Sidebar';
import { ChatView } from './views/Chat';
import { InputView } from './views/Input';
import { ToolsView } from './views/Tools';
import { FilesView } from './views/Files';
import { ModalView } from './views/Modal';
import { LayoutConfigManager, TuiLayoutConfig } from './layoutConfig';
import { computeFrameGeometry } from './interaction/geometry';

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
  const theme = LayoutConfigManager.getTheme(layout.theme);
  const g = computeFrameGeometry(width, height, layout, {
    headerHeight: HeaderView.lineCount(state),
    inputText: state.inputText,
  });

  const headerLines = HeaderView.render(state, g.effectiveWidth, activeTab, theme);

  let sidebarColumnLines: string[] = [];
  if (g.sidebarWidth > 0) {
    if (layout.showFilesExplorer) {
      const profileLines = SidebarView.render(state, g.sidebarWidth, g.profileHeight, layout.visibleWidgets, theme);
      const filesLines = FilesView.render(state, g.sidebarWidth, g.filesHeight, theme);
      sidebarColumnLines = [...profileLines, ...filesLines];
    } else {
      sidebarColumnLines = SidebarView.render(state, g.sidebarWidth, g.mainHeight, layout.visibleWidgets, theme);
    }
  }

  const mainLines = activeTab === 'chat'
    ? ChatView.render(state, g.mainWidth, g.mainHeight, theme)
    : ToolsView.render(state, g.mainWidth, g.mainHeight, theme);

  const compositeBody: string[] = [];
  for (let i = 0; i < g.mainHeight; i++) {
    const mainPart = mainLines[i] || ' '.repeat(g.mainWidth);
    if (g.sidebarWidth === 0) {
      compositeBody.push(mainPart);
      continue;
    }
    const sidePart = sidebarColumnLines[i] || ' '.repeat(g.sidebarWidth);
    compositeBody.push(g.sidebarStart === 1 ? sidePart + mainPart : mainPart + sidePart);
  }

  const inputLines = InputView.render(state, g.effectiveWidth, g.inputHeight, theme);
  let screenBuffer = [...headerLines, ...compositeBody, ...inputLines];

  if (state.activeModal) {
    screenBuffer = ModalView.renderOverlay(state.activeModal, screenBuffer, g.effectiveWidth, height, theme);
  }

  return screenBuffer;
}
