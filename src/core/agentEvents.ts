/**
 * Events emitted by the agentic loop (Agent.run) towards the presentation layer.
 * The core does not print directly: the caller invoking the agent decides
 * how to display tool calls, intermediate rounds, and safety stops.
 */

export type AgentEvent =
  | { type: 'tool_start'; name: string; args: any; agentLabel?: string }
  | { type: 'tool_end'; name: string; args: any; success: boolean; output: string; agentLabel?: string }
  | { type: 'subagent_start'; name: string; role: string; task: string; agentLabel?: string }
  | { type: 'subagent_end'; name: string; success: boolean; output?: string; agentLabel?: string }
  | { type: 'round_continue'; round: number; agentLabel?: string }
  | { type: 'max_rounds'; limit: number; agentLabel?: string };

export type AgentEventHandler = (ev: AgentEvent) => void;
