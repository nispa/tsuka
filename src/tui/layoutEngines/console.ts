import chalk from 'chalk';
import { TUI_DEFAULTS } from '../../core/constants';
import { TSUKA_PACKAGE } from '../../core/packageInfo';
import { TuiScreen } from '../screen';
import { HeaderView, lcarsBar } from '../views/Header';
import { ChatView } from '../views/Chat';
import { InputView } from '../views/Input';
import { ToolsView } from '../views/Tools';
import { LcarsChrome, PaneFramer, TUI_THEMES, paneFrame } from '../layoutConfig';
import { TUI_TABS } from '../navigation';
import { computeInputHeight } from '../interaction/geometry';
import { classicLayoutEngine } from './classic';
import type { LayoutRequest, TabZone, TuiFrame, TuiLayoutEngine } from './types';

/**
 * LCARS bridge console (Star Trek TNG). One large elbow frames the whole screen:
 *
 *   ▟████████████▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀ ▀▀  TSUKA     ← top bar joined to the column
 *   █████ F1 CHAT  status: agent · model · ctx
 *   █████ F2 TOOLS CONVERSATION                     ← the column holds the tab buttons
 *   ...           (chat or tools)
 *   ██████ 47-1701▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄   ← mid bar splits the two sections
 *   ███ AGENT ███  ❯ prompt
 *   █ Tsuka        (input)                          ← agent readout beside the prompt
 *   ▜████████████▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀
 *
 * The panes inside carry only a caption: the elbow is their frame. There is no
 * sidebar or files pane here, so focus cycles through the conversation and the
 * prompt only; the classic engine remains the layout with the files explorer.
 */

const BLACK = '#000000';

function button(hex: string, label: string, width: number, bold = false): string {
  const text = label.length > width - 1 ? label.slice(0, width - 1) : label;
  const paint = chalk.bgHex(hex).hex(BLACK);
  return (bold ? paint.bold : paint)(' '.repeat(Math.max(0, width - text.length - 1)) + text + ' ');
}

/** Agent readout for the lower column: name, craft, model and a context gauge. */
function agentReadout(request: LayoutRequest, chrome: LcarsChrome, width: number): string[] {
  const { state } = request;
  const accent = chalk.hex(chrome.activeTab);
  const dim = chalk.hex(chrome.panes.sidebar[1]);
  const pct = state.stats.percentage;
  const barWidth = Math.max(4, width - 7);
  const filled = Math.min(barWidth, Math.round((pct / 100) * barWidth));
  return [
    accent.bold(state.activeAiName),
    dim(`${state.activeCharacterRole} · ${state.activeCharacterTrait}`),
    dim(state.activeModel || 'default'),
    accent('█'.repeat(filled)) + chalk.hex('#3a3a3a')('░'.repeat(barWidth - filled)) + accent(` ${String(pct).padStart(3)}%`),
  ];
}

export const consoleLayoutEngine: TuiLayoutEngine = {
  id: 'console',
  label: '🖖 LCARS bridge console',
  description: 'LCARS button column and one elbow framing conversation and prompt',

  compose(request: LayoutRequest): TuiFrame {
    const { state, width, height, activeTab, theme } = request;
    const W = Math.max(TUI_DEFAULTS.minEffectiveWidth, width - 1);
    // Too narrow for a button column and a readable conversation: degrade, don't squash.
    if (W < TUI_DEFAULTS.consoleMinWidth) return classicLayoutEngine.compose(request);

    // The console is LCARS by nature; a classic theme still gets LCARS chrome here.
    const chrome = theme.lcars ?? TUI_THEMES.lcars.lcars!;
    const colW = TUI_DEFAULTS.consoleColumnWidth;
    const rightW = W - colW;
    const contentW = rightW - 1;
    const contentX = colW + 2;
    const column = chrome.panes.sidebar[0];
    const fg = chalk.hex(column);
    const band = (n: number) => chalk.bgHex(column)(' '.repeat(Math.max(0, n)));

    const statusRows = [HeaderView.statusLine(state, contentW), HeaderView.detailLine(state, contentW)]
      .filter((row): row is string => !!row);
    const lowerH = Math.max(computeInputHeight(state.inputText), TUI_DEFAULTS.consoleLowerRows);
    const mainH = Math.max(TUI_DEFAULTS.minMainHeight, height - 3 - statusRows.length - lowerH);
    const mainTop = 2 + statusRows.length;
    const midRow = mainTop + mainH;
    const lowerTop = midRow + 1;
    const total = lowerTop + lowerH;

    const framer: PaneFramer = (pane, focused) =>
      pane === 'modal' ? paneFrame(theme, pane, focused) : { style: 'caption', color: chrome.panes[pane][focused ? 0 : 1] };
    const mainLines = activeTab === 'chat'
      ? ChatView.render(state, contentW, mainH, framer)
      : ToolsView.render(state, contentW, mainH, framer);
    const inputLines = InputView.render(state, contentW, lowerH, framer);

    // ── Left column: tab buttons, filler, panel code, agent block ──
    const tabs: TabZone[] = [];
    const columnCell = (row: number): string => {
      if (row === 1) return fg('▟') + band(colW - 1);
      if (row === total) return fg('▜') + band(colW - 1);
      if (row < midRow) {
        const index = row - 2;
        const spec = TUI_TABS[index];
        if (!spec) return band(colW);
        const isActive = spec.id === activeTab;
        const hex = isActive ? chrome.highlight : chrome.tabs[index % chrome.tabs.length];
        tabs.push({ spec, x: 1, y: row, width: colW });
        // The widest label without its emoji: a button has room for "F5 MEMORY", not for a glyph.
        const label = spec.labels[2].replace(/[^ -~]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
        return button(hex, label, colW, isActive);
      }
      if (row === midRow) return button(column, chrome.code, colW);
      if (row === lowerTop) return button(chrome.tabs[1], 'AGENT', colW, true);
      const readout = agentReadout(request, chrome, colW - 2)[row - lowerTop - 1] ?? '';
      return fg('█') + ' ' + TuiScreen.truncateOrPad(readout, colW - 2) + ' ';
    };

    // ── Right side: bars, status, conversation, prompt ──
    const version = W > 95 ? ` v${TSUKA_PACKAGE.version}` : '';
    const brand = ' ' + chalk.hex(chrome.activeTab).bold('TSUKA') + chalk.hex(chrome.activeTab)(version) + ' ';
    const rightCell = (row: number): string => {
      if (row === 1) return lcarsBar(chrome, rightW - TuiScreen.stringWidth(brand), '▀') + brand;
      if (row === total) return lcarsBar(chrome, rightW, '▀', [...chrome.headerBar].reverse());
      if (row === midRow) return lcarsBar(chrome, rightW, '▄');
      if (row < mainTop) return ' ' + (statusRows[row - 2] ?? '');
      if (row < midRow) return ' ' + (mainLines[row - mainTop] ?? '');
      return ' ' + (inputLines[row - lowerTop] ?? '');
    };

    const lines: string[] = [];
    for (let row = 1; row <= total; row++) {
      lines.push(TuiScreen.truncateOrPad(columnCell(row), colW) + TuiScreen.truncateOrPad(rightCell(row), rightW));
    }

    return {
      lines,
      panes: {
        [activeTab]: { x: contentX, y: mainTop, width: contentW, height: mainH },
        input: { x: contentX, y: lowerTop, width: contentW, height: lowerH },
      },
      tabs,
    };
  },
};
