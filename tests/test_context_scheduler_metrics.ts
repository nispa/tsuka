/**
 * Test suite for Context Scheduler Metrics and Telemetry (T22.16).
 *
 * Verifies:
 * - CSM.1: Initial scheduler metrics state (all zeroes, null observed pressure, null amplification).
 * - CSM.2: Peak estimated pressure tracking across multiple updates.
 * - CSM.3: Observed pressure recording from provider stats.
 * - CSM.4: Scheduler decision counters for prepare and delegate.
 * - CSM.5: Delegation lifecycle counters (attempted, completed, failed).
 * - CSM.6: Token economy and context amplification computation (childTokens / returnedTokens).
 * - CSM.7: Zero returned tokens denominator produces null amplification (not Infinity or NaN).
 * - CSM.8: ContextTracker.clear() cleanly resets all scheduler metrics.
 * - CSM.9: ReAct loop integration: successful delegation records tokens and emits amplification in event.
 * - CSM.10: Invariant: disabled context scheduler does not emit events or mutate scheduler decisions.
 * - CSM.11: ReAct loop integration: delegation runner failure increments failed counter and continues parent.
 */

import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextTracker } from '../src/core/contextTracker';
import { Agent } from '../src/core/agent';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { MockLLMProvider } from './mocks/mockProvider';
import type { ISubagentRunner, SubagentRunRequest, SubagentRunResult } from '../src/core/types';
import type { AgentEvent } from '../src/core/agentEvents';
import type { AgentResult } from '../src/core/agentResult';

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

class MockSubagentRunner implements ISubagentRunner {
  public calls: SubagentRunRequest[] = [];
  public customResult?: Partial<SubagentRunResult>;
  public shouldThrow = false;

  constructor(customResult?: Partial<SubagentRunResult>, shouldThrow = false) {
    this.customResult = customResult;
    this.shouldThrow = shouldThrow;
  }

  async run(request: SubagentRunRequest): Promise<SubagentRunResult> {
    this.calls.push(request);
    if (this.shouldThrow) {
      throw new Error('Simulated runner failure');
    }

    const defaultAgentResult: AgentResult = {
      status: 'done',
      summary: 'Child task completed successfully with key findings.',
      changes: ['fileA.ts'],
    };

    return {
      success: this.customResult?.success ?? true,
      output: this.customResult?.output ?? 'Raw output text',
      agentLabel: this.customResult?.agentLabel ?? 'child-agent',
      roleName: this.customResult?.roleName ?? 'developer',
      reportPath: this.customResult?.reportPath ?? 'runs/test/child.md',
      stats: this.customResult?.stats ?? { totalTokens: 1200, promptTokens: 900, tokenCount: 300 },
      agentResult: 'agentResult' in (this.customResult || {}) ? this.customResult?.agentResult : defaultAgentResult,
    };
  }
}

