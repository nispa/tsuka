/**
 * Test suite for compact child agent result contract (T22.6).
 *
 * Verifies:
 * - Structural invariants of AgentResult, AgentResultStatus, and AgentResultEvidence.
 * - Enforcing bounds from AGENT_RESULT_DEFAULTS (character lengths, list sizes).
 * - Dropping of extraneous child properties (transcript, messages, reasoning traces).
 * - Deterministic serialization and parsing.
 * - Safe fail-closed parsing of malformed/unstructured LLM outputs.
 * - Compact markdown formatting for parent context without child history.
 */

import {
  AgentResult,
  AgentResultStatus,
  createAgentResult,
  formatAgentResultSummary,
  parseAgentResult,
  safeParseAgentResult,
  serializeAgentResult,
  validateAgentResult,
} from '../src/core/agentResult';
import { AGENT_RESULT_DEFAULTS } from '../src/core/constants';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function assertThrows(fn: () => void, expectedMessagePart?: string): void {
  try {
    fn();
    failed++;
    console.error('FAIL: Expected function to throw, but it succeeded.');
  } catch (err: any) {
    if (expectedMessagePart && !err.message.includes(expectedMessagePart)) {
      failed++;
      console.error(
        `FAIL: Expected error message to include "${expectedMessagePart}", got "${err.message}".`
      );
    } else {
      passed++;
    }
  }
}

// 1. Structural validation and status types
console.log('--- 1. Structural Validation and Status Normalization ---');

const doneResult = validateAgentResult({
  status: 'done',
  summary: 'Refactored logger to use logSink.',
});
assert(doneResult.status === 'done', 'Accepts valid status "done"');
assert(doneResult.summary === 'Refactored logger to use logSink.', 'Preserves summary');
assert(doneResult.changes === undefined, 'Omits empty changes');

const blockedResult = validateAgentResult({
  status: 'BLOCKED',
  summary: 'Missing API key for external service.',
});
assert(blockedResult.status === 'blocked', 'Normalizes status case to lowercase');

const failedResult = validateAgentResult({
  status: 'failed',
  summary: 'Compilation errors in generated code.',
});
assert(failedResult.status === 'failed', 'Accepts valid status "failed"');

assertThrows(
  () => validateAgentResult(null),
  'AgentResult must be a non-null object'
);
assertThrows(
  () => validateAgentResult('done'),
  'AgentResult must be a non-null object'
);
assertThrows(
  () => validateAgentResult([]),
  'AgentResult must be a non-null object'
);
assertThrows(
  () => validateAgentResult({ status: 'in_progress', summary: 'Still working' }),
  "expected 'done', 'blocked', or 'failed'"
);
assertThrows(
  () => validateAgentResult({ status: 123, summary: 'Still working' }),
  'status must be a string'
);
assertThrows(
  () => validateAgentResult({ status: 'done', summary: '' }),
  'summary cannot be empty'
);
assertThrows(
  () => validateAgentResult({ status: 'done', summary: '   ' }),
  'summary cannot be empty'
);
assertThrows(
  () => validateAgentResult({ status: 'done' }),
  'summary must be a string'
);

// 2. Strict isolation: strips extraneous history and reasoning fields
console.log('--- 2. Strict Isolation and Leak Prevention ---');

const contaminatedInput = {
  status: 'done',
  summary: 'Completed isolated task.',
  transcript: ['step 1', 'step 2', 'step 3'],
  messages: [{ role: 'user', content: 'hello' }],
  reasoning: 'I thought about this deeply...',
  toolCalls: [{ tool: 'execute_command', args: { command: 'dir' } }],
  extraMetadata: { runId: 'run-123', childDepth: 2 },
};

const sanitized = validateAgentResult(contaminatedInput);
assert(
  !('transcript' in sanitized),
  'Strips transcript to prevent history leakage'
);
assert(!('messages' in sanitized), 'Strips messages array');
assert(!('reasoning' in sanitized), 'Strips reasoning traces');
assert(!('toolCalls' in sanitized), 'Strips tool calls');
assert(!('extraMetadata' in sanitized), 'Strips extra unmodeled metadata');
assert(
  Object.keys(sanitized).sort().join(',') === 'status,summary',
  'Result contains only modeled properties'
);

