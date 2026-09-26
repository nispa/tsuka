import { TuiStore } from '../store';
import {
  LayoutConfigManager,
  TuiLayoutConfig,
  LAYOUT_PRESETS,
  TUI_THEMES,
  TuiThemeName,
  TuiWidgetId,
  DEFAULT_LAYOUT_CONFIG,
  TUI_WIDGET_IDS,
  applyLayout,
} from '../layoutConfig';
import { listLayoutEngines } from '../layoutEngines';

/**
 * Every F7 change is applied and saved at once (T24.7): a choice that vanished on
 * restart unless a separate "Save" entry was picked — while "Reset" saved on its own —
 * was two rules for one screen.
 */
function commit(store: TuiStore, layoutConfig: TuiLayoutConfig, message: string): void {
  const saved = LayoutConfigManager.save(layoutConfig);
  store.closeModal();
  store.notify(saved ? message : `${message} (could not save tui.layout.json)`, saved ? 'success' : 'error');
}

export class LayoutModals {
  static openLayoutModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    const currentTheme = TUI_THEMES[layoutConfig.theme]?.label || layoutConfig.theme;

    const engineLabel = listLayoutEngines().find((e) => e.id === layoutConfig.engine)?.label ?? layoutConfig.engine;
    const options = [
      {
        label: `🧭 Screen Structure [${engineLabel}]`,
        value: 'engine',
        hint: listLayoutEngines().map((e) => e.label).join(', '),
      },
      {
        label: '🔄 Layout Presets',
        value: 'presets',
        hint: Object.values(LAYOUT_PRESETS).map((p) => p.label).join(', '),
      },
      {
        label: `🎨 Color Theme [${currentTheme}]`,
        value: 'theme',
        hint: Object.values(TUI_THEMES).map((t) => t.label).join(', '),
      },
      {
        label: `📐 Sidebar Position [${layoutConfig.sidebarPosition.toUpperCase()}]`,
        value: 'position',
        hint: 'Left, Right, or Hidden (Zen mode)',
      },
      {
        label: `📁 Files Explorer [${layoutConfig.showFilesExplorer ? 'VISIBLE' : 'HIDDEN'}]`,
        value: 'toggle_files',
        hint: 'Show or hide workspace files explorer in sidebar',
      },
      {
        label: `📏 Sidebar Width [${layoutConfig.sidebarWidthPercent}%]`,
        value: 'width',
        hint: 'Configure sidebar column ratio (20% - 40%)',
      },
      {
        label: '🎚️ Customize Sidebar Widgets',
        value: 'widgets',
        hint: `Active: ${layoutConfig.visibleWidgets.join(', ')}`,
      },
      {
        label: '↺ Reset to Default Layout',
        value: 'reset',
        hint: 'Restore initial default configuration',
      },
    ];

