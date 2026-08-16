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
      throw new Error("Parameter 'goal' is required to request /goal escalation.");
    }

    // Depth Guard anti-recursion check: prevent nested /goal workflows
    if (WorkflowScope.isInsideWorkflow()) {
      throw new Error(
        `Request rejected: recursive /goal is not permitted. A '${WorkflowScope.getCurrentType()}' workflow (depth: ${WorkflowScope.getDepth()}) is already active.`
      );
    }

    const reason = args.reason ? ` Reason: ${args.reason}` : '';
    logSink.log(`\n🎯 [ESCALATION TO /GOAL AUTHORIZED BY USER]${reason}`);

    if (context?.commandCtx) {
      await handleGoal(context.commandCtx, goal);
      return `Workflow /goal completed for goal: "${goal}".`;
    }

    return `Escalation request to /goal accepted for: "${goal}".`;
  }
};
