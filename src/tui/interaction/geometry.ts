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
