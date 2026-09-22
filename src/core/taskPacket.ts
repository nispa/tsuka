/**
 * Minimal task handoff contract (T22.5).
 *
 * Encapsulates the minimal self-contained briefing required to launch a sub-agent
 * with a fresh context window: objective, optional constraints, and optional
 * acceptance criteria.
 *
 * Design Invariants:
 * - Isolated: no conversation history, memory dump, parent prompt, reasoning trace,
 *   or tool history is included.
 * - Runtime-bounded: strictly enforces character and count ceilings from constants.ts.
 * - Explicit: constructed only from explicit data already available at call time;
 *   no re-reading of conversation history or secondary LLM inference.
 * - Free of workflow bookkeeping: runId, parent/child IDs, depth, and delegation
 *   counters belong to the workflow scope or Agent.run() state, not the task packet.
 */

import { TASK_PACKET_DEFAULTS } from './constants';

export interface TaskPacket {
  objective: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
}

/**
 * Validates a candidate task packet, enforcing structural and boundary invariants.
 * Returns a clean, normalized TaskPacket.
 * Throws an Error on invalid inputs without silent mutation.
 */
export function validateTaskPacket(candidate: unknown): TaskPacket {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('TaskPacket must be a non-null object.');
  }

  const raw = candidate as Record<string, unknown>;

  if (typeof raw.objective !== 'string') {
    throw new Error('TaskPacket objective must be a string.');
  }

  const trimmedObjective = raw.objective.trim();
  if (trimmedObjective.length === 0) {
    throw new Error('TaskPacket objective cannot be empty.');
  }

  if (trimmedObjective.length > TASK_PACKET_DEFAULTS.maxObjectiveChars) {
    throw new Error(
      `TaskPacket objective exceeds maximum length of ${TASK_PACKET_DEFAULTS.maxObjectiveChars} characters (received ${trimmedObjective.length}).`
    );
  }

  let normalizedConstraints: string[] | undefined;
  if (raw.constraints !== undefined) {
    if (!Array.isArray(raw.constraints)) {
      throw new Error('TaskPacket constraints must be an array of strings when provided.');
    }
    if (raw.constraints.length > TASK_PACKET_DEFAULTS.maxConstraints) {
      throw new Error(
        `TaskPacket constraints count exceeds maximum of ${TASK_PACKET_DEFAULTS.maxConstraints} (received ${raw.constraints.length}).`
      );
    }
    const constraints: string[] = [];
    for (let idx = 0; idx < raw.constraints.length; idx++) {
      if (!(idx in raw.constraints) || typeof raw.constraints[idx] !== 'string') {
        throw new Error(`TaskPacket constraint at index ${idx} must be a string.`);
      }
      const trimmed = raw.constraints[idx].trim();
      if (trimmed.length === 0) {
        throw new Error(`TaskPacket constraint at index ${idx} cannot be empty.`);
      }
      if (trimmed.length > TASK_PACKET_DEFAULTS.maxConstraintChars) {
        throw new Error(
          `TaskPacket constraint at index ${idx} exceeds maximum length of ${TASK_PACKET_DEFAULTS.maxConstraintChars} characters.`
        );
      }
      constraints.push(trimmed);
    }
    normalizedConstraints = constraints;
  }

  let normalizedCriteria: string[] | undefined;
  if (raw.acceptanceCriteria !== undefined) {
    if (!Array.isArray(raw.acceptanceCriteria)) {
      throw new Error('TaskPacket acceptanceCriteria must be an array of strings when provided.');
    }
    if (raw.acceptanceCriteria.length > TASK_PACKET_DEFAULTS.maxAcceptanceCriteria) {
      throw new Error(
        `TaskPacket acceptanceCriteria count exceeds maximum of ${TASK_PACKET_DEFAULTS.maxAcceptanceCriteria} (received ${raw.acceptanceCriteria.length}).`
      );
    }
    const criteria: string[] = [];
    for (let idx = 0; idx < raw.acceptanceCriteria.length; idx++) {
      if (!(idx in raw.acceptanceCriteria) || typeof raw.acceptanceCriteria[idx] !== 'string') {
        throw new Error(`TaskPacket acceptance criterion at index ${idx} must be a string.`);
      }
      const trimmed = raw.acceptanceCriteria[idx].trim();
      if (trimmed.length === 0) {
        throw new Error(`TaskPacket acceptance criterion at index ${idx} cannot be empty.`);
      }
      if (trimmed.length > TASK_PACKET_DEFAULTS.maxCriterionChars) {
        throw new Error(
          `TaskPacket acceptance criterion at index ${idx} exceeds maximum length of ${TASK_PACKET_DEFAULTS.maxCriterionChars} characters.`
        );
      }
      criteria.push(trimmed);
    }
    normalizedCriteria = criteria;
  }

  const result: TaskPacket = {
    objective: trimmedObjective,
  };

  if (normalizedConstraints && normalizedConstraints.length > 0) {
    result.constraints = normalizedConstraints;
  }

  if (normalizedCriteria && normalizedCriteria.length > 0) {
    result.acceptanceCriteria = normalizedCriteria;
  }

  return result;
}

/**
 * Creates and validates a TaskPacket from explicit caller arguments.
 */
export function createTaskPacket(
  objective: string,
  options?: {
    constraints?: string[];
    acceptanceCriteria?: string[];
  }
): TaskPacket {
  return validateTaskPacket({
    objective,
    constraints: options?.constraints,
    acceptanceCriteria: options?.acceptanceCriteria,
  });
}

/**
 * Deterministically formats a TaskPacket into a markdown briefing prompt for a child agent.
 * The briefing contains only objective, constraints, and criteria, with no history or metadata.
 */
export function formatTaskPacketBriefing(packet: TaskPacket): string {
  const validated = validateTaskPacket(packet);
  const sections: string[] = [`# Objective\n${validated.objective}`];

  if (validated.constraints && validated.constraints.length > 0) {
    sections.push(`# Constraints\n${validated.constraints.map((c) => `- ${c}`).join('\n')}`);
  }

  if (validated.acceptanceCriteria && validated.acceptanceCriteria.length > 0) {
    sections.push(`# Acceptance Criteria\n${validated.acceptanceCriteria.map((a) => `- ${a}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Serializes a TaskPacket to a deterministic, formatted JSON string.
 */
export function serializeTaskPacket(packet: TaskPacket): string {
  const validated = validateTaskPacket(packet);
  return JSON.stringify(validated, null, 2);
}

/**
 * Parses and validates a TaskPacket from a JSON string or unknown object.
 */
export function parseTaskPacket(raw: string | unknown): TaskPacket {
  if (typeof raw === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      throw new Error(`Failed to parse TaskPacket JSON: ${err.message}`);
    }
    return validateTaskPacket(parsed);
  }
  return validateTaskPacket(raw);
}
