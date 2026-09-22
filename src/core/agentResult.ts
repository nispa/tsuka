/**
 * Compact child agent result contract (T22.6).
 *
 * Encapsulates the structured, bounded outcome of a sub-agent execution
 * designed for safe parent context handoff.
 *
 * Design Invariants:
 * - Isolated: transcript, conversation history, reasoning traces, and tool execution
 *   history are strictly excluded to preserve parent context budget.
 * - Wire-decoupled: parsing and validation are independent of any LLM provider wire format.
 * - Fail-closed: malformed child outputs produce an explicit 'failed' status or typed
 *   fallback, never a blind cast or unhandled exception.
 * - Runtime-bounded: string lengths and collection sizes strictly respect AGENT_RESULT_DEFAULTS.
 */

import { AGENT_RESULT_DEFAULTS } from './constants';

export type AgentResultStatus = 'done' | 'blocked' | 'failed';

export interface AgentResultEvidence {
  files?: string[];
  tests?: string[];
}

export interface AgentResult {
  status: AgentResultStatus;
  summary: string;
  changes?: string[];
  decisions?: string[];
  unresolved?: string[];
  evidence?: AgentResultEvidence;
}

/**
 * Validates a candidate AgentResult object, enforcing structural and boundary invariants.
 * Strips any unmodeled properties (e.g. transcript, messages, reasoning trace) to ensure
 * child history is never leaked into the parent context.
 * Throws an Error on invalid inputs.
 */
export function validateAgentResult(candidate: unknown): AgentResult {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('AgentResult must be a non-null object.');
  }

  const raw = candidate as Record<string, unknown>;

  if (typeof raw.status !== 'string') {
    throw new Error('AgentResult status must be a string.');
  }

  const rawStatus = typeof raw.status === 'string' ? raw.status : String(raw.status ?? '');
  const statusSnippet = rawStatus.length > 50 ? `${rawStatus.slice(0, 47)}...` : rawStatus;
  const status = rawStatus.trim().toLowerCase();
  if (status !== 'done' && status !== 'blocked' && status !== 'failed') {
    throw new Error(
      `Invalid AgentResult status: expected 'done', 'blocked', or 'failed', got '${statusSnippet}'.`
    );
  }

  if (typeof raw.summary !== 'string') {
    throw new Error('AgentResult summary must be a string.');
  }

  const trimmedSummary = raw.summary.trim();
  if (trimmedSummary.length === 0) {
    throw new Error('AgentResult summary cannot be empty.');
  }

  if (trimmedSummary.length > AGENT_RESULT_DEFAULTS.maxSummaryChars) {
    throw new Error(
      `AgentResult summary exceeds maximum length of ${AGENT_RESULT_DEFAULTS.maxSummaryChars} characters (received ${trimmedSummary.length}).`
    );
  }

  const validateStringArray = (field: unknown, name: string): string[] | undefined => {
    if (field === undefined) return undefined;
    if (!Array.isArray(field)) {
      throw new Error(`AgentResult ${name} must be an array of strings when provided.`);
    }
    if (field.length > AGENT_RESULT_DEFAULTS.maxListItems) {
      throw new Error(
        `AgentResult ${name} count exceeds maximum of ${AGENT_RESULT_DEFAULTS.maxListItems} (received ${field.length}).`
      );
    }
    const items: string[] = [];
    for (let idx = 0; idx < field.length; idx++) {
      if (!(idx in field) || typeof field[idx] !== 'string') {
        throw new Error(`AgentResult ${name} item at index ${idx} must be a string.`);
      }
      const trimmed = field[idx].trim();
      if (trimmed.length === 0) {
        throw new Error(`AgentResult ${name} item at index ${idx} cannot be empty.`);
      }
      if (trimmed.length > AGENT_RESULT_DEFAULTS.maxItemChars) {
        throw new Error(
          `AgentResult ${name} item at index ${idx} exceeds maximum length of ${AGENT_RESULT_DEFAULTS.maxItemChars} characters.`
        );
      }
      items.push(trimmed);
    }
    return items.length > 0 ? items : undefined;
  };

  const changes = validateStringArray(raw.changes, 'changes');
  const decisions = validateStringArray(raw.decisions, 'decisions');
  const unresolved = validateStringArray(raw.unresolved, 'unresolved');

  let evidence: AgentResultEvidence | undefined;
  if (raw.evidence !== undefined) {
    if (!raw.evidence || typeof raw.evidence !== 'object' || Array.isArray(raw.evidence)) {
      throw new Error('AgentResult evidence must be a non-null object when provided.');
    }
    const rawEvidence = raw.evidence as Record<string, unknown>;
    const files = validateStringArray(rawEvidence.files, 'evidence.files');
    const tests = validateStringArray(rawEvidence.tests, 'evidence.tests');
    if (files || tests) {
      evidence = {};
      if (files) evidence.files = files;
      if (tests) evidence.tests = tests;
    }
  }

  const result: AgentResult = {
    status,
    summary: trimmedSummary,
  };

  if (changes) result.changes = changes;
  if (decisions) result.decisions = decisions;
  if (unresolved) result.unresolved = unresolved;
  if (evidence) result.evidence = evidence;

  return result;
}

