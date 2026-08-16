import { AsyncLocalStorage } from 'async_hooks';

/**
 * Workflow execution scope management (Depth Guard).
 * Tracks whether the agent is operating in direct 1-to-1 user chat (depth = 0)
 * or inside an orchestrated /goal, /team, or /call workflow (depth >= 1).
 *
 * Used by escalation tools (request_goal, request_team, request_call) as an
 * anti-recursion guard: prevents agents within a workflow from triggering
 * infinite loops of cascading escalations or subteams.
 */

export type WorkflowType = 'goal' | 'team' | 'call';

export interface WorkflowScopeInfo {
  type: WorkflowType;
  depth: number;
  id: string;
}

const scopeStorage = new AsyncLocalStorage<WorkflowScopeInfo>();

export class WorkflowScope {
  /** Returns the current workflow depth (0 for standard direct chat). */
  static getDepth(): number {
    const info = scopeStorage.getStore();
    return info?.depth ?? 0;
  }

  /** Returns true if execution is currently inside a workflow (/goal, /team, /call). */
  static isInsideWorkflow(): boolean {
    return WorkflowScope.getDepth() > 0;
  }

  /** Returns the active workflow type ('goal' | 'team' | 'call' | null). */
  static getCurrentType(): WorkflowType | null {
    const info = scopeStorage.getStore();
    return info?.type ?? null;
  }

  /** Returns full current scope information. */
  static getCurrentScope(): WorkflowScopeInfo | null {
    return scopeStorage.getStore() ?? null;
  }

  /**
   * Executes an asynchronous function within a workflow scope context,
   * incrementing the workflow depth.
   */
  static async withScope<T>(
    type: WorkflowType,
    fn: () => Promise<T>,
    id?: string
  ): Promise<T> {
    const parent = scopeStorage.getStore();
    const depth = (parent?.depth ?? 0) + 1;
    const scopeInfo: WorkflowScopeInfo = {
      type,
      depth,
      id: id || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    return scopeStorage.run(scopeInfo, fn);
  }
}
