import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';

/**
 * Run Blackboard (T6.2): non-persistent shared state for a SINGLE `/team` or `/goal` run.
 * Clear boundaries between the 3 layers of state:
 *  - **history** = conversation log (`teamMessages`, shared across members and rounds);
 *  - **memory** = long-term cross-session facts (`MemoryStore`, `memory/memory.json`);
 *  - **blackboard** = ephemeral state of THIS specific run (decisions made, artifacts created,
 *    open items). Dies with the run: never written to `MemoryStore`, only exported as a `snapshot()`
 *    in workflow execution logs (see `workflowLog.ts`).
 *
 * Concurrency isolation:
 * Uses `AsyncLocalStorage` so that the `runId` travels in the async execution context,
 * ensuring concurrent runs in the same Node.js process do not collide.
 * Branches within a PARALLEL block of the same run share the same blackboard.
 */

export interface BlackboardNote {
  /** Short key chosen by the author (e.g. 'db-decision', 'file-created'). Not unique; duplicate keys append. */
  key: string;
  value: string;
  /** Author name (e.g. character aiName, or 'agent'). */
  author: string;
  timestamp: string; // ISO 8601
}

// Map of active Blackboards keyed by runId, cleaned up when endRun() is called.
const runs = new Map<string, Blackboard>();

const currentRunId = new AsyncLocalStorage<string>();

export class Blackboard {
  readonly runId: string;
  private notes: BlackboardNote[] = [];

  private constructor(runId: string) {
    this.runId = runId;
  }

  /** Generates a unique runId for a new /team or /goal workflow. */
  static newRunId(): string {
    return crypto.randomUUID();
  }

  /** Gets (or lazily creates) the blackboard for the specified runId. */
  static forRun(runId: string): Blackboard {
    let bb = runs.get(runId);
    if (!bb) {
      bb = new Blackboard(runId);
      runs.set(runId, bb);
    }
    return bb;
  }

  /**
   * Executes `fn` with `runId` set as the active blackboard context across its async closure.
   * Callers must clean up with `Blackboard.endRun(runId)` in a `finally` block.
   */
  static withRun<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    return currentRunId.run(runId, fn);
  }

  /** Returns the active run blackboard from AsyncLocalStorage, or null if outside a workflow. */
  static current(): Blackboard | null {
    const runId = currentRunId.getStore();
    return runId ? Blackboard.forRun(runId) : null;
  }

  /** Cleans up the blackboard for a completed run to avoid memory leaks. */
  static endRun(runId: string): void {
    runs.delete(runId);
  }

  /** Appends a note under the given key. */
  post(key: string, value: string, author: string): BlackboardNote {
    const note: BlackboardNote = { key, value, author, timestamp: new Date().toISOString() };
    this.notes.push(note);
    return note;
  }

  /** Returns notes in insertion order, optionally filtered by key prefix (case-insensitive). */
  read(prefix?: string): BlackboardNote[] {
    if (!prefix) return this.notes.slice();
    const needle = prefix.toLowerCase();
    return this.notes.filter((n) => n.key.toLowerCase().startsWith(needle));
  }

  /** Returns all notes in insertion order. */
  list(): BlackboardNote[] {
    return this.notes.slice();
  }

  /** Returns an immutable snapshot copy of all notes. */
  snapshot(): BlackboardNote[] {
    return this.notes.map((n) => ({ ...n }));
  }
}
