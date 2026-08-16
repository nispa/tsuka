import { Tool } from '../registry';

/**
 * Protocol tool (T2.1): used by team orchestrator in 'orchestrated' mode
 * to route the next turn to a specific agent (@name) or finish (FINE).
 */
export const routeNextTool: Tool = {
  name: 'route_next',
  riskLevel: 'SAFE',
  execute: async (args: { agent: string; reason: string }) => {
    const agent = (args.agent || '').trim();
    if (!agent) {
      throw new Error("Please specify 'agent': next member (@name) or 'FINE'.");
    }
    const reason = (args.reason || '').trim();
    if (!reason) {
      throw new Error("Please specify 'reason': rationale for routing decision.");
    }
    return `Routing decision recorded for: ${agent}.`;
  }
};
