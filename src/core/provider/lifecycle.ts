/**
 * Owns the resources attached to one provider attempt.
 *
 * Timeout callbacks can outlive the request that triggered them while awaiting
 * an interactive decision. The active flag makes their continuation harmless
 * after cleanup, so a late "extend" cannot recreate a timer for a completed
 * attempt.
 */
export class ProviderAttemptLifecycle {
  private active = true;
  private firstTokenTimer: NodeJS.Timeout | undefined;
  private generationTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly signal: AbortSignal | undefined,
    private readonly onAbort: () => void,
  ) {
    if (!signal) return;
    signal.addEventListener('abort', onAbort, { once: true });
    // Cover an abort racing with listener registration.
    if (signal.aborted) onAbort();
  }

  isActive(): boolean {
    return this.active;
  }

  scheduleFirstToken(delayMs: number, callback: () => void | Promise<void>): void {
    this.clearFirstToken();
    if (!this.active) return;
    this.firstTokenTimer = setTimeout(() => {
      this.firstTokenTimer = undefined;
      if (this.active) void callback();
    }, delayMs);
  }

  scheduleGeneration(delayMs: number, callback: () => void | Promise<void>): void {
    this.clearGeneration();
    if (!this.active) return;
    this.generationTimer = setTimeout(() => {
      this.generationTimer = undefined;
      if (this.active) void callback();
    }, delayMs);
  }

  clearFirstToken(): void {
    if (!this.firstTokenTimer) return;
    clearTimeout(this.firstTokenTimer);
    this.firstTokenTimer = undefined;
  }

  clearGeneration(): void {
    if (!this.generationTimer) return;
    clearTimeout(this.generationTimer);
    this.generationTimer = undefined;
  }

  cleanup(): void {
    if (!this.active) return;
    this.active = false;
    this.clearFirstToken();
    this.clearGeneration();
    this.signal?.removeEventListener('abort', this.onAbort);
  }
}
