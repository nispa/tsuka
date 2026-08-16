import { Tool, ToolExecutionContext } from '../registry';
import { WorkflowScope } from '../../core/workflowScope';
import { handleCall } from '../../cli/commands/call';
import { logSink } from '../../core/logSink';

export const requestCallTool: Tool = {
  name: 'request_call',
  riskLevel: 'RESTRICTED',
  execute: async (args: { participants: string[]; topic: string; reason?: string }, context?: ToolExecutionContext) => {
    const topic = (args.topic || '').trim();
    if (!topic) {
      throw new Error("Parametro 'topic' obbligatorio per avviare una conferenza.");
    }

    const participants = Array.isArray(args.participants) ? args.participants.map((p) => p.trim()).filter(Boolean) : [];
    if (participants.length < 2) {
      throw new Error("Specificare almeno 2 partecipanti per la conferenza (es. ['@spock', '@geordi']).");
    }

    // Freno anti-ricorsione (Depth Guard): mai consentire l'avvio di una /call dall'interno di un altro workflow
    if (WorkflowScope.isInsideWorkflow()) {
      throw new Error(
        `Richiesta rifiutata: Impossibile avviare una /call ricorsiva. Un workflow di tipo '${WorkflowScope.getCurrentType()}' (profondità: ${WorkflowScope.getDepth()}) è già in esecuzione.`
      );
    }

    const reason = args.reason ? ` Motivo: ${args.reason}` : '';
    logSink.log(`\n📞 [CONFERENZA AUTORIZZATA DALL'UTENTE]${reason}`);

    if (context?.commandCtx) {
      await handleCall(context.commandCtx, participants.join(' '), topic);
      return `Conferenza conclusa tra ${participants.join(', ')} sul tema: "${topic}".`;
    }

    return `Richiesta di conferenza tra ${participants.join(', ')} accettata sul tema: "${topic}".`;
  }
};