// 3. Bound enforcement from AGENT_RESULT_DEFAULTS
console.log('--- 3. Bound Enforcement ---');

const longSummary = 'a'.repeat(AGENT_RESULT_DEFAULTS.maxSummaryChars + 1);
assertThrows(
  () => validateAgentResult({ status: 'done', summary: longSummary }),
  'summary exceeds maximum length'
);

const maxSummary = 'a'.repeat(AGENT_RESULT_DEFAULTS.maxSummaryChars);
const maxResult = validateAgentResult({ status: 'done', summary: maxSummary });
assert(
  maxResult.summary.length === AGENT_RESULT_DEFAULTS.maxSummaryChars,
  'Accepts summary at exact boundary length'
);

// List bounds: item length
const longItem = 'x'.repeat(AGENT_RESULT_DEFAULTS.maxItemChars + 1);
assertThrows(
  () =>
    validateAgentResult({
      status: 'done',
      summary: 'Valid summary',
      changes: [longItem],
    }),
  'changes item at index 0 exceeds maximum length'
);

// List bounds: item count
const tooManyItems = Array.from(
  { length: AGENT_RESULT_DEFAULTS.maxListItems + 1 },
  (_, i) => `item ${i}`
);
assertThrows(
  () =>
    validateAgentResult({
      status: 'done',
      summary: 'Valid summary',
      decisions: tooManyItems,
    }),
  'decisions count exceeds maximum'
);

// Empty item in list
assertThrows(
  () =>
    validateAgentResult({
      status: 'done',
      summary: 'Valid summary',
      unresolved: ['  '],
    }),
  'unresolved item at index 0 cannot be empty'
);

// Sparse array checks (new Array(n))
assertThrows(
  () =>
    validateAgentResult({
      status: 'done',
      summary: 'Valid summary',
      changes: new Array(1),
    }),
  'changes item at index 0 must be a string'
);

assertThrows(
  () =>
    validateAgentResult({
      status: 'done',
      summary: 'Valid summary',
      decisions: new Array(2),
    }),
  'decisions item at index 0 must be a string'
);

assertThrows(
  () =>
    validateAgentResult({
      status: 'done',
      summary: 'Valid summary',
      unresolved: new Array(1),
    }),
  'unresolved item at index 0 must be a string'
);

assertThrows(
  () =>
    validateAgentResult({
      status: 'done',
      summary: 'Valid summary',
      evidence: { files: new Array(1) },
    }),
  'evidence.files item at index 0 must be a string'
);

// 4. Evidence validation
console.log('--- 4. Evidence Validation ---');

const withEvidence = validateAgentResult({
  status: 'done',
  summary: 'All checks passed',
  evidence: {
    files: ['src/core/agentResult.ts', 'src/core/constants.ts'],
    tests: ['tests/test_agent_result.ts'],
  },
});
assert(withEvidence.evidence !== undefined, 'Preserves valid evidence');
assert(
  withEvidence.evidence?.files?.length === 2,
  'Contains 2 evidence files'
);
assert(
  withEvidence.evidence?.tests?.length === 1,
  'Contains 1 evidence test'
);

// Empty evidence arrays normalize to undefined
const emptyEvidence = validateAgentResult({
  status: 'done',
  summary: 'No files modified',
  evidence: {
    files: [],
    tests: [],
  },
});
assert(
  emptyEvidence.evidence === undefined,
  'Normalizes empty evidence object to undefined'
);

// Non-object evidence
assertThrows(
  () =>
    validateAgentResult({
      status: 'done',
      summary: 'Valid',
      evidence: 'files.txt' as any,
    }),
  'evidence must be a non-null object'
);

// 5. createAgentResult helper
console.log('--- 5. createAgentResult Helper ---');

