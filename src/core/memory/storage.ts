import * as fs from 'fs';
import * as path from 'path';
import { logSink } from '../logSink';
import { MemoryFact } from './types';
import { dedupeFacts, normalizeFact } from './codec';

export interface MemoryFilePayload {
  facts: MemoryFact[];
}

export interface MemoryLoadResult {
  facts: MemoryFact[];
  mtime: number;
}

/**
 * Probes the filesystem modification timestamp for a memory file.
 */
export function readMemoryMtime(filePath: string): number {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : -1;
  } catch {
    return -1;
  }
}

/**
 * Loads facts from disk with corruption recovery and orphan tmp cleanup.
 */
export function safeLoadJsonMemoryFile(filePath: string): MemoryLoadResult {
  try {
    // An orphan tmp file means a previous save crashed between write and rename; discard it.
    const tmpPath = `${filePath}.tmp`;
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }

    if (fs.existsSync(filePath)) {
      const mtime = fs.statSync(filePath).mtimeMs;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as MemoryFilePayload;
      const rawFacts = Array.isArray(data.facts) ? data.facts : [];
      const normalizedFacts = rawFacts.map((f) => normalizeFact(f));
      const { facts } = dedupeFacts(normalizedFacts);
      return { facts, mtime };
    }
    return { facts: [], mtime: -1 };
  } catch (error: any) {
    // A corrupt file is never reset silently: preserve bytes with a recoverable backup name.
    if (fs.existsSync(filePath)) {
      const backup = `${filePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(filePath, backup);
        logSink.warn(
          `Shared memory file was corrupt (${filePath}); backed up to ${backup}. No memory lost silently — inspect the backup.`
        );
      } catch (renameError: any) {
        logSink.error(`Could not back up corrupt shared memory (${filePath}): ${renameError.message}`);
      }
    }
    logSink.error(`Error reading shared memory (${filePath}): ${error.message}. Starting with empty memory.`);
    return { facts: [], mtime: -1 };
  }
}

/**
 * Atomically writes memory facts to disk via sibling temporary file.
 */
export function atomicSaveJsonMemoryFile(filePath: string, facts: MemoryFact[]): number {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: MemoryFilePayload = { facts };
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return fs.statSync(filePath).mtimeMs;
  } catch (error: any) {
    logSink.error(`Error saving shared memory: ${error.message}`);
    return -1;
  }
}
