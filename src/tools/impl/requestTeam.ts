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
      throw new Error("Parameter 'task' is required to convene a team.");
    }

    // Depth Guard anti-recursion check: prevent nested /team workflows
    if (WorkflowScope.isInsideWorkflow()) {
      throw new Error(
        `Request rejected: recursive /team is not permitted. A '${WorkflowScope.getCurrentType()}' workflow (depth: ${WorkflowScope.getDepth()}) is already active.`
      );
    }

    const teamName = (args.team_name || '').trim();
    const reason = args.reason ? ` Reason: ${args.reason}` : '';
    logSink.log(`\n🚀 [TEAM CONVENTION AUTHORIZED BY USER]${reason}`);

    if (context?.commandCtx) {
      await handleTeam(context.commandCtx, teamName, task);
      return `Team workflow completed for task: "${task}".`;
    }

    return `Team convention request (${teamName || 'custom'}) accepted for task: "${task}".`;
  }
};
