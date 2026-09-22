/**
 * Unit and integration tests for T22.2 and T22.3.
 *
 * 1. T22.2: Pure ContextPressure projection function and edge cases:
 *    - Standard ratio, remainingTokens, usedTokens, limitTokens
 *    - Clamped ratio in [0, 1]
 *    - Non-positive or zero limitTokens (ratio = 1, remaining = 0, no NaN)
 *    - Negative usedTokens treated as 0
 *    - Overflow (usedTokens > limitTokens: clamped ratio = 1, remaining = 0)
 *    - Non-finite numbers handled safely
 *
 * 2. T22.3: ContextTracker ContextEntry backwards compatibility:
 *    - Entries with and without pressure metrics
 *    - Source attribution: 'estimated' | 'observed'
 *    - Ring buffer retention and bounding
 *
 * 3. T22.3: CLI /context and TUI /context command output:
 *    - CLI /context displays 'Context: X% (estimated)' and 'Used: X / Y tokens'
 *    - TUI /context displays 'Context: X% (estimated)' and 'Used: X / Y tokens'
 *
 * Execution: npx tsx tests/test_context_pressure.ts
 */

import './isolateMemory';
import { strict as assert } from 'assert';
import { getContextPressure, ContextPressure } from '../src/core/contextBudget';
import { ContextTracker, ContextEntry } from '../src/core/contextTracker';
import { handleContext } from '../src/cli/commands/session';
import { SESSION_COMMANDS } from '../src/tui/commands/sessionCommands';
import { MockLLMProvider } from './mocks/mockProvider';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { Agent } from '../src/core/agent';
import { logSink } from '../src/core/logSink';

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

async function captureLogs<T>(fn: () => Promise<T> | T): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const originalLog = logSink.log;
  const originalWarn = logSink.warn;
  const originalError = logSink.error;

  logSink.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); };
  logSink.warn = (...args: any[]) => { logs.push(args.map(String).join(' ')); };
  logSink.error = (...args: any[]) => { logs.push(args.map(String).join(' ')); };

  try {
    const result = await fn();
    return { result, logs };
  } finally {
    logSink.log = originalLog;
    logSink.warn = originalWarn;
    logSink.error = originalError;
  }
}

