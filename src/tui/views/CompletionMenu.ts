import chalk from 'chalk';
import { TUI_DEFAULTS } from '../../core/constants';
import { BoxDrawing, FrameSpec } from '../boxDrawing';
import type { CompletionMenuView } from '../layoutEngines/types';

/**
 * The suggestion menu, floating just above the prompt pane. Drawn as an overlay on the
 * composed frame, like modals: any layout engine gets it without placing it itself.
 */
export class CompletionMenuPanel {
  static overlay(
    lines: string[],
    view: CompletionMenuView,
    anchor: { x: number; y: number; width: number },
    frame: FrameSpec | undefined
  ): string[] {
    const max = TUI_DEFAULTS.completionMenuMaxItems;
    const shown = Math.min(max, view.items.length);
    // Keep the selection in view when the list is longer than the menu.
    const start = Math.min(Math.max(0, view.index - shown + 1), view.items.length - shown);
    const window = view.items.slice(start, start + shown);

    const longest = Math.max(...window.map((item) => BoxDrawing.stringWidth(item.value) + (item.hint ? BoxDrawing.stringWidth(item.hint) + 3 : 0)));
    const width = Math.max(24, Math.min(anchor.width - 2, longest + 6));
    const rows = window.map((item, i) => {
      const selected = start + i === view.index;
      const value = selected ? chalk.inverse.bold(` ${item.value} `) : ` ${item.value} `;
      return ` ${value}${item.hint ? '  ' + chalk.gray(item.hint) : ''}`;
    });

    const title = view.items.length > shown ? `${view.index + 1}/${view.items.length} · Tab ↑↓ Esc` : 'Tab ↑↓ Esc';
    const box = BoxDrawing.drawBox(title, rows, width, rows.length + 2, true, undefined, undefined, frame);
    // One row of clearance: the row right above the prompt is often part of the layout's own
    // chrome (the console's mid bar, the classic chat pane's bottom border).
    const y = Math.max(1, anchor.y - 1 - box.length);
    return BoxDrawing.overlay(lines, box, anchor.x + 1, y);
  }
}