const created = createAgentResult({
  status: 'done',
  summary: 'Created via helper',
  changes: ['Added agentResult.ts'],
  decisions: ['Decoupled wire format'],
  unresolved: ['Need T22.7 runner'],
  evidence: { files: ['src/core/agentResult.ts'] },
});
assert(created.status === 'done', 'createAgentResult validates status');
assert(created.changes?.[0] === 'Added agentResult.ts', 'createAgentResult preserves changes');
assert(created.decisions?.[0] === 'Decoupled wire format', 'createAgentResult preserves decisions');
assert(created.unresolved?.[0] === 'Need T22.7 runner', 'createAgentResult preserves unresolved');
assert(created.evidence?.files?.[0] === 'src/core/agentResult.ts', 'createAgentResult preserves evidence');

// 6. Strict JSON serialization and parsing
console.log('--- 6. Serialization and Strict Parsing ---');

const serialized = serializeAgentResult(created);
assert(typeof serialized === 'string', 'serializeAgentResult returns string');
assert(serialized.includes('"status": "done"'), 'Serialized JSON contains status');
assert(!serialized.includes('transcript'), 'Serialized JSON has no transcript');

const parsed = parseAgentResult(serialized);
assert(parsed.status === 'done', 'parseAgentResult parses valid JSON');
assert(parsed.summary === created.summary, 'Parsed summary matches');

assertThrows(
  () => parseAgentResult('not valid json {'),
  'Failed to parse AgentResult JSON'
);
assertThrows(
  () => parseAgentResult('{"status":"unknown","summary":"test"}'),
  "expected 'done', 'blocked', or 'failed'"
);

// 7. Safe parsing (safeParseAgentResult) with fail-closed fallback
console.log('--- 7. safeParseAgentResult Fail-Closed Handling ---');

// Case A: Clean JSON string
const safeClean = safeParseAgentResult(
  JSON.stringify({ status: 'done', summary: 'Clean JSON' })
);
assert(safeClean.status === 'done', 'safeParse parses clean JSON string');
assert(safeClean.summary === 'Clean JSON', 'safeParse preserves clean summary');

// Case B: Markdown code block ```json ... ```
const markdownJson = `Here is the result of my work:
\`\`\`json
{
  "status": "done",
  "summary": "Implemented feature in markdown block",
  "changes": ["Updated file.ts"]
}
\`\`\`
Hope this helps!`;
const safeMarkdown = safeParseAgentResult(markdownJson);
assert(safeMarkdown.status === 'done', 'Extracts JSON from markdown code block');
assert(
  safeMarkdown.summary === 'Implemented feature in markdown block',
  'Preserves markdown extracted summary'
);
assert(
  safeMarkdown.changes?.[0] === 'Updated file.ts',
  'Preserves markdown extracted changes'
);

// Case C: Embedded JSON without markdown fence
const embeddedJson = `Finished work: {"status": "blocked", "summary": "Embedded in prose"} Note to parent.`;
const safeEmbedded = safeParseAgentResult(embeddedJson);
assert(safeEmbedded.status === 'blocked', 'Extracts embedded JSON from prose');
assert(
  safeEmbedded.summary === 'Embedded in prose',
  'Preserves embedded summary'
);

// Case D: Pre-parsed object
const safeObj = safeParseAgentResult({
  status: 'done',
  summary: 'Object input',
});
assert(safeObj.status === 'done', 'Handles pre-parsed valid object');

// Case E: Null, undefined, empty string -> explicit failed fallback
const nullFallback = safeParseAgentResult(null);
assert(
  nullFallback.status === 'failed',
  'Null input produces explicit "failed" status'
);
assert(
  nullFallback.summary.includes('null or undefined'),
  'Null input explains failure in summary'
);

const undefinedFallback = safeParseAgentResult(undefined);
assert(
  undefinedFallback.status === 'failed',
  'Undefined input produces explicit "failed" status'
);

const emptyFallback = safeParseAgentResult('   ');
assert(
  emptyFallback.status === 'failed',
  'Empty string produces explicit "failed" status'
);

// Case F: Malformed non-JSON plain text -> explicit failed fallback
const unparseableText = 'I am sorry, but I encountered an error and could not finish.';
const textFallback = safeParseAgentResult(unparseableText);
assert(
  textFallback.status === 'failed',
  'Unparseable text produces explicit "failed" status'
);
assert(
  textFallback.summary.includes('Malformed child agent result'),
  'Fallback summary mentions malformed result'
);
assert(
  textFallback.unresolved !== undefined && textFallback.unresolved.length > 0,
  'Fallback contains raw snippet in unresolved'
);
assert(
  textFallback.unresolved![0].includes('I am sorry'),
  'Fallback unresolved snippet includes original text context'
);

