/**
 * Eventi emessi dal ciclo agentico (Agent.run) verso il layer di presentazione.
 * Il core non stampa più direttamente: chi invoca l'agente decide come
 * visualizzare tool call, round intermedi e interruzioni di sicurezza.
 */

export type AgentEvent =
  | { type: 'tool_start'; name: string; args: any }
  | { type: 'tool_end'; name: string; args: any; success: boolean; output: string }
  | { type: 'round_continue'; round: number }
  | { type: 'max_rounds'; limit: number };

export type AgentEventHandler = (ev: AgentEvent) => void;
