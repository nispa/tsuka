/**
 * Unit tests for T22.4: Pure context scheduler policy.
 *
 * Validates:
 * 1. Policy logic under, on, and over the two thresholds with centralized defaults (0.60 / 0.70).
 * 2. Policy logic with custom valid scheduler configurations.
 * 3. Strict rejection of invalid configurations (NaN, Infinity, out of range, non-strictly ordered).
 * 4. Strict rejection of invalid pressure inputs.
 * 5. Purity, immutability, type constraints, and integration with getContextPressure.
 *
 * Execution: npx tsx tests/test_context_scheduler_policy.ts
 */

import { strict as assert } from 'assert';
import {
  scheduleContext,
  validateContextSchedulerConfig,
  ContextAction,
  ContextSchedulerConfig,
} from '../src/core/contextScheduler';
import { getContextPressure, ContextPressure } from '../src/core/contextBudget';
import { CONTEXT_SCHEDULER_DEFAULTS } from '../src/core/constants';

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

function makePressure(ratio: number): ContextPressure {
  return {
    usedTokens: Math.round(ratio * 1000),
    limitTokens: 1000,
    remainingTokens: Math.max(0, 1000 - Math.round(ratio * 1000)),
    ratio,
  };
}

console.log('=== Test Context Scheduler Policy (T22.4) ===\n');

// ---------------------------------------------------------------------------
// Group 1: Default configuration thresholds (prepareAt: 0.60, delegateAt: 0.70)
// ---------------------------------------------------------------------------

// Below prepareAt (ratio < 0.60) -> 'continue'
check('CSP1.1', scheduleContext(makePressure(0.0)) === 'continue', 'ratio 0.0 returns continue');
check('CSP1.2', scheduleContext(makePressure(0.35)) === 'continue', 'ratio 0.35 returns continue');
check('CSP1.3', scheduleContext(makePressure(0.59)) === 'continue', 'ratio 0.59 returns continue');
check('CSP1.4', scheduleContext(makePressure(0.5999)) === 'continue', 'ratio 0.5999 returns continue');

// On prepareAt and up to before delegateAt (0.60 <= ratio < 0.70) -> 'prepare'
check('CSP1.5', scheduleContext(makePressure(0.60)) === 'prepare', 'ratio 0.60 exactly on prepareAt returns prepare');
check('CSP1.6', scheduleContext(makePressure(0.6001)) === 'prepare', 'ratio 0.6001 returns prepare');
check('CSP1.7', scheduleContext(makePressure(0.65)) === 'prepare', 'ratio 0.65 between thresholds returns prepare');
check('CSP1.8', scheduleContext(makePressure(0.6999)) === 'prepare', 'ratio 0.6999 immediately before delegateAt returns prepare');

// On and above delegateAt (ratio >= 0.70) -> 'delegate'
check('CSP1.9', scheduleContext(makePressure(0.70)) === 'delegate', 'ratio 0.70 exactly on delegateAt returns delegate');
check('CSP1.10', scheduleContext(makePressure(0.7001)) === 'delegate', 'ratio 0.7001 returns delegate');
check('CSP1.11', scheduleContext(makePressure(0.85)) === 'delegate', 'ratio 0.85 returns delegate');
check('CSP1.12', scheduleContext(makePressure(1.0)) === 'delegate', 'ratio 1.0 (fully exhausted) returns delegate');
check('CSP1.13', scheduleContext(makePressure(1.25)) === 'delegate', 'ratio 1.25 (over-capacity) returns delegate');

// ---------------------------------------------------------------------------
// Group 2: Custom valid thresholds
// ---------------------------------------------------------------------------

const customConfigA: ContextSchedulerConfig = { prepareAt: 0.30, delegateAt: 0.50 };
check('CSP2.1', scheduleContext(makePressure(0.29), customConfigA) === 'continue', 'custom config: ratio 0.29 returns continue');
check('CSP2.2', scheduleContext(makePressure(0.30), customConfigA) === 'prepare', 'custom config: ratio 0.30 returns prepare');
check('CSP2.3', scheduleContext(makePressure(0.40), customConfigA) === 'prepare', 'custom config: ratio 0.40 returns prepare');
check('CSP2.4', scheduleContext(makePressure(0.50), customConfigA) === 'delegate', 'custom config: ratio 0.50 returns delegate');
check('CSP2.5', scheduleContext(makePressure(0.75), customConfigA) === 'delegate', 'custom config: ratio 0.75 returns delegate');

