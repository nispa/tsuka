import { Tool } from '../registry';
import { TURN_STATUSES } from '../../core/protocolTokens';

const VALID_STATUSES: readonly string[] = TURN_STATUSES;

/**
 * Protocol tool (T2.1): replaces free text "STATUS: ..." with a structured tool call.
 * strategies/common.ts reads tool_calls from turn history to determine outcome.
 */
export const reportStatusTool: Tool = {
  name: 'report_status',
  riskLevel: 'SAFE',
  execute: async (args: { status: string; summary: string; next_hint?: string }) => {
    const status = (args.status || '').trim().toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: '${args.status}'. Use one of: ${VALID_STATUSES.join(', ')}.`);
    }
    const summary = (args.summary || '').trim();
    if (!summary) {
      throw new Error("'summary' cannot be empty: describe what you achieved or what remains.");
    }
    return `Status recorded: ${status}.`;
  }
};
