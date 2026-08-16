import { Tool, ToolExecutionContext } from '../registry';
import { WorkflowScope } from '../../core/workflowScope';
import { handleGoal } from '../../cli/commands/goal';
import { logSink } from '../../core/logSink';

export const requestGoalTool: Tool = {
  name: 'request_goal',
  riskLevel: 'RESTRICTED',
  execute: async (args: { goal: string; reason?: string }, context?: ToolExecutionContext) => {
    const goal = (args.goal || '').trim();
    if (!goal) {
      throw new Error("Parametro 'goal' obbligatorio per richiedere un workflow /goal.");
    }

    // Freno anti-ricorsione (Depth Guard): mai consentire l'avvio di un /goal dall'interno di un altro workflow
    if (WorkflowScope.isInsideWorkflow()) {
      throw new Error(
        `Richiesta rifiutata: Impossibile avviare un /goal ricorsivo. Un workflow di tipo '${WorkflowScope.getCurrentType()}' (profondità: ${WorkflowScope.getDepth()}) è già in esecuzione.`
      );
    }

    const reason = args.reason ? ` Motivo: ${args.reason}` : '';
    logSink.log(`\n🎯 [ESCALATION A /GOAL AUTORIZZATA DALL'UTENTE]${reason}`);

    if (context?.commandCtx) {
      await handleGoal(context.commandCtx, goal);
      return `Workflow /goal completato per l'obiettivo: "${goal}".`;
    }

    return `Richiesta di escalation /goal accettata per l'obiettivo: "${goal}".`;
  }
};