    store.showModal({
      type: 'slash_menu',
      title: '📐 TUI Layout Editor & Settings (F7)',
      selectedIndex: 0,
      options,
      onSelect: (chosen) => {
        if (chosen === 'engine') {
          LayoutModals.openEngineModal(store, layoutConfig);
        } else if (chosen === 'presets') {
          LayoutModals.openPresetModal(store, layoutConfig);
        } else if (chosen === 'theme') {
          LayoutModals.openThemeModal(store, layoutConfig);
        } else if (chosen === 'position') {
          LayoutModals.openSidebarPositionModal(store, layoutConfig);
        } else if (chosen === 'toggle_files') {
          layoutConfig.showFilesExplorer = !layoutConfig.showFilesExplorer;
          commit(store, layoutConfig, `Files explorer ${layoutConfig.showFilesExplorer ? 'enabled' : 'hidden'}`);
        } else if (chosen === 'width') {
          LayoutModals.openSidebarWidthModal(store, layoutConfig);
        } else if (chosen === 'widgets') {
          LayoutModals.openWidgetsModal(store, layoutConfig);
        } else if (chosen === 'reset') {
          applyLayout(layoutConfig, DEFAULT_LAYOUT_CONFIG);
          commit(store, layoutConfig, 'Layout reset to defaults');
        } else {
          store.closeModal();
        }
      },
    });
  }

  static openPresetModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    const options = Object.entries(LAYOUT_PRESETS).map(([key, p]) => ({
      label: p.label,
      value: key,
      hint: p.description,
    }));

    store.showModal({
      type: 'slash_menu',
      title: '🔄 Select Layout Preset',
      selectedIndex: 0,
      options,
      onSelect: (chosenKey) => {
        const preset = LAYOUT_PRESETS[chosenKey];
        if (preset) {
          applyLayout(layoutConfig, preset.config);
          commit(store, layoutConfig, `Preset applied: ${preset.label}`);
        } else {
          store.closeModal();
        }
      },
    });
  }

  /** Screen structures come from the layout engine registry: a plug-in engine appears here by registering. */
  static openEngineModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    store.showModal({
      type: 'slash_menu',
      title: '🧭 Select Screen Structure',
      selectedIndex: 0,
      options: listLayoutEngines().map((engine) => ({ label: engine.label, value: engine.id, hint: engine.description })),
      onSelect: (chosen) => {
        layoutConfig.engine = chosen;
        commit(store, layoutConfig, `Screen structure: ${chosen}`);
      },
    });
  }

  static openThemeModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    const options = Object.values(TUI_THEMES).map((t) => ({
      label: t.label,
      value: t.name,
      hint: `Color palette: ${t.name}`,
    }));

    store.showModal({
      type: 'slash_menu',
      title: '🎨 Select Color Theme',
      selectedIndex: 0,
      options,
      onSelect: (chosenTheme) => {
        layoutConfig.theme = chosenTheme as TuiThemeName;
        commit(store, layoutConfig, `Theme set to: ${chosenTheme}`);
      },
    });
  }

  static openSidebarPositionModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    const options = [
      { label: '⬅️ Left (Default)', value: 'left', hint: 'Profile & Files Explorer on Left, Chat on Right' },
      { label: '➡️ Right', value: 'right', hint: 'Chat on Left, Profile & Files Explorer on Right' },
      { label: '🚫 Hidden (Zen Mode)', value: 'hidden', hint: 'Full-screen chat without sidebars' },
    ];

    store.showModal({
      type: 'slash_menu',
      title: '📐 Sidebar Column Position',
      selectedIndex: 0,
      options,
      onSelect: (chosen) => {
        layoutConfig.sidebarPosition = chosen as any;
        commit(store, layoutConfig, `Sidebar position: ${chosen}`);
      },
    });
  }

  static openSidebarWidthModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    const options = [
      { label: '🔹 20% (Compact)', value: '20', hint: 'Minimal footprint, maximum chat width' },
      { label: '🔹 26% (Balanced / Default)', value: '26', hint: 'Recommended ratio for standard screens' },
      { label: '🔹 33% (Wide)', value: '33', hint: 'Ideal for ultrawide monitors or long filenames' },
      { label: '🔹 40% (Extra Large)', value: '40', hint: 'Maximum readability of profile details' },
    ];

    store.showModal({
      type: 'slash_menu',
      title: '📏 Sidebar Column Width',
      selectedIndex: 0,
      options,
      onSelect: (chosen) => {
        layoutConfig.sidebarWidthPercent = parseInt(chosen, 10) || 26;
        commit(store, layoutConfig, `Sidebar width set to ${chosen}%`);
      },
    });
  }

  static openWidgetsModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    const allWidgets: Array<{ id: TuiWidgetId; label: string; hint: string }> = [
      { id: 'persona', label: '👤 Agent Profile', hint: 'Agent name, role, trait, effort & team' },
      { id: 'metrics', label: '📊 Session Metrics', hint: 'Turn counter, tool calls & token usage' },
      { id: 'telemetry_leds', label: '💡 Hardware Status LEDs', hint: 'Compact LED indicators (RDY, PRE, THK, DEC, TOL)' },
      { id: 'telemetry', label: '📡 Detailed Telemetry', hint: 'KV Cache ingestion, TTFT ms, decode tok/s & logits' },
      { id: 'tool_activity', label: '🛠️ Tool Activity', hint: 'History & status of recent tool executions' },
      { id: 'quick_keys', label: '⌨️ Quick Keys', hint: 'Quick shortcut key reference' },
    ];

    const current = new Set(layoutConfig.visibleWidgets);
    const options: Array<{ label: string; value: string; hint: string }> = allWidgets.map((w) => ({
      label: `${current.has(w.id) ? '✅' : '❌'} ${w.label}`,
      value: w.id,
      hint: w.hint,
    }));

    options.push({ label: '★ Enable All Widgets', value: 'all', hint: 'Display all sidebar sections' });
    options.push({ label: '★ Minimal Profile Only', value: 'minimal', hint: 'Only agent card, metrics & LEDs' });

    store.showModal({
      type: 'slash_menu',
      title: '🎚️ Customize Sidebar Widgets',
      selectedIndex: 0,
      options,
      onSelect: (chosen) => {
        if (chosen === 'all') {
          layoutConfig.visibleWidgets = [...TUI_WIDGET_IDS];
        } else if (chosen === 'minimal') {
          layoutConfig.visibleWidgets = ['persona', 'metrics', 'telemetry_leds'];
        } else {
          // Never push into the current array: it may still be shared with a preset.
          const wId = chosen as TuiWidgetId;
          layoutConfig.visibleWidgets = current.has(wId)
            ? layoutConfig.visibleWidgets.filter((id) => id !== wId)
            : [...layoutConfig.visibleWidgets, wId];
        }
        commit(store, layoutConfig, 'Sidebar widgets updated');
      },
    });
  }
}
