/**
 * Workspace Files Explorer view for TSUKA TUI (Bottom-Left panel).
 * Displays interactive list of files/directories with data-driven icons, scrolling, and path insertion.
 */

import chalk from 'chalk';
import { TuiState, TuiFileItem } from '../types';
import { TuiScreen } from '../screen';
import { listDirectory, PARENT_ENTRY } from '../fileExplorer';
import fileTypesConfig from '../fileTypes.json';

interface FileStyleRule {
  type?: string;
  match?: string;
  extensions?: string[];
  patterns?: string[];
  icon: string;
  iconColor: string;
  nameColor: string;
}

export class FilesView {
  /**
   * Resolves visual glyph and chalk styling for a given file or folder.
   */
  static getFileStyle(item: TuiFileItem): { icon: string; nameColor: (s: string) => string } {
    if (item.isDir) {
      const dirRule = fileTypesConfig.rules.find((r) => r.type === 'dir');
      if (dirRule) {
        return {
          icon: chalk.hex(dirRule.iconColor)(dirRule.icon),
          nameColor: chalk.hex(dirRule.nameColor),
        };
      }
    }

    const lowerName = item.name.toLowerCase();
    for (const rule of fileTypesConfig.rules as FileStyleRule[]) {
      if (rule.match === 'test' && rule.extensions?.some((ext) => lowerName.endsWith(ext))) {
        return {
          icon: chalk.hex(rule.iconColor)(rule.icon),
          nameColor: chalk.hex(rule.nameColor),
        };
      }
      if (rule.match === 'extension' && item.ext && rule.extensions?.includes(item.ext.toLowerCase())) {
        return {
          icon: chalk.hex(rule.iconColor)(rule.icon),
          nameColor: chalk.hex(rule.nameColor),
        };
      }
      if (rule.match === 'prefix_or_contains' && rule.patterns?.some((p) => lowerName.includes(p))) {
        return {
          icon: chalk.hex(rule.iconColor)(rule.icon),
          nameColor: chalk.hex(rule.nameColor),
        };
      }
    }

    const def = fileTypesConfig.defaultFile;
    return {
      icon: chalk.hex(def.iconColor)(def.icon),
      nameColor: chalk.hex(def.nameColor),
    };
  }

  /**
   * Lists the directory currently browsed in the panel (T14.12).
   * Kept as a thin wrapper so views and controllers share one entry point.
   */
  static scanDirectory(relCwd: string = ''): TuiFileItem[] {
    return listDirectory(relCwd);
  }

  /** Entries the panel is showing: the cached listing, or a fresh scan of the browsed folder. */
  static visibleFiles(state: TuiState): TuiFileItem[] {
    return state.workspaceFiles.length > 0 ? state.workspaceFiles : listDirectory(state.filesCwd || '');
  }

  /**
   * Index of the entry drawn on a given content row, or undefined when the row holds no
   * entry. Shares the scroll clamp with render(): the click handler used to add the raw
   * filesScrollOffset, which drifts from the drawn window as soon as the offset is clamped.
   */
  static indexAtRow(state: TuiState, height: number, contentRow: number): number | undefined {
    const files = FilesView.visibleFiles(state);
    const innerHeight = Math.max(0, height - 2);
    if (contentRow < 0 || contentRow >= innerHeight) return undefined;
    const scrollOffset = Math.min(state.filesScrollOffset, Math.max(0, files.length - innerHeight));
    const index = scrollOffset + contentRow;
    return index < files.length ? index : undefined;
  }

  static render(state: TuiState, width: number, height: number): string[] {
    const files = FilesView.visibleFiles(state);
    const rawLines: string[] = [];

    const innerWidth = Math.max(10, width - 2);
    const innerHeight = Math.max(0, height - 2);

    if (files.length === 0) {
      rawLines.push(chalk.gray('  (Empty folder)'));
    } else {
      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        const isSelected = i === state.selectedFileIndex && state.focus === 'files';
        const isParent = item.name === PARENT_ENTRY;
        const style = isParent
          ? { icon: chalk.hex('#94a3b8')('⬆ '), nameColor: chalk.hex('#94a3b8') }
          : FilesView.getFileStyle(item);

        const prefix = isSelected ? chalk.bold.hex('#38bdf8')('❯ ') : '  ';
        const rawName = isParent ? '.. (up)' : item.isDir ? `${item.name}/` : item.name;

        // Calculate available space for the name
        const iconWidth = TuiScreen.stringWidth(style.icon);
        const prefixWidth = 2;
        const availableNameWidth = Math.max(6, innerWidth - prefixWidth - iconWidth - 1);

        const displayName = rawName.length > availableNameWidth
          ? rawName.slice(0, availableNameWidth - 1) + '…'
          : rawName;

        const lineContent = isSelected
          ? chalk.bold.hex('#38bdf8')(`${style.icon}${displayName}`)
          : `${style.icon}${style.nameColor(displayName)}`;

        rawLines.push(`${prefix}${lineContent}`);
      }
    }

    // Scroll window calculation
    const totalLines = rawLines.length;
    const scrollOffset = Math.min(state.filesScrollOffset, Math.max(0, totalLines - innerHeight));
    const visibleLines = rawLines.slice(scrollOffset, scrollOffset + innerHeight);

    // The title doubles as a breadcrumb: at the root it names the panel, deeper
    // it shows where you are (→ enters a folder, ← goes back up).
    const cwd = state.filesCwd || '';
    const title = cwd ? `📁 ${cwd} (${files.length})` : `📁 Files (${files.length})`;
    return TuiScreen.drawBox(
      title,
      visibleLines,
      width,
      height,
      state.focus === 'files',
      undefined,
      { total: totalLines, visible: innerHeight, offset: Math.max(0, totalLines - innerHeight - scrollOffset) }
    );
  }
}
