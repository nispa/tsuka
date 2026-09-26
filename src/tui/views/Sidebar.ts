import chalk from 'chalk';
import { TuiState } from '../types';
import { TuiScreen } from '../screen';
import { PersonaWidget, MetricsWidget, InferenceTelemetryWidget, InferenceLedsWidget, ToolActivityWidget, QuickKeysWidget } from '../widgets';
import { TuiWidgetId, PaneFramer } from '../layoutConfig';

export class SidebarView {
  static render(state: TuiState, width: number, height: number, visibleWidgets: TuiWidgetId[] = ['persona', 'metrics', 'telemetry_leds', 'tool_activity', 'quick_keys'], framer?: PaneFramer, title = 'Agent Profile'): string[] {
    const divider = chalk.hex('#334155')('  ' + '─'.repeat(Math.max(10, width - 6)));
    const rawLines: string[] = [];

    const widgetMap: Record<TuiWidgetId, () => string[]> = {
      persona: () => PersonaWidget.render(state, width),
      metrics: () => MetricsWidget.render(state, width),
      telemetry: () => InferenceTelemetryWidget.render(state, width),
      telemetry_leds: () => InferenceLedsWidget.render(state, width),
      tool_activity: () => ToolActivityWidget.render(state, width),
      quick_keys: () => QuickKeysWidget.render(state, width),
    };

    let first = true;
    for (const wId of visibleWidgets) {
      if (widgetMap[wId]) {
        if (!first) rawLines.push(divider);
        rawLines.push(...widgetMap[wId]());
        first = false;
      }
    }

    if (rawLines.length === 0) {
      rawLines.push(chalk.gray('  (No active widgets)'));
    }

    // Apply sidebar scrolling if needed
    const innerHeight = Math.max(0, height - 2);
    const scrollOffset = Math.min(state.sidebarScrollOffset, Math.max(0, rawLines.length - innerHeight));
    const visibleLines = rawLines.slice(scrollOffset, scrollOffset + innerHeight);

    return TuiScreen.drawBox(title, visibleLines, width, height, state.focus === 'sidebar', undefined, undefined, framer?.('sidebar', state.focus === 'sidebar'));
  }
}