const boundaryConfig: ContextSchedulerConfig = { prepareAt: 0.0, delegateAt: 1.0 };
check('CSP2.6', scheduleContext(makePressure(0.0), boundaryConfig) === 'prepare', 'boundary config (0..1): ratio 0.0 returns prepare');
check('CSP2.7', scheduleContext(makePressure(0.5), boundaryConfig) === 'prepare', 'boundary config (0..1): ratio 0.5 returns prepare');
check('CSP2.8', scheduleContext(makePressure(1.0), boundaryConfig) === 'delegate', 'boundary config (0..1): ratio 1.0 returns delegate');

const narrowConfig: ContextSchedulerConfig = { prepareAt: 0.80, delegateAt: 0.81 };
check('CSP2.9', scheduleContext(makePressure(0.799), narrowConfig) === 'continue', 'narrow config: ratio 0.799 returns continue');
check('CSP2.10', scheduleContext(makePressure(0.80), narrowConfig) === 'prepare', 'narrow config: ratio 0.80 returns prepare');
check('CSP2.11', scheduleContext(makePressure(0.81), narrowConfig) === 'delegate', 'narrow config: ratio 0.81 returns delegate');

// ---------------------------------------------------------------------------
// Group 3: Invalid configuration validation
// ---------------------------------------------------------------------------

assertThrows(
  'CSP3.1',
  () => validateContextSchedulerConfig({ prepareAt: NaN, delegateAt: 0.7 }),
  /prepareAt must be a finite number/,
  'rejects prepareAt = NaN'
);

assertThrows(
  'CSP3.2',
  () => validateContextSchedulerConfig({ prepareAt: 0.6, delegateAt: NaN }),
  /delegateAt must be a finite number/,
  'rejects delegateAt = NaN'
);

assertThrows(
  'CSP3.3',
  () => validateContextSchedulerConfig({ prepareAt: Infinity, delegateAt: 0.7 }),
  /prepareAt must be a finite number/,
  'rejects prepareAt = Infinity'
);

assertThrows(
  'CSP3.4',
  () => validateContextSchedulerConfig({ prepareAt: 0.6, delegateAt: -Infinity }),
  /delegateAt must be a finite number/,
  'rejects delegateAt = -Infinity'
);

assertThrows(
  'CSP3.5',
  () => validateContextSchedulerConfig({ prepareAt: -0.01, delegateAt: 0.7 }),
  /prepareAt must be within \[0, 1\]/,
  'rejects negative prepareAt'
);

assertThrows(
  'CSP3.6',
  () => validateContextSchedulerConfig({ prepareAt: 0.6, delegateAt: 1.01 }),
  /delegateAt must be within \[0, 1\]/,
  'rejects delegateAt > 1'
);

assertThrows(
  'CSP3.7',
  () => validateContextSchedulerConfig({ prepareAt: 1.1, delegateAt: 1.5 }),
  /prepareAt must be within \[0, 1\]/,
  'rejects prepareAt > 1'
);

assertThrows(
  'CSP3.8',
  () => validateContextSchedulerConfig({ prepareAt: 0.70, delegateAt: 0.60 }),
  /strictly ordered \(prepareAt < delegateAt\)/,
  'rejects inverted thresholds (prepareAt > delegateAt)'
);

assertThrows(
  'CSP3.9',
  () => validateContextSchedulerConfig({ prepareAt: 0.60, delegateAt: 0.60 }),
  /strictly ordered \(prepareAt < delegateAt\)/,
  'rejects equal thresholds (prepareAt === delegateAt)'
);

assertThrows(
  'CSP3.10',
  () => validateContextSchedulerConfig(null as any),
  /must be a non-null object/,
  'rejects null config'
);

assertThrows(
  'CSP3.11',
  () => validateContextSchedulerConfig('invalid' as any),
  /must be a non-null object/,
  'rejects primitive string config'
);

