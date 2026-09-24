import { ConfigManager } from './config';
import type { ContextPressure } from './types';

export type ContextMeasureSource = 'estimated' | 'observed';

/**
 * ContextEntry represents an execution log point recording agent activity,
 * timestamps, output tokens generated, prompt tokens consumed, the action performed,
 * and working-set context pressure metrics (T22.3).
 */
export interface ContextEntry {
  timestamp: string;
  agentName: string;
  tokenCount: number;
  promptTokens: number;
  peakPromptTokens?: number;
  action: string;
  usedTokens?: number;
  limitTokens?: number;
  ratio?: number;
  source?: ContextMeasureSource;
}

/**
 * Diagnostic metrics snapshot for autonomous context scheduling (T22.16).
 * Strictly contains quantitative indicators; no prompts, reasoning, or content.
 */
export interface ContextSchedulerMetrics {
  peakEstimatedPressure: number;
  lastObservedPressure: ContextPressure | null;
  prepareDecisions: number;
  delegateDecisions: number;
  delegationsAttempted: number;
  delegationsCompleted: number;
  delegationsBlocked: number;
  delegationsFailed: number;
  lastChildTokens: number;
  lastReturnedTokens: number;
  totalChildTokens: number;
  totalReturnedTokens: number;
  lastAgentResultChars: number;
  /**
   * Diagnostic ratio: child tokens consumed / tokens returned to parent.
   * Null when denominator is 0 (unambiguous, non-infinite).
   */
  contextAmplification: number | null;
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

  // Diagnostic metrics for context scheduling (T22.16)
  private peakEstimatedPressure: number = 0;
  private lastObservedPressure: ContextPressure | null = null;
  private prepareDecisions: number = 0;
  private delegateDecisions: number = 0;
  private delegationsAttempted: number = 0;
  private delegationsCompleted: number = 0;
  private delegationsBlocked: number = 0;
  private delegationsFailed: number = 0;
  private lastChildTokens: number = 0;
  private lastReturnedTokens: number = 0;
  private totalChildTokens: number = 0;
  private totalReturnedTokens: number = 0;
  private lastAgentResultChars: number = 0;

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
    if (entry.action?.startsWith('context_scheduler:') && typeof entry.ratio === 'number') {
      if (entry.source === 'observed') {
        this.recordObservedPressure({
          usedTokens: entry.usedTokens ?? entry.promptTokens ?? 0,
          limitTokens: entry.limitTokens ?? 0,
          remainingTokens: Math.max(0, (entry.limitTokens ?? 0) - (entry.usedTokens ?? entry.promptTokens ?? 0)),
          ratio: entry.ratio,
        });
      } else {
        this.recordEstimatedPressure(entry.ratio);
      }
    }
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  /**
   * Records an estimated context pressure ratio. Updates peak estimated pressure.
   */
  recordEstimatedPressure(ratio: number): void {
    if (typeof ratio === 'number' && !isNaN(ratio)) {
      this.peakEstimatedPressure = Math.max(this.peakEstimatedPressure, ratio);
    }
  }

  /**
   * Records observed pressure reported by the LLM provider prompt tokens.
   */
  recordObservedPressure(pressure: ContextPressure): void {
    if (pressure && typeof pressure.ratio === 'number') {
      this.lastObservedPressure = { ...pressure };
    }
  }

  /**
   * Records an autonomous scheduling decision ('prepare' or 'delegate').
   */
  recordDecision(action: 'prepare' | 'delegate'): void {
    if (action === 'prepare') {
      this.prepareDecisions++;
    } else if (action === 'delegate') {
      this.delegateDecisions++;
    }
  }

  /**
   * Records an initiation of an autonomous child agent delegation.
   */
  recordDelegationAttempt(): void {
    this.delegationsAttempted++;
  }

