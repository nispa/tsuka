/**
 * Unit tests for T22.5: TaskPacket minimal handoff contract.
 *
 * Verifies:
 * 1. Construction and validation with objective, constraints, and acceptance criteria.
 * 2. Deterministic, history-free markdown briefing generation.
 * 3. JSON serialization, parsing, and round-trip fidelity.
 * 4. Strict enforcement of character and count bounds (fail-closed, no silent mutation).
 * 5. Purity, immutability, and absence of workflow/history leaks.
 *
 * Execution: npx tsx tests/test_task_packet.ts
 */

import { strict as assert } from 'assert';
import {
  TaskPacket,
  createTaskPacket,
  validateTaskPacket,
  formatTaskPacketBriefing,
  serializeTaskPacket,
  parseTaskPacket,
} from '../src/core/taskPacket';
import { TASK_PACKET_DEFAULTS } from '../src/core/constants';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

function assertThrows(id: string, fn: () => void, expectedPattern: RegExp, detail: string): void {
  try {
    fn();
    failed++;
    console.log(`✘ ${id} FAIL — expected exception matching ${expectedPattern}, but none was thrown: ${detail}`);
  } catch (err: any) {
    if (expectedPattern.test(err?.message || '')) {
      passed++;
      console.log(`✔ ${id} PASS — ${detail}`);
    } else {
      failed++;
      console.log(`✘ ${id} FAIL — thrown error "${err?.message}" did not match ${expectedPattern}: ${detail}`);
    }
  }
}

console.log('=== Test TaskPacket Minimal Contract (T22.5) ===\n');

// ---------------------------------------------------------------------------
// Group 1: Construction & Normalization
// ---------------------------------------------------------------------------

const p1 = createTaskPacket('Implement user authentication service');
check('TP1.1', p1.objective === 'Implement user authentication service', 'objective is correctly set');
check('TP1.2', p1.constraints === undefined, 'constraints omitted when not provided');
check('TP1.3', p1.acceptanceCriteria === undefined, 'acceptanceCriteria omitted when not provided');

const p2 = createTaskPacket('  Refactor database connector  ', {
  constraints: [' Must not break existing API ', 'Node.js 20+ '],
  acceptanceCriteria: [' All tests green ', 'Zero memory leaks '],
});
check('TP1.4', p2.objective === 'Refactor database connector', 'objective whitespace is trimmed');
check('TP1.5', p2.constraints?.[0] === 'Must not break existing API', 'first constraint is trimmed');
check('TP1.6', p2.constraints?.[1] === 'Node.js 20+', 'second constraint is trimmed');
check('TP1.7', p2.acceptanceCriteria?.[0] === 'All tests green', 'first criterion is trimmed');
check('TP1.8', p2.acceptanceCriteria?.[1] === 'Zero memory leaks', 'second criterion is trimmed');

const pEmptyArrays = validateTaskPacket({
  objective: 'Clean build',
  constraints: [],
  acceptanceCriteria: [],
});
check('TP1.9', pEmptyArrays.constraints === undefined, 'empty constraints array normalized to undefined');
check('TP1.10', pEmptyArrays.acceptanceCriteria === undefined, 'empty acceptanceCriteria array normalized to undefined');

// ---------------------------------------------------------------------------
// Group 2: Deterministic Briefing Formatting
// ---------------------------------------------------------------------------

const briefing1 = formatTaskPacketBriefing(p1);
check(
  'TP2.1',
  briefing1 === '# Objective\nImplement user authentication service',
  'minimal briefing has only objective section'
);
check('TP2.2', !briefing1.includes('# Constraints'), 'minimal briefing contains no constraints header');
check('TP2.3', !briefing1.includes('# Acceptance Criteria'), 'minimal briefing contains no criteria header');

const briefing2 = formatTaskPacketBriefing(p2);
const expectedBriefing2 =
  '# Objective\nRefactor database connector\n\n' +
  '# Constraints\n- Must not break existing API\n- Node.js 20+\n\n' +
  '# Acceptance Criteria\n- All tests green\n- Zero memory leaks';
check('TP2.4', briefing2 === expectedBriefing2, 'full briefing renders all sections deterministically');

// Verifies no history, reasoning, or workflow scope metadata in briefing
check('TP2.5', !briefing2.includes('runId') && !briefing2.includes('depth'), 'briefing excludes workflow metadata');
check('TP2.6', !briefing2.includes('history') && !briefing2.includes('role:'), 'briefing excludes conversation history');

// Purity: formatting multiple times yields identical string
check('TP2.7', formatTaskPacketBriefing(p2) === formatTaskPacketBriefing(p2), 'formatTaskPacketBriefing is pure');

// ---------------------------------------------------------------------------
// Group 3: Serialization, Parsing & Round-trip
// ---------------------------------------------------------------------------

const serialized = serializeTaskPacket(p2);
check('TP3.1', typeof serialized === 'string' && serialized.startsWith('{'), 'serialized is valid JSON string');

const parsed = parseTaskPacket(serialized);
check('TP3.2', parsed.objective === p2.objective, 'round-trip objective matches');
check('TP3.3', JSON.stringify(parsed.constraints) === JSON.stringify(p2.constraints), 'round-trip constraints match');
check('TP3.4', JSON.stringify(parsed.acceptanceCriteria) === JSON.stringify(p2.acceptanceCriteria), 'round-trip criteria match');