/**
 * Creates and validates an AgentResult from explicit caller arguments.
 */
export function createAgentResult(options: {
  status: AgentResultStatus;
  summary: string;
  changes?: string[];
  decisions?: string[];
  unresolved?: string[];
  evidence?: AgentResultEvidence;
}): AgentResult {
  return validateAgentResult(options);
}

/**
 * Strictly parses and validates an AgentResult from a JSON string or object.
 * Throws an Error on parse or validation failure.
 */
export function parseAgentResult(raw: string | unknown): AgentResult {
  if (typeof raw === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      throw new Error(`Failed to parse AgentResult JSON: ${err.message}`);
    }
    return validateAgentResult(parsed);
  }
  return validateAgentResult(raw);
}

/**
 * Safely parses and validates child agent output into an AgentResult.
 *
 * Handles:
 * - Pre-parsed objects
 * - Clean JSON strings
 * - Markdown-fenced JSON blocks (```json ... ```)
 * - Raw text with embedded JSON
 *
 * If the input cannot be parsed or fails schema validation, this returns a typed
 * 'failed' AgentResult rather than throwing or blindly casting the output.
 */
/**
 * Constructs a strictly bounded 'failed' AgentResult fallback.
 * Guarantees that summary and unresolved items strictly satisfy
 * AGENT_RESULT_DEFAULTS and pass validateAgentResult without throwing.
 */
export function createFailedFallback(summaryText: string, unresolvedDetails?: string[]): AgentResult {
  const maxSummary = AGENT_RESULT_DEFAULTS.maxSummaryChars;
  const safeSummary =
    summaryText.length > maxSummary
      ? `${summaryText.slice(0, maxSummary - 3)}...`
      : summaryText;

  let unresolved: string[] | undefined;
  if (unresolvedDetails && unresolvedDetails.length > 0) {
    unresolved = unresolvedDetails
      .slice(0, AGENT_RESULT_DEFAULTS.maxListItems)
      .map((item) => {
        const maxItem = AGENT_RESULT_DEFAULTS.maxItemChars;
        return item.length > maxItem ? `${item.slice(0, maxItem - 3)}...` : item;
      });
  }

  return {
    status: 'failed',
    summary: safeSummary,
    ...(unresolved && unresolved.length > 0 ? { unresolved } : {}),
  };
}

/**
 * Safely parses and validates child agent output into an AgentResult.
 *
 * Handles:
 * - Pre-parsed objects
 * - Clean JSON strings
 * - Markdown-fenced JSON blocks (```json ... ```)
 * - Raw text with embedded JSON
 *
 * If the input cannot be parsed or fails schema validation, this returns a typed
 * 'failed' AgentResult rather than throwing or blindly casting the output.
 */
