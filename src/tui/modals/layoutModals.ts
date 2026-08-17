import { TuiStore } from '../store';
import {
  LayoutConfigManager,
  TuiLayoutConfig,
  LAYOUT_PRESETS,
  TUI_THEMES,
  TuiThemeName,
  TuiWidgetId,
  DEFAULT_LAYOUT_CONFIG,
} from '../layoutConfig';

export class LayoutModals {
  static openLayoutModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    const currentTheme = TUI_THEMES[layoutConfig.theme]?.label || layoutConfig.theme;

    const options = [
      {
        label: '🔄 Layout Presets',
        value: 'presets',
        hint: 'Default Quadrant, Wide Chat, Sidebar on Right, Zen Focus',
      },
      {
        label: `🎨 Color Theme [${currentTheme}]`,
        value: 'theme',
        hint: 'Cyberpunk Cyan, Neon Magenta, Retro Amber, Matrix, Minimal',
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
        label: '💾 Save Configuration (tui.layout.json)',
        value: 'save',
        hint: 'Persist current layout preferences to disk',
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
        if (chosen === 'presets') {
          LayoutModals.openPresetModal(store, layoutConfig);
        } else if (chosen === 'theme') {
          LayoutModals.openThemeModal(store, layoutConfig);
        } else if (chosen === 'position') {
          LayoutModals.openSidebarPositionModal(store, layoutConfig);
        } else if (chosen === 'toggle_files') {
          layoutConfig.showFilesExplorer = !layoutConfig.showFilesExplorer;
          store.closeModal();
          store.notify(`Files explorer ${layoutConfig.showFilesExplorer ? 'enabled' : 'hidden'}`, 'success');
        } else if (chosen === 'width') {
          LayoutModals.openSidebarWidthModal(store, layoutConfig);
        } else if (chosen === 'widgets') {
          LayoutModals.openWidgetsModal(store, layoutConfig);
        } else if (chosen === 'save') {
          const saved = LayoutConfigManager.save(layoutConfig);
          store.closeModal();
          if (saved) {
            store.notify('Layout settings saved to tui.layout.json', 'success');
          } else {
            store.notify('Error saving layout configuration', 'error');
          }
        } else if (chosen === 'reset') {
          Object.assign(layoutConfig, DEFAULT_LAYOUT_CONFIG);
          LayoutConfigManager.save(layoutConfig);
          store.closeModal();
          store.notify('Layout reset to defaults', 'info');
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
          Object.assign(layoutConfig, preset.config);
          store.closeModal();
          store.notify(`Preset applied: ${preset.label}`, 'success');
        } else {
          store.closeModal();
        }
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
        store.closeModal();
        store.notify(`Theme set to: ${chosenTheme}`, 'success');
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
        store.closeModal();
        store.notify(`Sidebar position: ${chosen}`, 'success');
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
        store.closeModal();
        store.notify(`Sidebar width set to ${chosen}%`, 'success');
      },
    });
  }

  static openWidgetsModal(store: TuiStore, layoutConfig: TuiLayoutConfig): void {
    const allWidgets: Array<{ id: TuiWidgetId; label: string; hint: string }> = [
      { id: 'persona', label: '👤 Agent Profile', hint: 'Agent name, role, trait, effort & team' },
      { id: 'metrics', label: '📊 Session Metrics', hint: 'Turn counter, tool calls & token usage' },
      { id: 'tool_activity', label: '🛠️ Tool Activity', hint: 'History & status of recent tool executions' },
      { id: 'quick_keys', label: '⌨️ Quick Keys', hint: 'Quick shortcut key reference' },
    ];

    const current = new Set(layoutConfig.visibleWidgets);
    const options: Array<{ label: string; value: string; hint: string }> = allWidgets.map((w) => ({
      label: `${current.has(w.id) ? '✅' : '❌'} ${w.label}`,
      value: w.id,
      hint: w.hint,
    }));

    options.push({ label: '★ Enable All Widgets', value: 'all', hint: 'Display all 4 sections' });
    options.push({ label: '★ Minimal Profile Only', value: 'minimal', hint: 'Only agent card & metrics' });

    store.showModal({
      type: 'slash_menu',
      title: '🎚️ Customize Sidebar Widgets',
      selectedIndex: 0,
      options,
      onSelect: (chosen) => {
        if (chosen === 'all') {
          layoutConfig.visibleWidgets = ['persona', 'metrics', 'tool_activity', 'quick_keys'];
        } else if (chosen === 'minimal') {
          layoutConfig.visibleWidgets = ['persona', 'metrics'];
        } else {
          const wId = chosen as TuiWidgetId;
          if (current.has(wId)) {
            layoutConfig.visibleWidgets = layoutConfig.visibleWidgets.filter((id) => id !== wId);
          } else {
            layoutConfig.visibleWidgets.push(wId);
          }
        }
        store.closeModal();
        store.notify('Sidebar widgets updated', 'success');
      },
    });
  }
}