async function runTests(): Promise<void> {
  console.log('=== Context Scheduler Metrics Tests (T22.16) ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-csm-home-'));
  const tmpMemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-csm-mem-'));
  process.env.TSUKA_HOME = tmpHome;
  process.env.TSUKA_MEMORY_FILE = path.join(tmpMemDir, 'memory.json');

  const tracker = ContextTracker.getInstance();

  // ---------------------------------------------------------------------------
  // 1. CSM.1: Initial State
  // ---------------------------------------------------------------------------
  console.log('--- 1. Initial State ---');
  tracker.clear();
  {
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.1a', metrics.peakEstimatedPressure === 0, 'peakEstimatedPressure starts at 0');
    check('CSM.1b', metrics.lastObservedPressure === null, 'lastObservedPressure starts at null');
    check('CSM.1c', metrics.prepareDecisions === 0, 'prepareDecisions starts at 0');
    check('CSM.1d', metrics.delegateDecisions === 0, 'delegateDecisions starts at 0');
    check('CSM.1e', metrics.delegationsAttempted === 0, 'delegationsAttempted starts at 0');
    check('CSM.1f', metrics.delegationsCompleted === 0, 'delegationsCompleted starts at 0');
    check('CSM.1g', metrics.delegationsFailed === 0, 'delegationsFailed starts at 0');
    check('CSM.1h', metrics.contextAmplification === null, 'contextAmplification starts at null');
  }

  // ---------------------------------------------------------------------------
  // 2. CSM.2: Peak Estimated Pressure
  // ---------------------------------------------------------------------------
  console.log('--- 2. Peak Estimated Pressure Tracking ---');
  tracker.clear();
  {
    tracker.recordEstimatedPressure(0.45);
    check('CSM.2a', tracker.getSchedulerMetrics().peakEstimatedPressure === 0.45, 'records initial pressure');
    tracker.recordEstimatedPressure(0.82);
    check('CSM.2b', tracker.getSchedulerMetrics().peakEstimatedPressure === 0.82, 'updates to higher pressure');
    tracker.recordEstimatedPressure(0.60);
    check('CSM.2c', tracker.getSchedulerMetrics().peakEstimatedPressure === 0.82, 'monotonic peak ignores lower pressure');
  }

  // ---------------------------------------------------------------------------
  // 3. CSM.3: Observed Pressure Recording
  // ---------------------------------------------------------------------------
  console.log('--- 3. Observed Pressure Recording ---');
  tracker.clear();
  {
    tracker.recordObservedPressure({
      usedTokens: 6000,
      limitTokens: 8000,
      remainingTokens: 2000,
      ratio: 0.75,
    });
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.3a', metrics.lastObservedPressure !== null, 'observed pressure recorded');
    check('CSM.3b', metrics.lastObservedPressure?.ratio === 0.75, 'observed ratio preserved');
    check('CSM.3c', metrics.lastObservedPressure?.usedTokens === 6000, 'usedTokens preserved');
  }

  // ---------------------------------------------------------------------------
  // 4. CSM.4: Decision Counters
  // ---------------------------------------------------------------------------
  console.log('--- 4. Decision Counters ---');
  tracker.clear();
  {
    tracker.recordDecision('prepare');
    tracker.recordDecision('prepare');
    tracker.recordDecision('delegate');
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.4a', metrics.prepareDecisions === 2, 'records prepare decisions accurately');
    check('CSM.4b', metrics.delegateDecisions === 1, 'records delegate decisions accurately');
  }

  // ---------------------------------------------------------------------------
  // 5. CSM.5: Delegation Lifecycle Counters
  // ---------------------------------------------------------------------------
  console.log('--- 5. Delegation Lifecycle Counters ---');
  tracker.clear();
  {
    tracker.recordDelegationAttempt();
    tracker.recordDelegationAttempt();
    tracker.recordDelegationFailure();
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.5a', metrics.delegationsAttempted === 2, 'records delegation attempts');
    check('CSM.5b', metrics.delegationsFailed === 1, 'records delegation failures');
    check('CSM.5c', metrics.delegationsCompleted === 0, 'completed remains 0 before success');
  }

  // ---------------------------------------------------------------------------
  // 6. CSM.6: Token Economy and Amplification
  // ---------------------------------------------------------------------------
  console.log('--- 6. Token Economy and Amplification ---');
  tracker.clear();
  {
    tracker.recordDelegationAttempt();
    tracker.recordDelegationSuccess({
      childTokens: 1500,
      returnedTokens: 300,
      agentResultChars: 450,
    });
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.6a', metrics.delegationsCompleted === 1, 'delegation completed incremented');
    check('CSM.6b', metrics.lastChildTokens === 1500, 'lastChildTokens recorded');
    check('CSM.6c', metrics.lastReturnedTokens === 300, 'lastReturnedTokens recorded');
    check('CSM.6d', metrics.lastAgentResultChars === 450, 'lastAgentResultChars recorded');
    check('CSM.6e', metrics.contextAmplification === 5.0, 'contextAmplification correctly calculated (1500 / 300 = 5.0)');
    check('CSM.6f', metrics.totalChildTokens === 1500, 'totalChildTokens accumulated');
    check('CSM.6g', metrics.totalReturnedTokens === 300, 'totalReturnedTokens accumulated');
  }

  // ---------------------------------------------------------------------------
  // 7. CSM.7: Zero Denominator Produces Null Amplification
  // ---------------------------------------------------------------------------
  console.log('--- 7. Zero Denominator Produces Null Amplification ---');
  tracker.clear();
  {
    tracker.recordDelegationSuccess({
      childTokens: 1000,
      returnedTokens: 0,
      agentResultChars: 0,
    });
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.7a', metrics.contextAmplification === null, 'zero returned tokens returns null amplification');
  }

  // ---------------------------------------------------------------------------
  // 8. CSM.8: Reset on clear()
  // ---------------------------------------------------------------------------
  console.log('--- 8. Reset on clear() ---');
  {
    tracker.recordDecision('prepare');
    tracker.recordDecision('delegate');
    tracker.recordDelegationAttempt();
    tracker.recordDelegationSuccess({ childTokens: 500, returnedTokens: 100, agentResultChars: 200 });
    tracker.recordDelegationFailure();
    tracker.clear();
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.8a', metrics.peakEstimatedPressure === 0, 'peakEstimatedPressure reset to 0');
    check('CSM.8b', metrics.lastObservedPressure === null, 'lastObservedPressure reset to null');
    check('CSM.8c', metrics.prepareDecisions === 0, 'prepareDecisions reset to 0');
    check('CSM.8d', metrics.delegateDecisions === 0, 'delegateDecisions reset to 0');
    check('CSM.8e', metrics.delegationsAttempted === 0, 'delegationsAttempted reset to 0');
    check('CSM.8f', metrics.delegationsCompleted === 0, 'delegationsCompleted reset to 0');
    check('CSM.8g', metrics.delegationsFailed === 0, 'delegationsFailed reset to 0');
    check('CSM.8h', metrics.contextAmplification === null, 'contextAmplification reset to null');
  }

  // ---------------------------------------------------------------------------
  // 9. CSM.9: Integrated ReAct Loop Successful Delegation
  // ---------------------------------------------------------------------------
  console.log('--- 9. Integrated ReAct Loop Successful Delegation ---');
  tracker.clear();
  {
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const provider = new MockLLMProvider([
      { content: 'Final response after incorporating subagent report.' },
    ]);
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 1000, 'test-agent');
    agent.setContextScheduler({ enabled: true, prepareAt: 0.5, delegateAt: 0.8 });

    const runner = new MockSubagentRunner({
      stats: { totalTokens: 1600, promptTokens: 1200, tokenCount: 400 },
      agentResult: {
        status: 'done',
        summary: 'Analyzed all items successfully.',
        changes: ['file1.ts'],
      },
    });
    agent.setSubagentRunner(runner);

    // Fill history so estimated tokens exceed delegateAt (0.8 of 1000 = 800 tokens)
    const filler = 'X'.repeat(3400); // ~850 tokens
    agent.getMessages().push({ role: 'user', content: filler });

    const events: AgentEvent[] = [];
    const result = await agent.run(
      'Perform critical task',
      undefined,
      undefined,
      (ev) => events.push(ev)
    );

    check('CSM.9a', result.includes('Final response'), 'parent agent completed run');
    check('CSM.9b', runner.calls.length === 1, 'runner was executed once');

    const metrics = tracker.getSchedulerMetrics();
    check('CSM.9c', metrics.delegateDecisions === 1, 'delegate decision recorded in ReAct loop');
    check('CSM.9d', metrics.delegationsAttempted === 1, 'delegation attempt recorded in ReAct loop');
    check('CSM.9e', metrics.delegationsCompleted === 1, 'delegation completed recorded in ReAct loop');
    check('CSM.9f', metrics.delegationsFailed === 0, 'delegation failure count is 0');
    check('CSM.9g', metrics.lastChildTokens === 1600, 'child tokens recorded accurately');
    check('CSM.9h', metrics.lastReturnedTokens > 0, 'returned tokens estimated for delegation report');
    check('CSM.9i', typeof metrics.contextAmplification === 'number' && metrics.contextAmplification! > 0, 'context amplification calculated');

    const delegateEvent = events.find((e) => e.type === 'context_action' && e.action === 'delegate');
    check('CSM.9j', !!delegateEvent, 'context_action delegate event emitted');
    check('CSM.9k', (delegateEvent as any)?.amplification === metrics.contextAmplification, 'event includes matching context amplification');
  }

  // ---------------------------------------------------------------------------
  // 10. CSM.10: Invariant: Disabled Scheduler
  // ---------------------------------------------------------------------------
  console.log('--- 10. Invariant: Disabled Scheduler Produces No Events or Decision Metrics ---');
  tracker.clear();
  {
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const provider = new MockLLMProvider([{ content: 'Regular response without delegation' }]);
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 1000, 'test-agent');
    // Disabled scheduler by default (isContextSchedulerEnabled() === false)

    const runner = new MockSubagentRunner();
    agent.setSubagentRunner(runner);

    const filler = 'X'.repeat(3600);
    agent.getMessages().push({ role: 'user', content: filler });

    const events: AgentEvent[] = [];
    await agent.run('Run under high pressure but disabled scheduler', undefined, undefined, (ev) => events.push(ev));

    const metrics = tracker.getSchedulerMetrics();
    check('CSM.10a', runner.calls.length === 0, 'runner was not called');
    check('CSM.10b', metrics.delegateDecisions === 0, 'no delegate decisions recorded');
    check('CSM.10c', metrics.prepareDecisions === 0, 'no prepare decisions recorded');
    check('CSM.10d', metrics.delegationsAttempted === 0, 'no delegations attempted');
    check('CSM.10e', !events.some((e) => e.type === 'context_action'), 'no context_action events emitted');
  }

  // ---------------------------------------------------------------------------
  // 11. CSM.11: Integrated ReAct Loop Delegation Failure
  // ---------------------------------------------------------------------------
  console.log('--- 11. Integrated ReAct Loop Delegation Failure ---');
  tracker.clear();
  {
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const provider = new MockLLMProvider([{ content: 'Fallback answer from parent after child failed' }]);
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 1000, 'test-agent');
    agent.setContextScheduler({ enabled: true, prepareAt: 0.5, delegateAt: 0.8 });

    const failingRunner = new MockSubagentRunner({}, true);
    agent.setSubagentRunner(failingRunner);

    const filler = 'X'.repeat(3400);
    agent.getMessages().push({ role: 'user', content: filler });

    const result = await agent.run('Task triggering failing child');
    check('CSM.11a', result.includes('Fallback answer'), 'parent handles child failure gracefully');

    const metrics = tracker.getSchedulerMetrics();
    check('CSM.11b', metrics.delegationsAttempted === 1, 'attempt was counted');
    check('CSM.11c', metrics.delegationsFailed === 1, 'failure was counted');
    check('CSM.11d', metrics.delegationsCompleted === 0, 'completion was not counted');
  }

  // ---------------------------------------------------------------------------
  // 12. CSM.12: Child returns status: 'failed' without throwing
  // ---------------------------------------------------------------------------
  console.log('--- 12. Child returns status: failed without throwing ---');
  tracker.clear();
  {
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const provider = new MockLLMProvider([{ content: 'Parent completes after child reported failure' }]);
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 1000, 'test-agent');
    agent.setContextScheduler({ enabled: true, prepareAt: 0.5, delegateAt: 0.8 });

    const failedResultRunner = new MockSubagentRunner({
      agentResult: {
        status: 'failed',
        summary: 'Child task failed due to missing resource.',
        unresolved: ['Resource not found'],
      },
      stats: { totalTokens: 800, promptTokens: 600, tokenCount: 200 },
    });
    agent.setSubagentRunner(failedResultRunner);

    const filler = 'X'.repeat(3400);
    agent.getMessages().push({ role: 'user', content: filler });

    await agent.run('Task where child returns failed status');
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.12a', metrics.delegationsAttempted === 1, 'delegation attempt recorded');
    check('CSM.12b', metrics.delegationsFailed === 1, 'delegationsFailed incremented on child failed status');
    check('CSM.12c', metrics.delegationsCompleted === 0, 'delegationsCompleted NOT incremented on child failed status');
    check('CSM.12d', metrics.lastChildTokens === 800, 'token stats still captured on child failed status');
  }

  // ---------------------------------------------------------------------------
  // 13. CSM.13: Child returns status: 'blocked'
  // ---------------------------------------------------------------------------
  console.log('--- 13. Child returns status: blocked ---');
  tracker.clear();
  {
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const provider = new MockLLMProvider([{ content: 'Parent handles blocked child' }]);
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 1000, 'test-agent');
    agent.setContextScheduler({ enabled: true, prepareAt: 0.5, delegateAt: 0.8 });

    const blockedResultRunner = new MockSubagentRunner({
      agentResult: {
        status: 'blocked',
        summary: 'Child task blocked pending user confirmation.',
        unresolved: ['User confirmation required'],
      },
      stats: { totalTokens: 950, promptTokens: 700, tokenCount: 250 },
    });
    agent.setSubagentRunner(blockedResultRunner);

    const filler = 'X'.repeat(3400);
    agent.getMessages().push({ role: 'user', content: filler });

    await agent.run('Task where child returns blocked status');
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.13a', metrics.delegationsAttempted === 1, 'delegation attempt recorded');
    check('CSM.13b', metrics.delegationsBlocked === 1, 'delegationsBlocked incremented on blocked status');
    check('CSM.13c', metrics.delegationsCompleted === 0, 'delegationsCompleted NOT incremented on blocked status');
    check('CSM.13d', metrics.delegationsFailed === 0, 'delegationsFailed NOT incremented on blocked status');
  }

  // ---------------------------------------------------------------------------
  // 14. CSM.14: Child produces malformed result falling back to failed
  // ---------------------------------------------------------------------------
  console.log('--- 14. Child produces malformed result falling back to failed ---');
  tracker.clear();
  {
    const registry = new ToolRegistry();
    const permissions = new PermissionManager();
    const provider = new MockLLMProvider([{ content: 'Parent recovers from malformed child result' }]);
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 1000, 'test-agent');
    agent.setContextScheduler({ enabled: true, prepareAt: 0.5, delegateAt: 0.8 });

    const malformedRunner = new MockSubagentRunner({
      agentResult: 'This is not valid JSON at all and cannot be parsed',
      stats: { totalTokens: 600, promptTokens: 500, tokenCount: 100 },
    });
    agent.setSubagentRunner(malformedRunner);

    const filler = 'X'.repeat(3400);
    agent.getMessages().push({ role: 'user', content: filler });

    await agent.run('Task with malformed child output');
    const metrics = tracker.getSchedulerMetrics();
    check('CSM.14a', metrics.delegationsAttempted === 1, 'delegation attempt recorded');
    check('CSM.14b', metrics.delegationsFailed === 1, 'delegationsFailed incremented on fallback from malformed output');
    check('CSM.14c', metrics.delegationsCompleted === 0, 'delegationsCompleted is 0 for malformed fallback');
  }

  // ---------------------------------------------------------------------------
  // 15. CSM.15: Multi-round cumStats totalTokens accumulation
  // ---------------------------------------------------------------------------
  console.log('--- 15. Multi-round cumStats totalTokens accumulation ---');
  {
    const registry = new ToolRegistry();
    registry.register({
      name: 'dummy_tool',
      riskLevel: 'SAFE',
      execute: async () => 'tool output',
    });
    const permissions = new PermissionManager();
    // 2-round agent: round 1 calls dummy_tool, round 2 provides final answer
    const provider = new MockLLMProvider([
      {
        content: null as any,
        toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'dummy_tool', arguments: '{}' } }],
        stats: { durationMs: 10, tokenCount: 50, tokensPerSecond: 10, promptTokens: 100, totalTokens: 150 },
      },
      {
        content: 'Final multi-round answer',
        stats: { durationMs: 10, tokenCount: 60, tokensPerSecond: 10, promptTokens: 180, totalTokens: 240 },
      },
    ]);
    const agent = new Agent(provider, registry, permissions, 'System prompt', ['dummy_tool'], 10, 1000, 'test-agent');

    let finalStats: any;
    await agent.run('Multi-round run', undefined, (s) => { finalStats = s; });

    check('CSM.15a', finalStats !== undefined, 'stats emitted');
    // Round 1 totalTokens: 150, Round 2 totalTokens: 240 -> cumulative totalTokens: 390
    check('CSM.15b', finalStats.totalTokens === 390, `totalTokens accumulates across rounds (expected 390, got ${finalStats?.totalTokens})`);
    check('CSM.15c', finalStats.tokenCount === 110, `tokenCount accumulates (expected 110, got ${finalStats?.tokenCount})`);
  }

  // Clean up
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpMemDir, { recursive: true, force: true });
  } catch {}

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
