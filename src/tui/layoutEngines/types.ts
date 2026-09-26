import type { TuiFocus, TuiState } from '../types';
import type { TuiLayoutConfig, TuiThemePalette } from '../layoutConfig';
import type { TuiTabSpec } from '../navigation';

/** A pane's rectangle on screen, its frame included; 1-based terminal column and row. */
export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A clickable navigation control drawn by the layout: a header tab or an LCARS button. */
export interface TabZone {
  spec: TuiTabSpec;
  x: number;
  y: number;
  width: number;
}

/**
 * One composed screen: the rows to paint and where everything interactive landed.
 * The mouse router and the focus cycle read these regions from the frame actually on
 * screen, so a layout can place panes and buttons anywhere without the input layer
 * re-deriving its geometry (the drift T18.7 and T23.16 had to fix).
 */
export interface TuiFrame {
  lines: string[];
  /** Panes present in this frame; a focus target without a rect is not on screen. */
  panes: Partial<Record<TuiFocus, PaneRect>>;
  tabs: TabZone[];
}

export interface LayoutRequest {
  state: TuiState;
  width: number;
  height: number;
  activeTab: 'chat' | 'tools';
  layout: TuiLayoutConfig;
  theme: TuiThemePalette;
}

/**
 * A pluggable screen structure (AGENTS.md directive 8). Engines register themselves in
 * `registry.ts` and are selected by `engine` in the layout config; the views they place
 * are shared, only the arrangement and the chrome around them change.
 */
export interface TuiLayoutEngine {
  /** Value of `engine` in tui.layout.json. */
  id: string;
  label: string;
  description: string;
  compose(request: LayoutRequest): TuiFrame;
}
