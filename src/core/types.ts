/**
 * Tipi condivisi del layer di protocollo/orchestrazione multi-agente (T4.1,
 * PLANNING-QUALITA.md). Non è un tentativo di tipizzare tutto il repo: solo i
 * punti attraversati da agent.ts/provider.ts/team.ts/goal.ts per il coordinamento
 * — messaggi di chat, tool call, esito dei turni, configurazione team/piano.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Tool call nella forma restituita dalle API OpenAI-compatible (Function Calling). */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Messaggio di chat: stesso tipo attraversa Agent, ILLMProvider e le history di team/goal. */
export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** Esito di un turno di lavoro (membro di team, stazione di pipeline, step di goal). */
export type TurnOutcome = 'completed' | 'interrupted' | 'continue' | 'failed';

/**
 * Fonte della decisione di protocollo per un turno (T2.1): tool call strutturata
 * (report_status/route_next/cast_vote) → regex sul marker testuale (fallback
 * esplicito) → default (nessun segnale valido).
 */
export type ProtocolSource = 'tool_call' | 'regex' | 'fallback';

/** Voto espresso in un round di discussione con voting attivo. */
export type Vote = 'APPROVO' | 'MODIFICARE' | 'RIFIUTO';

import type { AcceptanceCriteria } from './loop';

/** Configurazione di un team caricata da teams/*.json. */
export interface TeamConfig {
  name: string;
  displayName: string;
  description: string;
  members: string[];
  orchestrator?: string;
  mode?: 'round-robin' | 'orchestrated' | 'pipeline';
  maxRoundsPerMember?: number;
  discussionRounds?: number;
  voting?: boolean;
  maxAttempts?: number;
  acceptance?: AcceptanceCriteria;
  stations?: Record<string, { acceptance?: AcceptanceCriteria; maxAttempts?: number }>;
}

/** Uno step del piano generato dal Goal Orchestrator (/goal). */
export interface PlanStep {
  agentName: string;
  task: string;
}

/** Configurazione di un personaggio caricata da characters/*.json. */
export interface CharacterConfig {
  name: string;
  displayName: string;
  aiName?: string;
  role?: string;        // Legacy (ruolo singolo)
  roles?: string[];     // Multi-Skill (elenco ruoli/skill sbloccate)
  activeRole?: string;  // Skill correntemente equipaggiata
  trait: string;
  description: string;
  reasoningEffort?: string;
}

