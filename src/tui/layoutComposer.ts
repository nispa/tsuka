import { TuiState } from './types';
import { TuiLayoutConfig } from './layoutConfig';
import { composeLayoutFrame } from './layoutEngines';

/**
 * Lines of one full-screen frame, drawn by the layout engine the config selects
 * (layoutEngines/). Kept for callers that only paint; the app uses
 * composeLayoutFrame directly because it also needs the frame's regions.
 */
export function composeFrame(
  state: TuiState,
  width: number,
  height: number,
  activeTab: 'chat' | 'tools',
  layout: TuiLayoutConfig
): string[] {
  return composeLayoutFrame({ state, width, height, activeTab, layout }).lines;
}
