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
      throw new Error("Parameter 'topic' is required to start a call.");
    }

    const participants = Array.isArray(args.participants) ? args.participants.map((p) => p.trim()).filter(Boolean) : [];
    if (participants.length < 2) {
      throw new Error("Specify at least 2 participants for the call (e.g. ['@spock', '@geordi']).");
    }

    // Depth Guard anti-recursion check: prevent nested /call workflows
    if (WorkflowScope.isInsideWorkflow()) {
      throw new Error(
        `Request rejected: recursive /call is not permitted. A '${WorkflowScope.getCurrentType()}' workflow (depth: ${WorkflowScope.getDepth()}) is already active.`
      );
    }

    const reason = args.reason ? ` Reason: ${args.reason}` : '';
    logSink.log(`\n📞 [CONFERENCE CALL AUTHORIZED BY USER]${reason}`);

    if (context?.commandCtx) {
      await handleCall(context.commandCtx, participants.join(' '), topic);
      return `Conference call finished between ${participants.join(', ')} on: "${topic}".`;
    }

    return `Conference call request between ${participants.join(', ')} accepted on: "${topic}".`;
  }
};