assertThrows(
  'CSP3.12',
  () => validateContextSchedulerConfig({ prepareAt: undefined as any, delegateAt: 0.7 }),
  /prepareAt must be a finite number/,
  'rejects undefined prepareAt'
);

assertThrows(
  'CSP3.13',
  () => validateContextSchedulerConfig({ prepareAt: 0.6, delegateAt: undefined as any }),
  /delegateAt must be a finite number/,
  'rejects undefined delegateAt'
);

assertThrows(
  'CSP3.14',
  () => scheduleContext(makePressure(0.5), { prepareAt: 0.8, delegateAt: 0.5 }),
  /strictly ordered/,
  'scheduleContext propagates configuration validation error without silent correction'
);

// ---------------------------------------------------------------------------
// Group 4: Invalid pressure input validation
// ---------------------------------------------------------------------------

assertThrows(
  'CSP4.1',
  () => scheduleContext(null as any),
  /ContextPressure must be a non-null object/,
  'rejects null pressure'
);

assertThrows(
  'CSP4.2',
  () => scheduleContext({ ratio: NaN } as any),
  /ratio must be a finite non-negative number/,
  'rejects pressure with ratio = NaN'
);

assertThrows(
  'CSP4.3',
  () => scheduleContext({ ratio: undefined } as any),
  /ratio must be a finite non-negative number/,
  'rejects pressure with ratio = undefined'
);

assertThrows(
  'CSP4.4',
  () => scheduleContext({ ratio: -0.5 } as any),
  /ratio must be a finite non-negative number/,
  'rejects pressure with negative ratio'
);

assertThrows(
  'CSP4.5',
  () => scheduleContext({ ratio: Infinity } as any),
  /ratio must be a finite non-negative number/,
  'rejects pressure with ratio = Infinity'
);

// ---------------------------------------------------------------------------
// Group 5: Purity, contracts, and integration
// ---------------------------------------------------------------------------

// Immutability: inputs are never mutated
const originalPressure: ContextPressure = { usedTokens: 500, limitTokens: 1000, remainingTokens: 500, ratio: 0.5 };
const pressureCopy = { ...originalPressure };
const originalConfig: ContextSchedulerConfig = { prepareAt: 0.4, delegateAt: 0.8 };
const configCopy = { ...originalConfig };

scheduleContext(originalPressure, originalConfig);
check('CSP5.1', JSON.stringify(originalPressure) === JSON.stringify(pressureCopy), 'pressure object is not mutated');
check('CSP5.2', JSON.stringify(originalConfig) === JSON.stringify(configCopy), 'config object is not mutated');

// Centralized defaults inspection
check(
  'CSP5.3',
  CONTEXT_SCHEDULER_DEFAULTS.prepareAt === 0.60 && CONTEXT_SCHEDULER_DEFAULTS.delegateAt === 0.70,
  'centralized defaults in constants.ts are exactly prepareAt=0.60 and delegateAt=0.70'
);

// Determinism: repeated calls return identical results
const r1 = scheduleContext(originalPressure, originalConfig);
const r2 = scheduleContext(originalPressure, originalConfig);
const r3 = scheduleContext(originalPressure, originalConfig);
check('CSP5.4', r1 === 'prepare' && r2 === 'prepare' && r3 === 'prepare', 'repeated calls are strictly deterministic');

// Integration with getContextPressure
const pLow = getContextPressure(2000, 10000);
const pMid = getContextPressure(6200, 10000);
const pHigh = getContextPressure(7500, 10000);
check('CSP5.5', scheduleContext(pLow) === 'continue', 'integration with getContextPressure (20% used -> continue)');
check('CSP5.6', scheduleContext(pMid) === 'prepare', 'integration with getContextPressure (62% used -> prepare)');
check('CSP5.7', scheduleContext(pHigh) === 'delegate', 'integration with getContextPressure (75% used -> delegate)');

// Exhaustive ContextAction type test (must be one of the three actions)
const allActions: ContextAction[] = ['continue', 'prepare', 'delegate'];
const result = scheduleContext(makePressure(0.65));
check('CSP5.8', allActions.includes(result), 'result conforms strictly to ContextAction union');

console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
if (failed > 0) process.exit(1);
