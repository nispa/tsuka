/**
 * Workspace Files Explorer view for TSUKA TUI (Bottom-Left panel).
 * Displays interactive list of files/directories with data-driven icons, scrolling, and path insertion.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { TuiState, TuiFileItem } from '../types';
import { TuiScreen } from '../screen';
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
   * Scans the current working directory for workspace files and subdirectories.
   */
  static scanDirectory(cwd: string = process.cwd()): TuiFileItem[] {
    try {
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      const items: TuiFileItem[] = [];
      const ignored = new Set(fileTypesConfig.ignoredDirs);

      for (const entry of entries) {
        if (ignored.has(entry.name)) {
          continue;
        }

        const isDir = entry.isDirectory();
        const ext = isDir ? '' : path.extname(entry.name).toLowerCase();
        let size: number | undefined;

        try {
          if (!isDir) {
            const stat = fs.statSync(path.join(cwd, entry.name));
            size = stat.size;
          }
        } catch {}

        items.push({
          name: entry.name,
          isDir,
          size,
          ext,
        });
      }

      // Sort: Directories first, then files alphabetically
      items.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      return items;
    } catch {
      return [];
    }
  }

  static render(state: TuiState, width: number, height: number): string[] {
    const files = state.workspaceFiles.length > 0 ? state.workspaceFiles : FilesView.scanDirectory();
    const rawLines: string[] = [];

    const innerWidth = Math.max(10, width - 2);
    const innerHeight = Math.max(0, height - 2);

    if (files.length === 0) {
      rawLines.push(chalk.gray('  (Empty folder)'));
    } else {
      for (let i = 0; i < files.length; i++) {
        const item = files[i];
        const isSelected = i === state.selectedFileIndex && state.focus === 'files';
        const style = FilesView.getFileStyle(item);

        const prefix = isSelected ? chalk.bold.hex('#38bdf8')('❯ ') : '  ';
        const rawName = item.isDir ? `${item.name}/` : item.name;

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

    const title = `📁 Files (${files.length})`;
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
