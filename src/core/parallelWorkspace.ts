import * as fs from 'fs';
import * as path from 'path';
import { homePath } from './apphome';

/**
 * Isolated staging workspaces for branches of a PARALLEL block (T3.2).
 *
 * Each branch writes into its own staging folder under the app home (`workspace/parallel-<n>/`),
 * preventing concurrent file writes from clobbering each other. At merge time, conflicts
 * (same relative path, different content across branches) are detected without touching
 * the main workspace.
 */

export interface ParallelBranch {
  index: number;
  /** Branch label (e.g. character aiName) for logs and conflict reporting. */
  label: string;
  /** Absolute staging directory path for this branch. */
  root: string;
}

export interface MergeConflict {
  relativePath: string;
  labels: string[];
}

export interface MergeResult {
  merged: string[];
  conflicts: MergeConflict[];
}

/** Creates staging directories for branches, cleaning up any leftover directories. */
export function createParallelBranches(labels: string[]): ParallelBranch[] {
  const base = homePath('workspace');
  return labels.map((label, i) => {
    const index = i + 1;
    const root = path.join(base, `parallel-${index}`);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    return { index, label, root };
  });
}

/** Recursively lists all files in `dir` as relative paths. */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(dir, full));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/**
 * Merges files produced by parallel branches into the main workspace.
 * If two or more branches wrote differing content to the same relative path,
 * the conflict is recorded in `conflicts` and the target file is not overwritten.
 * Staging directories are cleaned up upon completion.
 */
export function mergeParallelWorkspaces(branches: ParallelBranch[], mainWorkspaceRoot: string): MergeResult {
  const writers = new Map<string, { label: string; content: Buffer }[]>();

  for (const branch of branches) {
    for (const relPath of listFilesRecursive(branch.root)) {
      const content = fs.readFileSync(path.join(branch.root, relPath));
      const list = writers.get(relPath) ?? [];
      list.push({ label: branch.label, content });
      writers.set(relPath, list);
    }
  }

  const merged: string[] = [];
  const conflicts: MergeConflict[] = [];

  for (const [relPath, entries] of writers) {
    const distinct: Buffer[] = [];
    for (const e of entries) {
      if (!distinct.some((b) => b.equals(e.content))) distinct.push(e.content);
    }

    if (distinct.length > 1) {
      conflicts.push({ relativePath: relPath, labels: entries.map((e) => e.label) });
      continue;
    }

    const target = path.join(mainWorkspaceRoot, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, distinct[0]);
    merged.push(relPath);
  }

  for (const branch of branches) {
    try { fs.rmSync(branch.root, { recursive: true, force: true }); } catch {}
  }

  return { merged, conflicts };
}