  /**
   * Records successful completion of child delegation and handoff accounting.
  /**
   * Records outcome of child delegation and handoff accounting (T22.16).
   * Distinguishes completed ('done'), blocked ('blocked'), and failed ('failed') outcomes.
   */
  recordDelegationResult(info: {
    status: 'done' | 'blocked' | 'failed';
    childTokens: number;
    returnedTokens: number;
    agentResultChars: number;
  }): void {
    if (info.status === 'done') {
      this.delegationsCompleted++;
    } else if (info.status === 'blocked') {
      this.delegationsBlocked++;
    } else if (info.status === 'failed') {
      this.delegationsFailed++;
    }
    this.lastChildTokens = Math.max(0, info.childTokens);
    this.lastReturnedTokens = Math.max(0, info.returnedTokens);
    this.lastAgentResultChars = Math.max(0, info.agentResultChars);
    this.totalChildTokens += this.lastChildTokens;
    this.totalReturnedTokens += this.lastReturnedTokens;
  }

  /**
   * Records successful completion of child delegation and handoff accounting.
   * Alias for recordDelegationResult({ status: 'done', ...info }).
   */
  recordDelegationSuccess(info: {
    childTokens: number;
    returnedTokens: number;
    agentResultChars: number;
  }): void {
    this.recordDelegationResult({ status: 'done', ...info });
  }

  /**
   * Records failure of an autonomous delegation attempt.
   */
  recordDelegationFailure(info?: {
    childTokens?: number;
    returnedTokens?: number;
    agentResultChars?: number;
  }): void {
    this.delegationsFailed++;
    if (info) {
      if (typeof info.childTokens === 'number') {
        this.lastChildTokens = Math.max(0, info.childTokens);
        this.totalChildTokens += this.lastChildTokens;
      }
      if (typeof info.returnedTokens === 'number') {
        this.lastReturnedTokens = Math.max(0, info.returnedTokens);
        this.totalReturnedTokens += this.lastReturnedTokens;
      }
      if (typeof info.agentResultChars === 'number') {
        this.lastAgentResultChars = Math.max(0, info.agentResultChars);
      }
    }
  }

  /**
   * Returns a snapshot of scheduler telemetry metrics (T22.16).
   */
  getSchedulerMetrics(): ContextSchedulerMetrics {
    const amplification =
      this.lastReturnedTokens > 0
        ? Number((this.lastChildTokens / this.lastReturnedTokens).toFixed(2))
        : null;

    return {
      peakEstimatedPressure: Number(this.peakEstimatedPressure.toFixed(4)),
      lastObservedPressure: this.lastObservedPressure ? { ...this.lastObservedPressure } : null,
      prepareDecisions: this.prepareDecisions,
      delegateDecisions: this.delegateDecisions,
      delegationsAttempted: this.delegationsAttempted,
      delegationsCompleted: this.delegationsCompleted,
      delegationsBlocked: this.delegationsBlocked,
      delegationsFailed: this.delegationsFailed,
      lastChildTokens: this.lastChildTokens,
      lastReturnedTokens: this.lastReturnedTokens,
      totalChildTokens: this.totalChildTokens,
      totalReturnedTokens: this.totalReturnedTokens,
      lastAgentResultChars: this.lastAgentResultChars,
      contextAmplification: amplification,
    };
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
   * Clears all recorded entries and resets scheduler metrics.
   */
  clear(): void {
    this.entries = [];
    this.peakEstimatedPressure = 0;
    this.lastObservedPressure = null;
    this.prepareDecisions = 0;
    this.delegateDecisions = 0;
    this.delegationsAttempted = 0;
    this.delegationsCompleted = 0;
    this.delegationsBlocked = 0;
    this.delegationsFailed = 0;
    this.lastChildTokens = 0;
    this.lastReturnedTokens = 0;
    this.totalChildTokens = 0;
    this.totalReturnedTokens = 0;
    this.lastAgentResultChars = 0;
  }

  /**
   * Calculates total output tokens across all entries currently stored.
   */
  totalTokens(): number {
    return this.entries.reduce((sum, e) => sum + e.tokenCount, 0);
  }
}
