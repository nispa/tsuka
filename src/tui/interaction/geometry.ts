import { TUI_DEFAULTS } from '../../core/constants';
import { TuiLayoutConfig } from '../layoutConfig';

/**
 * Pure pane-geometry math shared by the frame composer and the mouse router, so a
 * click zone can never disagree with what was actually drawn (T18.7's lesson: the
 * two used to be computed by hand in separate places and drift).
 */

/** Sidebar column width for the current terminal width, clamped to usable bounds. */
export function computeSidebarWidth(effectiveWidth: number, layout: TuiLayoutConfig): number {
  const widthPct = (layout.sidebarWidthPercent || TUI_DEFAULTS.sidebarWidthPercent) / 100;
  return Math.min(
    TUI_DEFAULTS.sidebarMaxWidth,
    Math.max(TUI_DEFAULTS.sidebarMinWidth, Math.floor(effectiveWidth * widthPct))
  );
}

/**
 * Vertical split of the sidebar column between the agent profile and the files
 * explorer. `filesHeight` is 0 when the explorer is hidden.
 */
export function computeFilePaneHeights(
  mainHeight: number,
  showFiles: boolean,
  layout: TuiLayoutConfig
): { filesHeight: number; profileHeight: number } {
  if (!showFiles) {
    return { filesHeight: 0, profileHeight: mainHeight };
  }
  const filesPct = (layout.filesHeightPercent || TUI_DEFAULTS.filesHeightPercent) / 100;
  const filesHeight = Math.max(TUI_DEFAULTS.minFilesHeight, Math.floor(mainHeight * filesPct));
  return { filesHeight, profileHeight: Math.max(TUI_DEFAULTS.minProfileHeight, mainHeight - filesHeight) };
}

/** Input box height: raw line count plus padding, clamped between the bounds. */
export function computeInputHeight(inputText: string | undefined): number {
  const rawLineCount = inputText ? inputText.split(/\r?\n/).length : 1;
  return Math.min(
    TUI_DEFAULTS.inputMaxLines,
    Math.max(TUI_DEFAULTS.inputMinLines, rawLineCount + TUI_DEFAULTS.inputPaddingLines)
  );
}

/** Every pane rectangle of one frame. Columns are 1-based terminal columns. */
export interface FrameGeometry {
  effectiveWidth: number;
  headerHeight: number;
  inputHeight: number;
  mainHeight: number;
  /** 0 when the sidebar is hidden. */
  sidebarWidth: number;
  sidebarStart: number;
  mainWidth: number;
  mainStart: number;
  filesHeight: number;
  profileHeight: number;
}

/**
 * The single layout computation of a frame, used by the composer to draw and by the
 * mouse router to hit-test. The router used to assume a 3-line header and a 3-line
 * input, so a multi-line prompt or the header's progress line shifted every click,
 * and it looked for the chat scrollbar at the screen edge even with the sidebar there.
 */
export function computeFrameGeometry(
  width: number,
  height: number,
  layout: TuiLayoutConfig,
  rows: { headerHeight: number; inputText: string | undefined }
): FrameGeometry {
  const effectiveWidth = Math.max(TUI_DEFAULTS.minEffectiveWidth, width - 1);
  const inputHeight = computeInputHeight(rows.inputText);
  const mainHeight = Math.max(TUI_DEFAULTS.minMainHeight, height - rows.headerHeight - inputHeight);

  const hasSidebar = layout.sidebarPosition !== 'hidden';
  const sidebarWidth = hasSidebar ? computeSidebarWidth(effectiveWidth, layout) : 0;
  const mainWidth = hasSidebar ? Math.max(10, effectiveWidth - sidebarWidth) : effectiveWidth;
  const sidebarOnRight = layout.sidebarPosition === 'right';
  const { filesHeight, profileHeight } = computeFilePaneHeights(mainHeight, hasSidebar && layout.showFilesExplorer, layout);

  return {
    effectiveWidth,
    headerHeight: rows.headerHeight,
    inputHeight,
    mainHeight,
    sidebarWidth,
    sidebarStart: sidebarOnRight ? mainWidth + 1 : 1,
    mainWidth,
    mainStart: sidebarOnRight || !hasSidebar ? 1 : sidebarWidth + 1,
    filesHeight,
    profileHeight,
  };
}

/** Whether a 1-based column falls inside the sidebar column. */
export function isSidebarColumn(g: FrameGeometry, column: number): boolean {
  return g.sidebarWidth > 0 && column >= g.sidebarStart && column < g.sidebarStart + g.sidebarWidth;
}
