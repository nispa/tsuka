/**
 * Events emitted by the agentic loop (Agent.run) towards the presentation layer.
 * The core does not print directly: the caller invoking the agent decides
 * how to display tool calls, intermediate rounds, and safety stops.
 */

export type AgentEvent =
  | { type: 'tool_start'; name: string; args: any }
  | { type: 'tool_end'; name: string; args: any; success: boolean; output: string }
  | { type: 'round_continue'; round: number }
  | { type: 'max_rounds'; limit: number };

export type AgentEventHandler = (ev: AgentEvent) => void;
