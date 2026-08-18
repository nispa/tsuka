/**
 * Directory navigation for the Files Explorer panel (T14.12).
 *
 * Pure functions over a path relative to the workspace root: the panel keeps
 * only that string in the state and asks here what to list and where a key
 * press leads. Every resolution goes through `resolveSafePath`, so browsing
 * can never leave the workspace jail.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TuiFileItem } from './types';
import { resolveSafePath } from '../tools/impl/utils';
import fileTypesConfig from './fileTypes.json';

/** Entry that walks one level up; listed first when not at the workspace root. */
export const PARENT_ENTRY = '..';

/** '' means the workspace root; separators are normalized to '/' for display. */
export function normalizeRelative(relPath: string): string {
  const normalized = path.normalize(relPath || '.').replace(/\\/g, '/');
  if (normalized === '.' || normalized === './') return '';
  return normalized.replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Absolute path of a directory inside the jail, or undefined when it is outside. */
function safeResolve(relPath: string): string | undefined {
  try {
    return resolveSafePath(normalizeRelative(relPath) || '.');
  } catch {
    return undefined;
  }
}

/** Path of an entry of the current directory, relative to the workspace root. */
export function entryPath(relCwd: string, name: string): string {
  return normalizeRelative(path.join(normalizeRelative(relCwd), name));
}

/**
 * Lists a directory of the workspace. Directories come first, alphabetically,
 * preceded by `..` whenever there is a level to go back to.
 */
export function listDirectory(relCwd: string = ''): TuiFileItem[] {
  const cwd = normalizeRelative(relCwd);
  const absolute = safeResolve(cwd);
  if (!absolute) return [];

  const items: TuiFileItem[] = [];
  const ignored = new Set(fileTypesConfig.ignoredDirs);

  try {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;

      const isDir = entry.isDirectory();
      let size: number | undefined;
      try {
        if (!isDir) size = fs.statSync(path.join(absolute, entry.name)).size;
      } catch {}

      items.push({ name: entry.name, isDir, size, ext: isDir ? '' : path.extname(entry.name).toLowerCase() });
    }
  } catch {
    return [];
  }

  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  if (cwd) items.unshift({ name: PARENT_ENTRY, isDir: true, ext: '' });

  return items;
}

/** Directory containing the current one; the root is its own parent. */
export function parentDirectory(relCwd: string): string {
  const cwd = normalizeRelative(relCwd);
  if (!cwd) return '';
  return normalizeRelative(path.dirname(cwd));
}

/**
 * Directory reached by opening `name` from `relCwd`. Returns the current
 * directory unchanged when the move is not possible (missing directory, or a
 * path outside the workspace), so the caller can report a refused move by
 * comparing the result.
 */
export function enterDirectory(relCwd: string, name: string): string {
  if (name === PARENT_ENTRY) return parentDirectory(relCwd);

  const target = entryPath(relCwd, name);
  const absolute = safeResolve(target);
  if (!absolute) return normalizeRelative(relCwd);

  try {
    if (!fs.statSync(absolute).isDirectory()) return normalizeRelative(relCwd);
  } catch {
    return normalizeRelative(relCwd);
  }

  return target;
}
