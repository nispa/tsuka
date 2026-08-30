import * as fs from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { ConfigManager } from '../../core/config';
import { TOOLS_DEFAULTS } from '../../core/constants';

/**
 * Temporary workspace override (T3.2): isolates each branch of a PARALLEL block
 * in /goal to its dedicated staging folder rather than mutating the real workspace.
 */
const workspaceOverride = new AsyncLocalStorage<string>();

/** Executes `fn` with a temporary active workspace root for its async closure. */
export function withWorkspaceOverride<T>(root: string, fn: () => Promise<T>): Promise<T> {
  return workspaceOverride.run(root, fn);
}

/** Returns the effective workspace root (override if active, else configured workspace root). */
function getEffectiveRoot(): string {
  return workspaceOverride.getStore() ?? new ConfigManager().getWorkspaceRoot();
}

/** Resolves relative file paths against the effective workspace root. */
export function resolvePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(getEffectiveRoot(), filePath);
}

function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalExistingPath(filePath: string): string {
  return fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath);
}

/** Checks whether a file is binary by scanning initial bytes for null characters. */
export function isBinaryFile(filePath: string): boolean {
  const buffer = Buffer.alloc(512);
  try {
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
  } catch {}
  return false;
}

/**
 * Resolves and validates file paths to ensure operations remain within the workspace sandbox.
 */
export function resolveSafePath(filePath: string): string {
  const root = path.resolve(getEffectiveRoot());
  const resolved = path.resolve(resolvePath(filePath));
  if (!isInsideRoot(root, resolved)) {
    throw new Error(
      `Access denied: path '${filePath}' is outside authorized workspace ` +
      `('${root}'). All file operations must stay within the workspace.`
    );
  }

  const canonicalRoot = canonicalExistingPath(root);
  let ancestor = resolved;
  const missingSegments: string[] = [];
  while (true) {
    try {
      fs.lstatSync(ancestor);
      break;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missingSegments.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }

  let canonicalAncestor: string;
  try {
    canonicalAncestor = canonicalExistingPath(ancestor);
  } catch (error: any) {
    throw new Error(`Access denied: path '${filePath}' contains an unresolved filesystem link (${error.message}).`);
  }
  if (!isInsideRoot(canonicalRoot, canonicalAncestor)) {
    throw new Error(`Access denied: path '${filePath}' resolves outside authorized workspace ('${canonicalRoot}').`);
  }

  const canonicalTarget = path.join(canonicalAncestor, ...missingSegments);
  if (!isInsideRoot(canonicalRoot, canonicalTarget)) {
    throw new Error(`Access denied: path '${filePath}' resolves outside authorized workspace ('${canonicalRoot}').`);
  }
  return canonicalTarget;
}

export interface WorkspaceWalkFile {
  fullPath: string;
  size: number;
}

export interface WorkspaceWalkResult {
  files: WorkspaceWalkFile[];
  blockedLinks: number;
  truncatedReason?: 'depth' | 'files' | 'bytes';
}

export interface WorkspaceWalkOptions {
  ignoredDirectories?: ReadonlySet<string>;
  maxDepth?: number;
  maxFiles?: number;
  maxBytes?: number;
}

/**
 * Walks canonical workspace paths without following external links or revisiting a
 * real directory. Bounds are shared so recursive tools cannot scan indefinitely.
 */
export function walkWorkspaceFiles(startPath: string, options: WorkspaceWalkOptions = {}): WorkspaceWalkResult {
  const maxDepth = options.maxDepth ?? TOOLS_DEFAULTS.workspaceScanMaxDepth;
  const maxFiles = options.maxFiles ?? TOOLS_DEFAULTS.workspaceScanMaxFiles;
  const maxBytes = options.maxBytes ?? TOOLS_DEFAULTS.workspaceScanMaxBytes;
  const result: WorkspaceWalkResult = { files: [], blockedLinks: 0 };
  const visitedDirectories = new Set<string>();
  let totalBytes = 0;

  function visit(candidate: string, depth: number, isRoot = false): void {
    if (result.truncatedReason) return;
    if (depth > maxDepth) {
      result.truncatedReason = 'depth';
      return;
    }

    let safePath: string;
    try {
      safePath = resolveSafePath(candidate);
    } catch (error) {
      if (isRoot) throw error;
      result.blockedLinks++;
      return;
    }
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      const realDirectory = canonicalExistingPath(safePath);
      if (visitedDirectories.has(realDirectory)) return;
      visitedDirectories.add(realDirectory);
      if (!isRoot && options.ignoredDirectories?.has(path.basename(safePath))) return;
      for (const item of fs.readdirSync(safePath)) {
        visit(path.join(safePath, item), depth + 1);
        if (result.truncatedReason) break;
      }
      return;
    }
    if (!stat.isFile()) return;
    if (result.files.length >= maxFiles) {
      result.truncatedReason = 'files';
      return;
    }
    if (totalBytes + stat.size > maxBytes) {
      result.truncatedReason = 'bytes';
      return;
    }
    totalBytes += stat.size;
    result.files.push({ fullPath: safePath, size: stat.size });
  }

  visit(startPath, 0, true);
  return result;
}
