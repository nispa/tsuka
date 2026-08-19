/**
 * Self-isolation guard for the shared memory store (T14.15).
 *
 * `MemoryStore.getInstance()` resolves to the user's real `memory/memory.json` unless
 * `TSUKA_MEMORY_FILE` points somewhere else. `tests/run_tests.ts` sets that variable
 * before spawning each suite, so a full `npm test` is safe — but a suite launched on
 * its own (`npx tsx tests/test_memory.ts`, the documented way to debug one) inherits
 * nothing, writes to the real store, and `clear()` wipes the user's memory for good.
 * A comment warning about it is not a guard: it only works if you read it first.
 *
 * Importing this module FIRST in a suite makes the isolation structural. It is a no-op
 * when the runner already set the variable, so the two paths cannot disagree.
 *
 * Usage — must be the first import, before anything that can touch the singleton:
 *   import './isolateMemory';
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const existing = (process.env.TSUKA_MEMORY_FILE || '').trim();

if (existing.length === 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-suite-memory-'));
  process.env.TSUKA_MEMORY_FILE = path.join(dir, 'memory.json');

  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort: a leftover temp dir is harmless */
    }
  };
  process.on('exit', cleanup);
}

/** Absolute path of the memory file this process is allowed to write. */
export const isolatedMemoryFile = process.env.TSUKA_MEMORY_FILE as string;
