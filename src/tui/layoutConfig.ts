/**
 * Layout Configuration Manager for TSUKA TUI.
 * Provides data-driven layout customisation, presets, themes, and JSON persistence.
 */

import * as fs from 'fs';
import chalk from 'chalk';
import type { FrameSpec } from './boxDrawing';
import { homePath } from '../core/apphome';

export type SidebarPosition = 'left' | 'right' | 'hidden';
export type TuiThemeName = 'lcars' | 'cyan' | 'neon' | 'amber' | 'matrix' | 'minimal';
/** Boxed panes a theme can colour individually. */
export type TuiPaneId = 'chat' | 'tools' | 'sidebar' | 'files' | 'input' | 'busy' | 'modal';
export type TuiWidgetId = 'persona' | 'metrics' | 'telemetry' | 'telemetry_leds' | 'tool_activity' | 'quick_keys';

export interface TuiLayoutConfig {
  sidebarPosition: SidebarPosition;
  sidebarWidthPercent: number;
  showFilesExplorer: boolean;
  filesHeightPercent: number;
  visibleWidgets: TuiWidgetId[];
  theme: TuiThemeName;
}

export interface TuiThemePalette {
  name: TuiThemeName;
  label: string;
  primary: (s: string) => string;
  secondary: (s: string) => string;
  accent: (s: string) => string;
  borderFocused: (s: string) => string;
  borderUnfocused: (s: string) => string;
  /**
   * LCARS-style chrome: when present, every pane is framed as an LCARS elbow in its
   * own colour and the header draws pill buttons and a segmented bar. Absent, panes
   * keep the classic thin rounded box — so a theme opts in to the frame, it never
   * silently inherits it.
   */
  lcars?: LcarsChrome;
}

/** Colour data of an LCARS theme: one `[focused, idle]` pair per pane, plus header accents. */
export interface LcarsChrome {
  panes: Record<TuiPaneId, [string, string]>;
  /** Pill colour of the active tab. */
  activeTab: string;
  /** Inactive tab pills cycle through these, as on a real LCARS button bank. */
  tabs: string[];
  /** Segments of the bar closing the header, as `[colour, share of the width]`. */
  headerBar: Array<[string, number]>;
}

/** Frame of one pane under the given theme; undefined means the classic rounded box. */
export function paneFrame(theme: TuiThemePalette | undefined, pane: TuiPaneId, isFocused: boolean): FrameSpec | undefined {
  const colors = theme?.lcars?.panes[pane];
  if (!colors) return undefined;
  return { style: 'lcars', color: isFocused ? colors[0] : colors[1] };
}

export const TUI_THEMES: Record<TuiThemeName, TuiThemePalette> = {
  // Star Trek: The Next Generation's LCARS layout (Okuda): flat bands on black. The hues
  // are LCARS's (orange, lavender, periwinkle, sky, tan), but at reduced brightness: the
  // on-screen full-strength pastels are glaring on a terminal you read for hours.
  lcars: {
    name: 'lcars',
    label: '🖖 LCARS (Star Trek TNG)',
    primary: chalk.hex('#c7853a'),
    secondary: chalk.hex('#a086a0'),
    accent: chalk.hex('#7c9ebd'),
    borderFocused: chalk.hex('#b8965a'),
    borderUnfocused: chalk.hex('#4d3d2b'),
    lcars: {
      panes: {
        sidebar: ['#c7853a', '#6e4c26'],
        files: ['#7c7cb8', '#46466b'],
        chat: ['#a086a0', '#5c4c5c'],
        tools: ['#7c9ebd', '#46596b'],
        input: ['#9c8068', '#5c4c3e'],
        busy: ['#a8552a', '#a8552a'],
        modal: ['#b8965a', '#b8965a'],
      },
      activeTab: '#c7853a',
      tabs: ['#8a738a', '#6b6ba3', '#6b88a3', '#8c735d'],
      headerBar: [['#c7853a', 0.55], ['#a086a0', 0.15], ['#7c7cb8', 0.2], ['#9e5a5a', 0.1]],
    },
  },
  cyan: {
    name: 'cyan',
    label: '🌊 Cyberpunk Cyan',
    primary: chalk.hex('#38bdf8'),
    secondary: chalk.hex('#818cf8'),
    accent: chalk.hex('#e879f9'),
    borderFocused: chalk.cyan,
    borderUnfocused: chalk.gray,
  },
  neon: {
    name: 'neon',
    label: '⚡ Neon Purple / Magenta',
    primary: chalk.hex('#e879f9'),
    secondary: chalk.hex('#c084fc'),
    accent: chalk.hex('#38bdf8'),
    borderFocused: chalk.magenta,
    borderUnfocused: chalk.hex('#475569'),
  },
  amber: {
    name: 'amber',
    label: '🔥 Retro Terminal Amber',
    primary: chalk.hex('#fbbf24'),
    secondary: chalk.hex('#f59e0b'),
    accent: chalk.hex('#fcd34d'),
    borderFocused: chalk.yellow,
    borderUnfocused: chalk.hex('#78350f'),
  },
  matrix: {
    name: 'matrix',
    label: '🟢 Hacker Matrix Green',
    primary: chalk.hex('#22c55e'),
    secondary: chalk.hex('#16a34a'),
    accent: chalk.hex('#86efac'),
    borderFocused: chalk.green,
    borderUnfocused: chalk.hex('#14532d'),
  },
  minimal: {
    name: 'minimal',
    label: '⚪ Monochrome Minimalist',
    primary: chalk.white,
    secondary: chalk.hex('#94a3b8'),
    accent: chalk.hex('#cbd5e1'),
    borderFocused: chalk.white,
    borderUnfocused: chalk.hex('#334155'),
  },
};

