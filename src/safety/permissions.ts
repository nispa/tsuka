export type RiskLevel = 'SAFE' | 'RESTRICTED' | 'DANGEROUS';

export interface PermissionPromptRequest {
  toolName: string;
  details: string;
  riskLevel: RiskLevel;
  requesterLabel?: string;
}

export type PermissionPromptHandler = (req: PermissionPromptRequest) => Promise<'yes' | 'no' | 'always'>;

export class PermissionManager {
  private allowAllWrite: boolean = false;
  private sudo = false;

  setSudo(enabled: boolean): void {
    this.sudo = enabled;
  }

  isSudo(): boolean {
    return this.sudo;
  }
  // Internal promise chain (T3.1): requests triggering interactive prompts
  // (RESTRICTED/DANGEROUS) are queued sequentially rather than colliding on stdin.
  private promptQueue: Promise<void> = Promise.resolve();
  private promptHandler?: PermissionPromptHandler;

  constructor(promptHandler?: PermissionPromptHandler) {
    this.promptHandler = promptHandler;
  }

  /** Sets a custom async UI handler for permission requests (e.g. for TUI/WebUI). */
  setPromptHandler(handler?: PermissionPromptHandler): void {
    this.promptHandler = handler;
  }

  /** Resets permission state for a new session. */
  resetSession(): void {
    this.allowAllWrite = false;
    this.sudo = false;
  }

  /**
   * Toggles auto-approval of file modifications/writes (RESTRICTED).
   * Useful for autonomous /goal or /team workflows within the workspace jail.
   */
  setAllowAllWrite(allow: boolean): void {
    this.allowAllWrite = allow;
  }

  isAllowAllWrite(): boolean {
    return this.allowAllWrite;
  }

  /**
   * Enqueues `task` after any ongoing interactive prompt.
   * Ensures prompt order is preserved and subsequent requests are not blocked by a single rejection.
   */
  private enqueuePrompt<T>(task: () => Promise<T>): Promise<T> {
    const result = this.promptQueue.then(task, task);
    this.promptQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Verifies if the agent has permission to execute a tool.
   * @param toolName Name of requested tool
   * @param details Operation details (e.g. target path or command)
   * @param riskLevel Risk classification of tool
   * @param requesterLabel Requesting agent label displayed in interactive prompts
   * @returns Boolean indicating authorization
   */
  async checkPermission(toolName: string, details: string, riskLevel: RiskLevel, requesterLabel?: string): Promise<boolean> {
    if (riskLevel === 'SAFE') {
      return true;
    }
    return this.enqueuePrompt(() => this.promptForDecision(toolName, details, riskLevel, requesterLabel));
  }

  private async promptForDecision(toolName: string, details: string, riskLevel: RiskLevel, requesterLabel?: string): Promise<boolean> {
    // Evaluate at dequeue time so revocation also affects waiting commands.
    if (this.sudo && toolName === 'execute_command') return true;

    if (riskLevel === 'RESTRICTED') {
      if (this.allowAllWrite) {
        return true;
      }

      if (!this.promptHandler) return false;
      const decision = await this.promptHandler({ toolName, details, riskLevel, requesterLabel });
      if (decision === 'yes') return true;
      if (decision === 'always') {
        this.allowAllWrite = true;
        return true;
      }
      return false;
    }

    if (riskLevel === 'DANGEROUS') {
      if (!this.promptHandler) return false;
      const decision = await this.promptHandler({ toolName, details, riskLevel, requesterLabel });
      return decision === 'yes' || decision === 'always';
    }

    return false;
  }
}