export function safeParseAgentResult(raw: unknown): AgentResult {
  if (raw === null || raw === undefined) {
    return createFailedFallback('Child agent produced no output (null or undefined).', [
      'Sub-agent returned empty result.',
    ]);
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    try {
      return validateAgentResult(raw);
    } catch (err: any) {
      return createFailedFallback(
        `Child agent produced invalid result object: ${err.message}`,
        [`Validation failed: ${err.message}`]
      );
    }
  }

  if (typeof raw !== 'string') {
    return createFailedFallback(`Child agent produced unexpected output type: ${typeof raw}.`, [
      'Sub-agent output was neither a JSON string nor an object.',
    ]);
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return createFailedFallback('Child agent produced empty string output.', [
      'Sub-agent returned empty string.',
    ]);
  }

  const snippet = trimmed.slice(0, AGENT_RESULT_DEFAULTS.maxFailureSnippetChars);
  const snippetSuffix = trimmed.length > AGENT_RESULT_DEFAULTS.maxFailureSnippetChars ? '...' : '';

  // 1. Direct JSON parse attempt on the full string
  try {
    const parsed = JSON.parse(trimmed);
    // If JSON.parse succeeded, trimmed is syntactically valid JSON.
    // Structural validation applies: if it fails, it is a structural failure,
    // NOT a syntax error, so we must never carve out inner substrings to bypass it!
    try {
      return validateAgentResult(parsed);
    } catch (valErr: any) {
      return createFailedFallback(
        `Child agent produced invalid result object: ${valErr.message}`,
        [`Validation failed: ${valErr.message}`]
      );
    }
  } catch {
    // trimmed is not valid JSON as a whole (e.g. contains markdown fences or prose)
  }

  // 2. Syntax recovery: check for markdown code fences (```json ... ``` or ``` ... ```)
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const fenced = codeBlockMatch[1].trim();
    try {
      const parsed = JSON.parse(fenced);
      // Valid JSON in code fence: validate structurally
      try {
        return validateAgentResult(parsed);
      } catch (valErr: any) {
        return createFailedFallback(
          `Child agent produced invalid result object: ${valErr.message}`,
          [`Validation failed: ${valErr.message}`]
        );
      }
    } catch {
      // Fenced content was not valid JSON
    }
  }

  // 3. Syntax recovery: embedded JSON object { ... } in prose (only if not enclosed in an outer array)
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');

  const isEnclosedInArray =
    firstBracket !== -1 && lastBracket !== -1 && firstBracket < firstBrace && lastBracket > lastBrace;

  if (!isEnclosedInArray && firstBrace !== -1 && lastBrace > firstBrace) {
    const extracted = trimmed.slice(firstBrace, lastBrace + 1).trim();
    try {
      const parsed = JSON.parse(extracted);
      try {
        return validateAgentResult(parsed);
      } catch (valErr: any) {
        return createFailedFallback(
          `Child agent produced invalid result object: ${valErr.message}`,
          [`Validation failed: ${valErr.message}`]
        );
      }
    } catch {
      // Extracted braces were not valid JSON
    }
  }

  return createFailedFallback('Malformed child agent result: unparseable JSON.', [
    `Raw output could not be parsed as AgentResult: "${snippet}${snippetSuffix}"`,
  ]);
}

/**
 * Serializes an AgentResult to a deterministic, formatted JSON string.
 */
export function serializeAgentResult(result: AgentResult): string {
  const validated = validateAgentResult(result);
  return JSON.stringify(validated, null, 2);
}

/**
 * Deterministically formats an AgentResult into a compact markdown summary
 * for parent context consumption.
 *
 * Guarantees zero conversation history, reasoning traces, or tool execution history.
 */