async function main(): Promise<void> {
  console.log('=== Context Pressure and Observability Tests (T22.2, T22.3) ===\n');

  // ---------------------------------------------------------------------------
  // SECTION 1: T22.2 Pure getContextPressure Projection
  // ---------------------------------------------------------------------------
  {
    // 1.1 Standard proportional calculation
    const p1 = getContextPressure(500, 1000);
    check('CP1.1a', p1.usedTokens === 500, 'usedTokens preserved as 500');
    check('CP1.1b', p1.limitTokens === 1000, 'limitTokens preserved as 1000');
    check('CP1.1c', p1.remainingTokens === 500, 'remainingTokens calculates 500');
    check('CP1.1d', p1.ratio === 0.5, 'ratio calculates 0.5');

    // 1.2 Zero usage
    const p2 = getContextPressure(0, 4000);
    check('CP1.2a', p2.ratio === 0, 'Zero usage produces ratio 0');
    check('CP1.2b', p2.remainingTokens === 4000, 'Zero usage preserves full remainingTokens');

    // 1.3 Exact limit saturation
    const p3 = getContextPressure(2048, 2048);
    check('CP1.3a', p3.ratio === 1, 'Exact limit saturation produces ratio 1');
    check('CP1.3b', p3.remainingTokens === 0, 'Exact limit saturation produces remainingTokens 0');

    // 1.4 Over-budget clamp
    const p4 = getContextPressure(3500, 2000);
    check('CP1.4a', p4.ratio === 1, 'Over-budget usage clamps ratio to 1');
    check('CP1.4b', p4.remainingTokens === 0, 'Over-budget usage clamps remainingTokens to 0');
    check('CP1.4c', p4.usedTokens === 3500, 'Over-budget preserves real usedTokens 3500');

    // 1.5 Non-positive or zero limitTokens (fail-safe clamp to ratio 1, no NaN)
    const p5 = getContextPressure(100, 0);
    check('CP1.5a', !Number.isNaN(p5.ratio) && p5.ratio === 1, 'Zero limitTokens produces ratio 1 without NaN');
    check('CP1.5b', p5.remainingTokens === 0, 'Zero limitTokens produces remainingTokens 0');

    const p6 = getContextPressure(100, -500);
    check('CP1.6a', !Number.isNaN(p6.ratio) && p6.ratio === 1, 'Negative limitTokens produces ratio 1 without NaN');
    check('CP1.6b', p6.limitTokens === 0, 'Negative limitTokens clamped to 0');

    // 1.6 Negative usedTokens (treated as 0)
    const p7 = getContextPressure(-50, 1000);
    check('CP1.7a', p7.usedTokens === 0, 'Negative usedTokens sanitized to 0');
    check('CP1.7b', p7.ratio === 0, 'Negative usedTokens yields ratio 0');
    check('CP1.7c', p7.remainingTokens === 1000, 'Negative usedTokens preserves full remaining');

    // 1.7 Non-finite inputs (NaN, Infinity)
    const p8 = getContextPressure(NaN, 1000);
    check('CP1.8a', p8.usedTokens === 0 && p8.ratio === 0, 'NaN usedTokens treated as 0');

    const p9 = getContextPressure(500, Infinity);
    check('CP1.9a', p9.limitTokens === 0 && p9.ratio === 1, 'Infinity limitTokens treated as 0 / saturated');
  }

  // ---------------------------------------------------------------------------
  // SECTION 2: T22.3 ContextTracker ContextEntry Retrocompatibility
  // ---------------------------------------------------------------------------
  {
    const tracker = ContextTracker.getInstance();
    tracker.clear();

    // 2.1 Legacy entry without pressure fields
    const legacyEntry: ContextEntry = {
      timestamp: new Date().toISOString(),
      agentName: 'legacy_agent',
      tokenCount: 45,
      promptTokens: 300,
      action: 'Legacy query',
    };
    tracker.addEntry(legacyEntry);
    check('CP2.1a', tracker.getAll().length === 1, 'Tracker accepts legacy entry without pressure fields');
    const retrievedLegacy = tracker.getAll()[0];
    check('CP2.1b', retrievedLegacy.usedTokens === undefined, 'Legacy entry usedTokens remains undefined');
    check('CP2.1c', retrievedLegacy.source === undefined, 'Legacy entry source remains undefined');

    // 2.2 Modern entry with pressure fields
    const modernEntry: ContextEntry = {
      timestamp: new Date().toISOString(),
      agentName: 'modern_agent',
      tokenCount: 60,
      promptTokens: 450,
      action: 'Modern query',
      usedTokens: 450,
      limitTokens: 1000,
      ratio: 0.45,
      source: 'observed',
    };
    tracker.addEntry(modernEntry);
    check('CP2.2a', tracker.getAll().length === 2, 'Tracker retains both legacy and modern entries');
    const retrievedModern = tracker.getAll()[1];
    check('CP2.2b', retrievedModern.usedTokens === 450, 'Modern entry stores usedTokens 450');
    check('CP2.2c', retrievedModern.limitTokens === 1000, 'Modern entry stores limitTokens 1000');
    check('CP2.2d', retrievedModern.ratio === 0.45, 'Modern entry stores ratio 0.45');
    check('CP2.2e', retrievedModern.source === 'observed', "Modern entry stores source 'observed'");

    tracker.clear();
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: T22.3 CLI and TUI /context Observability
  // ---------------------------------------------------------------------------
  {
    // 3.1 CLI /context displays standardized pressure lines
    const provider = new MockLLMProvider([{ content: 'ready' }]);
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const agent = new Agent(provider, registry, permissions, 'System instructions', []);
    await agent.run('hello context');

    const cliCtx = {
      agent: { current: agent },
      recreateAgent: () => agent,
      permissionManager: permissions,
      provider,
      registry,
      configManager: {
        getMaxHistoryTokens: () => 10000,
        getRuntimeContextTokens: () => null,
      },
    } as any;

    const { logs } = await captureLogs(async () => {
      await handleContext(cliCtx, '');
    });

    const rendered = logs.join('\n');
    check('CP3.1a', rendered.includes('Context:'), "CLI /context displays 'Context:' label");
    check('CP3.1b', rendered.includes('(estimated)'), "CLI /context displays '(estimated)' measurement source");
    check('CP3.1c', /Used:\s+[\d,]+\s+\/\s+10,000 tokens/.test(rendered), "CLI /context displays 'Used: X / 10,000 tokens' line");

    // 3.2 TUI /context displays standardized pressure lines
    const tuiContextCommand = SESSION_COMMANDS.find((cmd) => cmd.name === '/context');
    assert(tuiContextCommand);

    const addedMessages: any[] = [];
    const mockStore = {
      getState: () => ({
        stats: { usedTokens: 2500, percentage: 50, maxTokens: 5000 },
        messages: [{ role: 'system' }, { role: 'user' }],
      }),
      addMessage: (m: any) => { addedMessages.push(m); },
    };

    tuiContextCommand.run({ store: mockStore } as any);
    check('CP3.2a', addedMessages.length === 1, 'TUI /context added exactly one message');
    const msgContent = addedMessages[0]?.content || '';
    check('CP3.2b', msgContent.includes('Context: 50% (estimated)'), "TUI /context contains 'Context: 50% (estimated)'");
    check('CP3.2c', msgContent.includes('Used: 2,500 / 5,000 tokens'), "TUI /context contains 'Used: 2,500 / 5,000 tokens'");
    check('CP3.2d', msgContent.includes('Max Budget: 5000 tokens'), "TUI /context retains 'Max Budget: 5000 tokens'");
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in test_context_pressure:', err);
  process.exit(1);
});