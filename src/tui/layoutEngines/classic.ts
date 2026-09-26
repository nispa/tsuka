import { HeaderView } from '../views/Header';
import { SidebarView } from '../views/Sidebar';
import { ChatView } from '../views/Chat';
import { InputView } from '../views/Input';
import { ToolsView } from '../views/Tools';
import { FilesView } from '../views/Files';
import { PaneFramer, paneFrame } from '../layoutConfig';
import { layoutTabs } from '../navigation';
import { computeFrameGeometry } from '../interaction/geometry';
import type { LayoutRequest, TuiFrame, TuiLayoutEngine } from './types';

/**
 * Classic quadrant: tabs and status on top, a sidebar column (agent profile over the
 * files explorer) beside the main view, the prompt at the bottom. Each pane is framed
 * on its own — rounded in a classic theme's colours, an LCARS elbow under LCARS.
 */
export const classicLayoutEngine: TuiLayoutEngine = {
  id: 'classic',
  label: '📐 Classic quadrant',
  description: 'Tabs on top, sidebar and files beside the conversation, each pane boxed',

  compose({ state, width, height, activeTab, layout, theme }: LayoutRequest): TuiFrame {
    const framer: PaneFramer = (pane, focused) => paneFrame(theme, pane, focused);
    const g = computeFrameGeometry(width, height, layout, {
      headerHeight: HeaderView.lineCount(state),
      inputText: state.inputText,
    });
    const panes: TuiFrame['panes'] = {};
    const bodyTop = g.headerHeight + 1;

    const headerLines = HeaderView.render(state, g.effectiveWidth, activeTab, theme);

    let sidebarColumnLines: string[] = [];
    if (g.sidebarWidth > 0) {
      const profileHeight = layout.showFilesExplorer ? g.profileHeight : g.mainHeight;
      sidebarColumnLines = SidebarView.render(state, g.sidebarWidth, profileHeight, layout.visibleWidgets, framer);
      panes.sidebar = { x: g.sidebarStart, y: bodyTop, width: g.sidebarWidth, height: profileHeight };
      if (layout.showFilesExplorer) {
        sidebarColumnLines = [...sidebarColumnLines, ...FilesView.render(state, g.sidebarWidth, g.filesHeight, framer)];
        panes.files = { x: g.sidebarStart, y: bodyTop + g.profileHeight, width: g.sidebarWidth, height: g.filesHeight };
      }
    }

    const mainLines = activeTab === 'chat'
      ? ChatView.render(state, g.mainWidth, g.mainHeight, framer)
      : ToolsView.render(state, g.mainWidth, g.mainHeight, framer);
    panes[activeTab] = { x: g.mainStart, y: bodyTop, width: g.mainWidth, height: g.mainHeight };

    const body: string[] = [];
    for (let i = 0; i < g.mainHeight; i++) {
      const mainPart = mainLines[i] || ' '.repeat(g.mainWidth);
      if (g.sidebarWidth === 0) {
        body.push(mainPart);
        continue;
      }
      const sidePart = sidebarColumnLines[i] || ' '.repeat(g.sidebarWidth);
      body.push(g.sidebarStart === 1 ? sidePart + mainPart : mainPart + sidePart);
    }

    const inputLines = InputView.render(state, g.effectiveWidth, g.inputHeight, framer);
    panes.input = { x: 1, y: bodyTop + g.mainHeight, width: g.effectiveWidth, height: g.inputHeight };

    return {
      lines: [...headerLines, ...body, ...inputLines],
      panes,
      tabs: layoutTabs(g.effectiveWidth, activeTab).map((zone) => ({
        spec: zone.spec,
        x: zone.start,
        y: 1,
        width: zone.end - zone.start + 1,
      })),
    };
  },
};
