import { Tool, ToolExecutionContext } from '../registry';
import { WorkflowScope } from '../../core/workflowScope';
import { handleTeam } from '../../cli/commands/team';
import { logSink } from '../../core/logSink';

export const requestTeamTool: Tool = {
  name: 'request_team',
  riskLevel: 'RESTRICTED',
  execute: async (args: { team_name?: string; task: string; reason?: string }, context?: ToolExecutionContext) => {
    const task = (args.task || '').trim();
    if (!task) {
      throw new Error("Parametro 'task' obbligatorio per convocare un team.");
    }

    // Freno anti-ricorsione (Depth Guard): mai consentire l'avvio di un /team dall'interno di un altro workflow
    if (WorkflowScope.isInsideWorkflow()) {
      throw new Error(
        `Richiesta rifiutata: Impossibile convocare un /team ricorsivo. Un workflow di tipo '${WorkflowScope.getCurrentType()}' (profondità: ${WorkflowScope.getDepth()}) è già in esecuzione.`
      );
    }

    const teamName = (args.team_name || '').trim();
    const reason = args.reason ? ` Motivo: ${args.reason}` : '';
    logSink.log(`\n🚀 [CONVOCAZIONE TEAM AUTORIZZATA DALL'UTENTE]${reason}`);

    if (context?.commandCtx) {
      await handleTeam(context.commandCtx, teamName, task);
      return `Workflow di team completato per il compito: "${task}".`;
    }

    return `Richiesta di convocazione team (${teamName || 'custom'}) accettata per il compito: "${task}".`;
  }
};
