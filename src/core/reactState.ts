import { ReasoningEffort } from './provider';

export interface ReActState {
  toolRounds: number;
  everCalledTool: boolean;
  noToolNudgeUsed: boolean;
  currentRoundEffortOverride?: ReasoningEffort;
  /** Consecutive validation error counter per tool name (T23.14). */
  consecutiveValidationErrors: Record<string, number>;
}

export function createReActState(reasoningEffortOverride?: ReasoningEffort): ReActState {
  return {
    toolRounds: 0,
    everCalledTool: false,
    noToolNudgeUsed: false,
    currentRoundEffortOverride: reasoningEffortOverride,
    consecutiveValidationErrors: {},
  };
}

export function markToolRound(state: ReActState): number {
  state.everCalledTool = true;
  state.toolRounds++;
  return state.toolRounds;
}

/**
 * Updates consecutive validation error counters for a tool call (T23.14).
 * Parameter validation errors increment the counter; any call with valid parameters
 * (whether successful or with an operational failure) resets the consecutive validation counter to 0.
 */
export function recordToolExecutionResult(
  state: ReActState,
  toolName: string,
  result: { success: boolean; isValidationError?: boolean }
): { consecutiveErrors: number } {
  if (result.isValidationError) {
    state.consecutiveValidationErrors[toolName] = (state.consecutiveValidationErrors[toolName] || 0) + 1;
  } else {
    state.consecutiveValidationErrors[toolName] = 0;
  }
  return { consecutiveErrors: state.consecutiveValidationErrors[toolName] || 0 };
}

/**
 * Evaluates a text-only provider response and returns the one allowed nudge.
 * After the nudge has been used, the next text response is accepted verbatim.
 */
export function evaluateTextResponse(
  state: ReActState,
  content: string,
  allowedTools: string[] | undefined,
  acceptTextOnlyIf?: (content: string) => boolean
): { accepted: boolean; nudge?: string } {
  if (state.everCalledTool || !acceptTextOnlyIf || acceptTextOnlyIf(content)) {
    return { accepted: true };
  }
  if (state.noToolNudgeUsed) return { accepted: true };

  state.noToolNudgeUsed = true;
  state.currentRoundEffortOverride = 'none';
  const closingHint = allowedTools?.includes('report_status')
    ? "call 'report_status' with the appropriate status to explicitly complete your turn"
    : 'write a clear summary of what you did (or why progress could not be made) to complete the turn';
  return {
    accepted: false,
    nudge: 'You did not call any tools in this response. If you were planning, ACT NOW: call the appropriate ' +
      'tool (e.g. write_file, edit_file, execute_command). If the task is already completed or cannot proceed further, ' +
      `${closingHint}.`,
  };
}
