/**
 * Application boundary used by escalation tools.
 *
 * Tools describe the workflow they need; the active frontend owns how that
 * workflow is presented and executed. This keeps command handlers out of the
 * tool layer without hiding dispatch in a global service locator.
 */
export interface WorkflowDispatcher {
  runGoal(goal: string): Promise<void>;
  runTeam(teamName: string, task: string): Promise<void>;
  runCall(participants: string[], topic: string): Promise<void>;
}