const parsedFromObj = parseTaskPacket({
  objective: 'Direct object test',
  constraints: ['C1'],
});
check('TP3.5', parsedFromObj.objective === 'Direct object test', 'parseTaskPacket accepts raw object');

// ---------------------------------------------------------------------------
// Group 4: Bounds & Validation Fail-Closed
// ---------------------------------------------------------------------------

assertThrows(
  'TP4.1',
  () => validateTaskPacket(null),
  /TaskPacket must be a non-null object/,
  'rejects null candidate'
);

assertThrows(
  'TP4.2',
  () => validateTaskPacket([]),
  /TaskPacket must be a non-null object/,
  'rejects array candidate'
);

assertThrows(
  'TP4.3',
  () => validateTaskPacket({ objective: '' }),
  /TaskPacket objective cannot be empty/,
  'rejects empty objective'
);

assertThrows(
  'TP4.4',
  () => validateTaskPacket({ objective: '   ' }),
  /TaskPacket objective cannot be empty/,
  'rejects whitespace-only objective'
);

assertThrows(
  'TP4.5',
  () => validateTaskPacket({ objective: 123 as any }),
  /TaskPacket objective must be a string/,
  'rejects non-string objective'
);

assertThrows(
  'TP4.6',
  () => validateTaskPacket({ objective: 'a'.repeat(TASK_PACKET_DEFAULTS.maxObjectiveChars + 1) }),
  /TaskPacket objective exceeds maximum length/,
  'rejects objective exceeding maxObjectiveChars'
);

assertThrows(
  'TP4.7',
  () => validateTaskPacket({ objective: 'Valid', constraints: 'not an array' as any }),
  /constraints must be an array of strings/,
  'rejects non-array constraints'
);

const excessConstraints = Array.from({ length: TASK_PACKET_DEFAULTS.maxConstraints + 1 }, (_, i) => `C${i}`);
assertThrows(
  'TP4.8',
  () => validateTaskPacket({ objective: 'Valid', constraints: excessConstraints }),
  /constraints count exceeds maximum/,
  'rejects constraints array exceeding maxConstraints'
);

assertThrows(
  'TP4.9',
  () => validateTaskPacket({ objective: 'Valid', constraints: [123 as any] }),
  /constraint at index 0 must be a string/,
  'rejects non-string constraint'
);

assertThrows(
  'TP4.10',
  () => validateTaskPacket({ objective: 'Valid', constraints: ['   '] }),
  /constraint at index 0 cannot be empty/,
  'rejects empty/whitespace constraint'
);

assertThrows(
  'TP4.11',
  () => validateTaskPacket({ objective: 'Valid', constraints: ['a'.repeat(TASK_PACKET_DEFAULTS.maxConstraintChars + 1)] }),
  /constraint at index 0 exceeds maximum length/,
  'rejects constraint exceeding maxConstraintChars'
);

assertThrows(
  'TP4.12',
  () => validateTaskPacket({ objective: 'Valid', acceptanceCriteria: 'not an array' as any }),
  /acceptanceCriteria must be an array of strings/,
  'rejects non-array acceptanceCriteria'
);

const excessCriteria = Array.from({ length: TASK_PACKET_DEFAULTS.maxAcceptanceCriteria + 1 }, (_, i) => `A${i}`);
assertThrows(
  'TP4.13',
  () => validateTaskPacket({ objective: 'Valid', acceptanceCriteria: excessCriteria }),
  /acceptanceCriteria count exceeds maximum/,
  'rejects criteria array exceeding maxAcceptanceCriteria'
);

assertThrows(
  'TP4.14',
  () => validateTaskPacket({ objective: 'Valid', acceptanceCriteria: ['a'.repeat(TASK_PACKET_DEFAULTS.maxCriterionChars + 1)] }),
  /criterion at index 0 exceeds maximum length/,
  'rejects criterion exceeding maxCriterionChars'
);

assertThrows(
  'TP4.15',
  () => parseTaskPacket('{ malformed json'),
  /Failed to parse TaskPacket JSON/,
  'rejects invalid JSON in parseTaskPacket'
);

assertThrows(
  'TP4.16',
  () => validateTaskPacket({ objective: 'Valid', constraints: new Array(1) }),
  /constraint at index 0 must be a string/,
  'rejects sparse array in constraints'
);

assertThrows(
  'TP4.17',
  () => validateTaskPacket({ objective: 'Valid', acceptanceCriteria: new Array(2) }),
  /acceptance criterion at index 0 must be a string/,
  'rejects sparse array in acceptanceCriteria'
);

// ---------------------------------------------------------------------------
// Group 5: Immutability & Defaults
// ---------------------------------------------------------------------------

const inputObj: TaskPacket = {
  objective: 'Original',
  constraints: ['C1'],
  acceptanceCriteria: ['A1'],
};
const inputCopy = JSON.stringify(inputObj);
validateTaskPacket(inputObj);
formatTaskPacketBriefing(inputObj);
serializeTaskPacket(inputObj);
check('TP5.1', JSON.stringify(inputObj) === inputCopy, 'input object is never mutated by packet operations');

check(
  'TP5.2',
  TASK_PACKET_DEFAULTS.maxObjectiveChars === 4000 &&
  TASK_PACKET_DEFAULTS.maxConstraints === 20 &&
  TASK_PACKET_DEFAULTS.maxAcceptanceCriteria === 20,
  'centralized TASK_PACKET_DEFAULTS in constants.ts match design contract'
);

console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
if (failed > 0) process.exit(1);
