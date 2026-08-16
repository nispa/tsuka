import * as fs from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { ConfigManager } from '../../core/config';

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
  const resolved = resolvePath(filePath);
  const root = getEffectiveRoot();

  const normalized = path.normalize(resolved);
  const normalizedRoot = path.normalize(root) + path.sep;

  if (normalized !== path.normalize(root) && !normalized.startsWith(normalizedRoot)) {
    throw new Error(
      `Access denied: path '${filePath}' is outside authorized workspace ` +
      `('${root}'). All file operations must stay within the workspace.`
    );
  }

  return resolved;
}