// Case G: Invalid schema in JSON -> explicit failed fallback
const invalidSchemaJson = JSON.stringify({
  status: 'completed', // Not 'done' | 'blocked' | 'failed'
  summary: 'Completed task',
});
const invalidFallback = safeParseAgentResult(invalidSchemaJson);
assert(
  invalidFallback.status === 'failed',
  'Invalid status produces explicit "failed" status'
);
assert(
  invalidFallback.summary.includes('expected \'done\', \'blocked\', or \'failed\''),
  'Fallback summary contains schema validation error'
);

// Case H: Unexpected data type
const numberFallback = safeParseAgentResult(42);
assert(
  numberFallback.status === 'failed',
  'Number input produces explicit "failed" status'
);

// Case I: Structurally invalid JSON array must produce failed and not be converted to success via brace recovery
const arrayJsonString = JSON.stringify([{ status: 'done', summary: 'example' }]);
const arrayFallback = safeParseAgentResult(arrayJsonString);
assert(
  arrayFallback.status === 'failed',
  'Array of objects as JSON string produces explicit "failed" status (no brace recovery bypass)'
);
const arrayObjectFallback = safeParseAgentResult([{ status: 'done', summary: 'example' }]);
assert(
  arrayObjectFallback.status === 'failed',
  'Array of objects as parsed object produces explicit "failed" status'
);

// Case J: Long invalid status (5,000 chars) must produce bounded fallback that formats without throwing
const hugeStatusJson = JSON.stringify({
  status: 'invalid_status_'.repeat(350), // ~5250 chars
  summary: 'Valid summary',
});
const hugeFallback = safeParseAgentResult(hugeStatusJson);
assert(hugeFallback.status === 'failed', 'Huge invalid status produces "failed" status');
assert(
  hugeFallback.summary.length <= AGENT_RESULT_DEFAULTS.maxSummaryChars,
  'Fallback summary is within maxSummaryChars bounds'
);
if (hugeFallback.unresolved) {
  for (const u of hugeFallback.unresolved) {
    assert(
      u.length <= AGENT_RESULT_DEFAULTS.maxItemChars,
      'Fallback unresolved item is within maxItemChars bounds'
    );
  }
}
// Must format cleanly without throwing
const formattedHugeFallback = formatAgentResultSummary(hugeFallback);
assert(
  formattedHugeFallback.includes('[FAILED]'),
  'formatAgentResultSummary formats bounded fallback without throwing'
);

// 8. Compact Markdown Formatting for Parent Consumption
console.log('--- 8. formatAgentResultSummary ---');

const contaminatedResult = {
  status: 'done' as const,
  summary: 'Added AgentResult contract and verified bounds.',
  changes: ['Created src/core/agentResult.ts', 'Added tests'],
  decisions: ['Decoupled provider wire format'],
  unresolved: ['T22.7 pending'],
  evidence: {
    files: ['src/core/agentResult.ts'],
    tests: ['tests/test_agent_result.ts'],
  },
  transcript: ['secret-child-transcript-item'],
  reasoning: 'secret-child-reasoning-step',
};

const formatted = formatAgentResultSummary(contaminatedResult as any);

assert(
  formatted.includes('**Child Result [DONE]**: Added AgentResult contract and verified bounds.'),
  'Includes uppercase status header and summary'
);
assert(formatted.includes('**Changes:**'), 'Includes changes section');
assert(formatted.includes('- Created src/core/agentResult.ts'), 'Includes changes item');
assert(formatted.includes('**Decisions:**'), 'Includes decisions section');
assert(formatted.includes('**Unresolved:**'), 'Includes unresolved section');
assert(formatted.includes('**Evidence:** Files: src/core/agentResult.ts | Tests: tests/test_agent_result.ts'), 'Includes evidence line');
assert(!formatted.includes('secret-child-transcript-item'), 'Output does not include transcript');
assert(!formatted.includes('secret-child-reasoning-step'), 'Output does not include reasoning');

// Summary of test results
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
