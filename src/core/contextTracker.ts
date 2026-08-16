import { ConfigManager } from './config';

/**
 * ContextEntry represents an execution log point recording agent activity,
 * timestamps, output tokens generated, prompt tokens consumed, and the action performed.
 */
export interface ContextEntry {
  timestamp: string;
  agentName: string;
  tokenCount: number;
  promptTokens: number;
  action: string;
}

/**
 * Default maximum number of entries preserved in the in-memory activity ring buffer.
 * Keeps memory bounded while retaining enough context history for `/context` inspections.
 */
export const DEFAULT_CONTEXT_TRACKER_MAX_ENTRIES = 100;

/**
 * ContextTracker is a singleton in-memory ring buffer that records agent operations,
 * token consumption metrics, and duration across turns in single-agent and multi-agent workflows.
 *
 * Why it bounds entries:
 * Without bounding, long-running interactive sessions with hundreds of tool rounds
 * would continually accumulate historical entries in heap memory. Bounding to `maxEntries`
 * ensures constant O(1) memory overhead while maintaining recent operational visibility.
 */
export class ContextTracker {
  private static instance: ContextTracker | null = null;
  private entries: ContextEntry[] = [];
  private maxEntries: number = DEFAULT_CONTEXT_TRACKER_MAX_ENTRIES;

  constructor(maxEntries?: number) {
    if (typeof maxEntries === 'number' && maxEntries >= 10) {
      this.maxEntries = Math.floor(maxEntries);
    } else {
      try {
        this.maxEntries = new ConfigManager().getContextTrackerMaxEntries();
      } catch {
        this.maxEntries = DEFAULT_CONTEXT_TRACKER_MAX_ENTRIES;
      }
    }
  }

  static getInstance(): ContextTracker {
    if (!ContextTracker.instance) {
      ContextTracker.instance = new ContextTracker();
    }
    return ContextTracker.instance;
  }

  /**
   * Sets the maximum entry capacity for the ring buffer.
   */
  setMaxEntries(limit: number): void {
    if (typeof limit === 'number' && limit >= 10) {
      this.maxEntries = Math.floor(limit);
      while (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }
    }
  }

  /**
   * Returns current maximum entry capacity.
   */
  getMaxEntries(): number {
    return this.maxEntries;
  }

  /**
   * Adds a new activity record to the tracker, evicting the oldest record if exceeding capacity.
   */
  addEntry(entry: ContextEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /**
   * Retrieves the most recent activity records up to `limit` entries.
   */
  getRecent(limit: number = 20): ContextEntry[] {
    return [...this.entries].reverse().slice(0, limit);
  }

  /**
   * Returns all stored records in chronological order.
   */
  getAll(): ContextEntry[] {
    return [...this.entries];
  }

  /**
   * Clears all recorded entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Calculates total output tokens across all entries currently stored.
   */
  totalTokens(): number {
    return this.entries.reduce((sum, e) => sum + e.tokenCount, 0);
  }
}
