import { AsyncLocalStorage } from 'async_hooks';

/**
 * Gestione dell'ambito di esecuzione del workflow (Depth Guard).
 * Traccia se l'agente sta lavorando nella chat diretta 1-to-1 con l'utente
 * (depth = 0) oppure all'interno di un workflow orchestrato /goal, /team o /call (depth >= 1).
 *
 * Utilizzato dai tool di escalation (request_goal, request_team, request_call)
 * come freno anti-ricorsione: impedisce che un agente all'interno di un goal/team
 * inneschi loop infiniti di escalation o sottoteam a cascata.
 */

export type WorkflowType = 'goal' | 'team' | 'call';

export interface WorkflowScopeInfo {
  type: WorkflowType;
  depth: number;
  id: string;
}

const scopeStorage = new AsyncLocalStorage<WorkflowScopeInfo>();

export class WorkflowScope {
  /**
   * Ritorna la profondità corrente del workflow (0 se chat normale).
   */
  static getDepth(): number {
    const info = scopeStorage.getStore();
    return info?.depth ?? 0;
  }

  /**
   * Ritorna true se l'esecuzione è all'interno di un workflow (/goal, /team, /call).
   */
  static isInsideWorkflow(): boolean {
    return WorkflowScope.getDepth() > 0;
  }

  /**
   * Ritorna il tipo di workflow attivo ('goal' | 'team' | 'call' | null).
   */
  static getCurrentType(): WorkflowType | null {
    const info = scopeStorage.getStore();
    return info?.type ?? null;
  }

  /**
   * Ritorna l'informazione completa sull'ambito corrente.
   */
  static getCurrentScope(): WorkflowScopeInfo | null {
    return scopeStorage.getStore() ?? null;
  }

  /**
   * Esegue una funzione asincrona all'interno di un contesto di workflow,
   * incrementando la profondità.
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
