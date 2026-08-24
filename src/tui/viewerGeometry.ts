import { TUI_DEFAULTS } from '../core/constants';

/** Viewer dimensions stay within the real screen even on unusually small terminals. */
export function viewerWidth(screenWidth: number): number {
  return Math.max(10, Math.min(
    TUI_DEFAULTS.viewerMaxWidth,
    Math.max(TUI_DEFAULTS.viewerMinWidth, screenWidth - TUI_DEFAULTS.viewerHorizontalMargin),
    screenWidth - 2
  ));
}

export function viewerHeight(screenHeight: number): number {
  return Math.max(6, Math.min(
    TUI_DEFAULTS.viewerMaxHeight,
    Math.max(TUI_DEFAULTS.viewerMinHeight, screenHeight - TUI_DEFAULTS.viewerVerticalMargin),
    screenHeight - 2
  ));
}
