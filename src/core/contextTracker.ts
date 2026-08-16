export interface ContextEntry {
  timestamp: string;
  agentName: string;
  tokenCount: number;
  promptTokens: number;
  action: string;
}

const MAX_ENTRIES = 100;

export class ContextTracker {
  private static instance: ContextTracker | null = null;
  private entries: ContextEntry[] = [];

  static getInstance(): ContextTracker {
    if (!ContextTracker.instance) {
      ContextTracker.instance = new ContextTracker();
    }
    return ContextTracker.instance;
  }

  addEntry(entry: ContextEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  getRecent(limit: number = 20): ContextEntry[] {
    return [...this.entries].reverse().slice(0, limit);
  }

  getAll(): ContextEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  /** Calculates total output tokens across all entries. */
  totalTokens(): number {
    return this.entries.reduce((sum, e) => sum + e.tokenCount, 0);
  }
}
