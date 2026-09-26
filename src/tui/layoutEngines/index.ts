import { TUI_DEFAULTS } from '../../core/constants';
import { ModalView } from '../views/Modal';
import { DEFAULT_LAYOUT_CONFIG, LayoutConfigManager, paneFrame } from '../layoutConfig';
import { registerLayoutEngine, resolveLayoutEngine } from './registry';
import { classicLayoutEngine } from './classic';
import { consoleLayoutEngine } from './console';
import type { LayoutRequest, TuiFrame } from './types';

export * from './types';
export { registerLayoutEngine, listLayoutEngines, resolveLayoutEngine } from './registry';

// Built-in engines register exactly like a plug-in would.
registerLayoutEngine(classicLayoutEngine);
registerLayoutEngine(consoleLayoutEngine);

/**
 * Composes one frame with the engine named in the layout config, then overlays the
 * active modal: modals float above any arrangement, so no engine re-implements them.
 * Pure: same inputs, same frame, no side effects.
 */
export function composeLayoutFrame(request: Omit<LayoutRequest, 'theme'>): TuiFrame {
  const theme = LayoutConfigManager.getTheme(request.layout.theme);
  const engine = resolveLayoutEngine(request.layout.engine, DEFAULT_LAYOUT_CONFIG.engine);
  const frame = engine.compose({ ...request, theme });
  if (request.state.activeModal) {
    const effectiveWidth = Math.max(TUI_DEFAULTS.minEffectiveWidth, request.width - 1);
    frame.lines = ModalView.renderOverlay(request.state.activeModal, frame.lines, effectiveWidth, request.height,
      (pane, focused) => paneFrame(theme, pane, focused));
  }
  return frame;
}