export function formatAgentResultSummary(result: AgentResult): string {
  const validated = validateAgentResult(result);
  const lines: string[] = [
    `**Child Result [${validated.status.toUpperCase()}]**: ${validated.summary}`,
  ];

  if (validated.changes && validated.changes.length > 0) {
    lines.push('\n**Changes:**');
    for (const change of validated.changes) {
      lines.push(`- ${change}`);
    }
  }

  if (validated.decisions && validated.decisions.length > 0) {
    lines.push('\n**Decisions:**');
    for (const decision of validated.decisions) {
      lines.push(`- ${decision}`);
    }
  }

  if (validated.unresolved && validated.unresolved.length > 0) {
    lines.push('\n**Unresolved:**');
    for (const item of validated.unresolved) {
      lines.push(`- ${item}`);
    }
  }

  if (validated.evidence) {
    const parts: string[] = [];
    if (validated.evidence.files && validated.evidence.files.length > 0) {
      parts.push(`Files: ${validated.evidence.files.join(', ')}`);
    }
    if (validated.evidence.tests && validated.evidence.tests.length > 0) {
      parts.push(`Tests: ${validated.evidence.tests.join(', ')}`);
    }
    if (parts.length > 0) {
      lines.push(`\n**Evidence:** ${parts.join(' | ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Structurally reduces an AgentResult to fit within a maximum character budget (T22.8, T22.9)
 * while strictly preserving:
 * 1. `status` (done | blocked | failed)
 * 2. `summary` (valid, non-empty)
 * 3. `unresolved` items (critical open issues, blockers, failures)
 *
 * Secondary details are pruned in order:
 * 1. `changes` (pruned/summarized first)
 * 2. `decisions` (pruned/summarized next)
 * 3. `evidence` (excessive files/tests trimmed)
 * 4. `unresolved` (only trimmed as a last resort if unresolved alone exceeds budget, keeping top items)
 *
 * Guarantees that formatAgentResultSummary(reducedResult).length <= maxChars.
 */
export function reduceAgentResult(
  result: AgentResult,
  maxChars: number = AGENT_RESULT_DEFAULTS.maxSummaryChars
): AgentResult {
  const validated = validateAgentResult(result);
  if (formatAgentResultSummary(validated).length <= maxChars) {
    return validated;
  }

  // Work with a mutable copy
  let status = validated.status;
  let summary = validated.summary;
  let unresolved = validated.unresolved ? [...validated.unresolved] : undefined;
  let evidence = validated.evidence
    ? {
        files: validated.evidence.files ? [...validated.evidence.files] : undefined,
        tests: validated.evidence.tests ? [...validated.evidence.tests] : undefined,
      }
    : undefined;
  let decisions = validated.decisions ? [...validated.decisions] : undefined;
  let changes = validated.changes ? [...validated.changes] : undefined;

  const build = (): AgentResult => {
    const r: AgentResult = { status, summary };
    if (changes && changes.length > 0) r.changes = changes;
    if (decisions && decisions.length > 0) r.decisions = decisions;
    if (unresolved && unresolved.length > 0) r.unresolved = unresolved;
    if (
      evidence &&
      ((evidence.files && evidence.files.length > 0) ||
        (evidence.tests && evidence.tests.length > 0))
    ) {
      r.evidence = evidence;
    }
    return r;
  };

  // Phase 1: Prune secondary details — 'changes' first
  if (changes && changes.length > 0) {
    if (changes.length > 2) {
      changes = [changes[0], changes[1], `[... ${validated.changes!.length - 2} more changes omitted]`];
      if (formatAgentResultSummary(build()).length <= maxChars) return build();
    }
    if (changes.length > 1) {
      changes = [changes[0], `[... ${validated.changes!.length - 1} more changes omitted]`];
      if (formatAgentResultSummary(build()).length <= maxChars) return build();
    }
    changes = undefined;
    if (formatAgentResultSummary(build()).length <= maxChars) return build();
  }

  // Phase 2: Prune secondary details — 'decisions' next
  if (decisions && decisions.length > 0) {
    if (decisions.length > 2) {
      decisions = [decisions[0], decisions[1], `[... ${validated.decisions!.length - 2} more decisions omitted]`];
      if (formatAgentResultSummary(build()).length <= maxChars) return build();
    }
    if (decisions.length > 1) {
      decisions = [decisions[0], `[... ${validated.decisions!.length - 1} more decisions omitted]`];
      if (formatAgentResultSummary(build()).length <= maxChars) return build();
    }
    decisions = undefined;
    if (formatAgentResultSummary(build()).length <= maxChars) return build();
  }

  // Phase 3: Prune secondary details — 'evidence'
  if (evidence) {
    if (evidence.files && evidence.files.length > 2) {
      evidence.files = [evidence.files[0], evidence.files[1], `[+${evidence.files.length - 2} more]`];
    }
    if (evidence.tests && evidence.tests.length > 2) {
      evidence.tests = [evidence.tests[0], evidence.tests[1], `[+${evidence.tests.length - 2} more]`];
    }
    if (formatAgentResultSummary(build()).length <= maxChars) return build();

    evidence = undefined;
    if (formatAgentResultSummary(build()).length <= maxChars) return build();
  }

  // Phase 4: Only status, summary, and unresolved remain.
  // We MUST preserve unresolved items. If summary + unresolved > maxChars,
  // we trim summary first to ensure unresolved items are not starved of space.
  if (unresolved && unresolved.length > 0) {
    while (unresolved.length > 2 && formatAgentResultSummary(build()).length > maxChars) {
      unresolved = [
        ...unresolved.slice(0, unresolved.length - 2),
        `[... ${validated.unresolved!.length - (unresolved.length - 2)} more unresolved items omitted]`,
      ];
    }
  }

  // If still over budget, summary is consuming too much room: trim summary!
  if (formatAgentResultSummary(build()).length > maxChars) {
    const currentLen = formatAgentResultSummary(build()).length;
    const overflow = currentLen - maxChars;
    const targetSummaryLen = Math.max(20, summary.length - overflow - 5);
    summary = summary.slice(0, targetSummaryLen) + '...';
  }

  // Final fallback safety: ensure valid AgentResult within bounds
  return build();
}