export const DEFAULT_LAYOUT_CONFIG: TuiLayoutConfig = {
  sidebarPosition: 'left',
  sidebarWidthPercent: 26,
  showFilesExplorer: true,
  filesHeightPercent: 55,
  visibleWidgets: ['persona', 'metrics', 'telemetry_leds', 'tool_activity', 'quick_keys'],
  theme: 'lcars',
};

export const LAYOUT_PRESETS: Record<string, { label: string; description: string; config: Partial<TuiLayoutConfig> }> = {
  lcars: {
    label: '🖖 LCARS Bridge Console',
    description: 'Star Trek TNG panels: agent profile & files on the left elbow, LCARS frames',
    config: { ...DEFAULT_LAYOUT_CONFIG },
  },
  default: {
    label: '📐 Default Quadrant',
    description: 'Sidebar & Files on Left (26%), Chat on Right',
    config: {
      sidebarPosition: 'left',
      sidebarWidthPercent: 26,
      showFilesExplorer: true,
      filesHeightPercent: 55,
      visibleWidgets: ['persona', 'metrics', 'telemetry_leds', 'tool_activity', 'quick_keys'],
    },
  },
  wide: {
    label: '💬 Wide Chat / Minimal',
    description: 'Files hidden, narrow sidebar (20%), wide conversation area',
    config: {
      sidebarPosition: 'left',
      sidebarWidthPercent: 20,
      showFilesExplorer: false,
      filesHeightPercent: 0,
      visibleWidgets: ['persona', 'metrics', 'telemetry_leds'],
    },
  },
  right: {
    label: '👉 Sidebar on Right',
    description: 'Chat on Left, Sidebar & Files Explorer on Right (28%)',
    config: {
      sidebarPosition: 'right',
      sidebarWidthPercent: 28,
      showFilesExplorer: true,
      filesHeightPercent: 55,
      visibleWidgets: ['persona', 'metrics', 'telemetry_leds', 'tool_activity', 'quick_keys'],
    },
  },
  zen: {
    label: '🧘 Zen / Focus Mode',
    description: 'Full-screen chat feed and input, sidebar completely hidden',
    config: {
      sidebarPosition: 'hidden',
      sidebarWidthPercent: 0,
      showFilesExplorer: false,
      filesHeightPercent: 0,
      visibleWidgets: [],
    },
  },
};

/** Every widget the sidebar can host, in its default display order. */
export const TUI_WIDGET_IDS: TuiWidgetId[] = ['persona', 'metrics', 'telemetry_leds', 'telemetry', 'tool_activity', 'quick_keys'];
const SIDEBAR_POSITIONS: SidebarPosition[] = ['left', 'right', 'hidden'];

/**
 * Applies a preset or saved patch onto the live config. The live object is shared by
 * the frame composer and the mouse router, so it is updated in place — but arrays are
 * copied: assigning a preset's `visibleWidgets` by reference let a later widget toggle
 * mutate the preset (and DEFAULT_LAYOUT_CONFIG itself), so "reset" stopped resetting.
 */
export function applyLayout(target: TuiLayoutConfig, patch: Partial<TuiLayoutConfig>): TuiLayoutConfig {
  Object.assign(target, patch);
  target.visibleWidgets = [...(patch.visibleWidgets ?? target.visibleWidgets)];
  return target;
}

/** Keeps only the fields of a user-edited JSON that the TUI can actually honour. */
function sanitizeLayout(raw: any): TuiLayoutConfig {
  const config = applyLayout({ ...DEFAULT_LAYOUT_CONFIG }, {});
  if (!raw || typeof raw !== 'object') return config;
  if (SIDEBAR_POSITIONS.includes(raw.sidebarPosition)) config.sidebarPosition = raw.sidebarPosition;
  if (Number.isFinite(raw.sidebarWidthPercent)) config.sidebarWidthPercent = raw.sidebarWidthPercent;
  if (typeof raw.showFilesExplorer === 'boolean') config.showFilesExplorer = raw.showFilesExplorer;
  if (Number.isFinite(raw.filesHeightPercent)) config.filesHeightPercent = raw.filesHeightPercent;
  if (Array.isArray(raw.visibleWidgets)) config.visibleWidgets = raw.visibleWidgets.filter((w: any) => TUI_WIDGET_IDS.includes(w));
  if (raw.theme in TUI_THEMES) config.theme = raw.theme;
  return config;
}

export class LayoutConfigManager {
  /**
   * User preference, so it lives in the app home next to tsuka.config.json — not beside
   * this module, which put it in src/tui/ under tsx (tracked by git) and in dist/tui/
   * once built, two different files for the same setting.
   */
  static configPath(): string {
    return homePath('tui.layout.json');
  }

  static load(): TuiLayoutConfig {
    try {
      const file = this.configPath();
      if (fs.existsSync(file)) {
        return sanitizeLayout(JSON.parse(fs.readFileSync(file, 'utf-8')));
      }
    } catch {}
    return sanitizeLayout(undefined);
  }

  static save(config: TuiLayoutConfig): boolean {
    try {
      fs.writeFileSync(this.configPath(), JSON.stringify(config, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  static getTheme(themeName: TuiThemeName): TuiThemePalette {
    return TUI_THEMES[themeName] || TUI_THEMES[DEFAULT_LAYOUT_CONFIG.theme];
  }
}
