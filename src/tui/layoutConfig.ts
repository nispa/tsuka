/**
 * Layout Configuration Manager for TSUKA TUI.
 * Provides data-driven layout customisation, presets, themes, and JSON persistence.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export type SidebarPosition = 'left' | 'right' | 'hidden';
export type TuiThemeName = 'cyan' | 'neon' | 'amber' | 'matrix' | 'minimal';
export type TuiWidgetId = 'persona' | 'metrics' | 'tool_activity' | 'quick_keys';

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
}

export const TUI_THEMES: Record<TuiThemeName, TuiThemePalette> = {
  cyan: {
    name: 'cyan',
    label: '🌊 Cyberpunk Cyan (Default)',
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
  visibleWidgets: ['persona', 'metrics', 'tool_activity', 'quick_keys'],
  theme: 'cyan',
};

export const LAYOUT_PRESETS: Record<string, { label: string; description: string; config: Partial<TuiLayoutConfig> }> = {
  default: {
    label: '📐 Default Quadrant',
    description: 'Sidebar & Files on Left (26%), Chat on Right',
    config: {
      sidebarPosition: 'left',
      sidebarWidthPercent: 26,
      showFilesExplorer: true,
      filesHeightPercent: 55,
      visibleWidgets: ['persona', 'metrics', 'tool_activity', 'quick_keys'],
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
      visibleWidgets: ['persona', 'metrics'],
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
      visibleWidgets: ['persona', 'metrics', 'tool_activity', 'quick_keys'],
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

export class LayoutConfigManager {
  private static readonly CONFIG_PATH = path.join(__dirname, 'tui.layout.json');

  static load(): TuiLayoutConfig {
    try {
      if (fs.existsSync(this.CONFIG_PATH)) {
        const raw = fs.readFileSync(this.CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_LAYOUT_CONFIG,
          ...parsed,
        };
      }
    } catch {}
    return { ...DEFAULT_LAYOUT_CONFIG };
  }

  static save(config: TuiLayoutConfig): boolean {
    try {
      fs.writeFileSync(this.CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  static getTheme(themeName: TuiThemeName): TuiThemePalette {
    return TUI_THEMES[themeName] || TUI_THEMES.cyan;
  }
}
