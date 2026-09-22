/**
 * Test suite for Agent context scheduler integration (T22.8).
 *
 * Verifies:
 * - ACS.1: Context scheduler is disabled by default (no automatic delegation).
 * - ACS.2: Threshold validation at setter time (rejects invalid/unordered thresholds).
 * - ACS.3: Low pressure (< prepareAt) performs normal ReAct loop without action.
 * - ACS.4: Intermediate pressure (prepareAt <= ratio < delegateAt) prepares TaskPacket and emits event.
 * - ACS.5: Packet invalidation on completed tool execution round.
 * - ACS.6: Critical pressure (ratio >= delegateAt) triggers subagent runner with TaskPacket.
 * - ACS.7: Structured child status preservation (done, blocked, failed) without raw text fallback.
 * - ACS.8: Structured fallback on malformed or missing child agentResult.
 * - ACS.9: Report length bounding and truncation note when summary exceeds maxSummaryChars.
 * - ACS.10: Demarcation header and footer instructions on injected delegation report.
 * - ACS.11: Message ordering and tool_call/tool response integrity across delegation.
 * - ACS.12: Single automatic delegation per turn (anti-recursion) and child scheduler disabled.
 * - ACS.13: Non-blocking runner failure (warning logged, parent continues loop).
 * - ACS.14: Manual spawn_agent tool execution does not consume automatic delegation quota.
 * - ACS.15: ConfigManager integration and threshold validation.
 */

import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Agent } from '../src/core/agent';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { ContextTracker } from '../src/core/contextTracker';
import { AGENT_RESULT_DEFAULTS } from '../src/core/constants';
import { ConfigManager } from '../src/core/config/manager';
import type { ISubagentRunner, SubagentRunRequest, SubagentRunResult } from '../src/core/types';
import type { AgentEvent } from '../src/core/agentEvents';
import type { AgentResult } from '../src/core/agentResult';
import { createSubagentRunner } from '../src/core/subagentRunner';
import type { TaskPacket } from '../src/core/taskPacket';

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

class SpySubagentRunner implements ISubagentRunner {
  public calls: SubagentRunRequest[] = [];
  public customResult?: Partial<SubagentRunResult>;
  public shouldThrow = false;
  public throwError = new Error('Subagent runner internal error');

  constructor(customResult?: Partial<SubagentRunResult>) {
    this.customResult = customResult;
  }

  async run(request: SubagentRunRequest): Promise<SubagentRunResult> {
    this.calls.push(request);
    if (this.shouldThrow) {
      throw this.throwError;
    }

    const defaultAgentResult: AgentResult = {
      status: 'done',
      summary: 'Completed child objective successfully.',
      changes: ['src/index.ts modified'],
    };

    return {
      success: this.customResult?.success ?? true,
      output: this.customResult?.output ?? 'Raw child output',
      agentLabel: this.customResult?.agentLabel ?? 'child-worker',
      roleName: this.customResult?.roleName ?? 'developer',
      reportPath: this.customResult?.reportPath ?? 'runs/test-run/child-worker.md',
      agentResult: 'agentResult' in (this.customResult || {}) ? this.customResult?.agentResult : defaultAgentResult,
    };
  }
}

async function runTests(): Promise<void> {
  console.log('=== Agent Context Scheduler Tests (T22.8) ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-acs-home-'));
  const tmpMemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-acs-mem-'));
  process.env.TSUKA_HOME = tmpHome;
  process.env.TSUKA_MEMORY_FILE = path.join(tmpMemDir, 'memory.json');

  const permissions = new PermissionManager();

  // ---------------------------------------------------------------------------
  // 1. ACS.1: Disabled by default
  // ---------------------------------------------------------------------------
  console.log('--- 1. Disabled by default ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'Handled without delegation.' }]);
    const runner = new SpySubagentRunner();

    // maxHistoryTokens = 200, large prompt => pressure ratio > 0.9
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 200, 'test-agent');
    agent.setSubagentRunner(runner);

    check('ACS.1.1', agent.isContextSchedulerEnabled() === false, 'scheduler is disabled by default on Agent');
    const result = await agent.run('Very long user request that consumes most of the budget '.repeat(10));

    check('ACS.1.2', runner.calls.length === 0, 'subagent runner was not called when scheduler is disabled');
    check('ACS.1.3', result === 'Handled without delegation.', 'normal LLM response returned');
  }

  // ---------------------------------------------------------------------------
  // 2. ACS.2: Threshold validation at setter time
  // ---------------------------------------------------------------------------
  console.log('--- 2. Threshold validation at setter time ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([]);
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 1000, 'test-agent');

    const originalConfig = { ...agent.getContextSchedulerConfig() };

    let threwUnordered = false;
    try {
      agent.setContextScheduler({ enabled: true, prepareAt: 0.8, delegateAt: 0.6 });
    } catch (err: any) {
      threwUnordered = err.message.includes('strictly ordered');
    }
    check('ACS.2.1', threwUnordered, 'throws when prepareAt >= delegateAt');

    let threwNegative = false;
    try {
      agent.setContextScheduler({ enabled: true, prepareAt: -0.1, delegateAt: 0.7 });
    } catch (err: any) {
      threwNegative = err.message.includes('[0, 1]');
    }
    check('ACS.2.2', threwNegative, 'throws when prepareAt < 0');

    let threwExceedsOne = false;
    try {
      agent.setContextScheduler({ enabled: true, prepareAt: 0.5, delegateAt: 1.2 });
    } catch (err: any) {
      threwExceedsOne = err.message.includes('[0, 1]');
    }
    check('ACS.2.3', threwExceedsOne, 'throws when delegateAt > 1');

    let threwNaN = false;
    try {
      agent.setContextScheduler({ enabled: true, prepareAt: NaN, delegateAt: 0.7 });
    } catch (err: any) {
      threwNaN = err.message.includes('finite number');
    }
    check('ACS.2.4', threwNaN, 'throws when prepareAt is NaN');

    check(
      'ACS.2.5',
      agent.getContextSchedulerConfig().prepareAt === originalConfig.prepareAt &&
        agent.getContextSchedulerConfig().delegateAt === originalConfig.delegateAt,
      'original config remains unchanged after validation errors'
    );
  }

  // ---------------------------------------------------------------------------
  // 3. ACS.3: Low pressure (< prepareAt) performs normal ReAct loop
  // ---------------------------------------------------------------------------
  console.log('--- 3. Low pressure ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'Low pressure response.' }]);
    const runner = new SpySubagentRunner();
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 10000, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.6, delegateAt: 0.8 });

    const events: AgentEvent[] = [];
    const result = await agent.run('Short prompt', undefined, undefined, (ev) => events.push(ev));

    check('ACS.3.1', runner.calls.length === 0, 'no delegation under low pressure');
    check('ACS.3.2', !events.some((e) => e.type === 'context_action'), 'no context_action event emitted');
    check('ACS.3.3', result === 'Low pressure response.', 'LLM response returned');
  }

  // ---------------------------------------------------------------------------
  // 4. ACS.4: Intermediate pressure (prepareAt <= ratio < delegateAt)
  // ---------------------------------------------------------------------------
  console.log('--- 4. Intermediate pressure (prepare) ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'Response after prepare.' }]);
    const runner = new SpySubagentRunner();

    // With staticCharsPerToken ~ 3.5, 100 chars ~ 29 tokens.
    // Set maxHistoryTokens so ratio falls between 0.50 and 0.70.
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 100, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.20, delegateAt: 0.85 });

    const events: AgentEvent[] = [];
    const trackerBeforeCount = ContextTracker.getInstance().getAll().length;
    const result = await agent.run('A moderate prompt that lands in prepare window '.repeat(4), undefined, undefined, (ev) => events.push(ev));

    const prepareEvents = events.filter((e) => e.type === 'context_action' && (e as any).action === 'prepare');
    check('ACS.4.1', prepareEvents.length === 1, 'emitted exactly one context_action: prepare event');
    check('ACS.4.2', runner.calls.length === 0, 'subagent runner was not called on prepare');

    const trackerEntries = ContextTracker.getInstance().getAll();
    const hasPrepareEntry = trackerEntries.slice(trackerBeforeCount).some((e) => e.action === 'context_scheduler:prepare');
    check('ACS.4.3', hasPrepareEntry, 'recorded context_scheduler:prepare action in ContextTracker');
    check('ACS.4.4', result === 'Response after prepare.', 'LLM proceeds to finish the turn');
  }

  // ---------------------------------------------------------------------------
  // 5. ACS.5 & ACS.6: Critical pressure triggers delegate with TaskPacket
  // ---------------------------------------------------------------------------
  console.log('--- 5. Critical pressure triggers delegate ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([
      // First round: delegation triggers before chatWithTools, injects report, then LLM completes turn
      { content: 'Final response incorporating child findings.' },
    ]);
    const runner = new SpySubagentRunner({
      agentResult: {
        status: 'done',
        summary: 'Analyzed codebase and fixed vulnerability.',
        changes: ['src/core/auth.ts'],
        decisions: ['Use HMAC-SHA256'],
      },
    });

    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 100, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.20, delegateAt: 0.30 });

    const events: AgentEvent[] = [];
    const trackerBeforeCount = ContextTracker.getInstance().getAll().length;
    const result = await agent.run('High pressure prompt requesting architecture analysis '.repeat(4), undefined, undefined, (ev) => events.push(ev));

    check('ACS.6.1', runner.calls.length === 1, 'subagent runner was invoked exactly once');
    const delegateCall = runner.calls[0];
    check('ACS.6.2', delegateCall.expectAgentResult === true, 'runner requested expectAgentResult: true');
    check('ACS.6.3', delegateCall.throwOnError === true, 'runner requested throwOnError: true');

    const task = delegateCall.task as TaskPacket;
    check('ACS.6.4', typeof task === 'object' && typeof task.objective === 'string', 'task is a structured TaskPacket');
    check('ACS.6.5', task.objective.includes('High pressure prompt'), 'task objective contains prompt objective');

    const delegateEvents = events.filter((e) => e.type === 'context_action' && (e as any).action === 'delegate');
    check('ACS.6.6', delegateEvents.length === 1, 'emitted context_action: delegate event');

    const trackerEntries = ContextTracker.getInstance().getAll();
    const hasDelegateEntry = trackerEntries.slice(trackerBeforeCount).some((e) => e.action === 'context_scheduler:delegate');
    check('ACS.6.7', hasDelegateEntry, 'recorded context_scheduler:delegate in ContextTracker');

    check('ACS.6.8', result === 'Final response incorporating child findings.', 'parent completes after delegation');
  }

  // ---------------------------------------------------------------------------
  // 6. ACS.5: Packet invalidation on completed tool round
  // ---------------------------------------------------------------------------
  console.log('--- 6. Packet invalidation on completed tool round ---');
  {
    const registry = new ToolRegistry();
    registry.register({
      name: 'dummy_tool',
      riskLevel: 'SAFE',
      schema: {
        description: 'Dummy tool for testing round transitions',
        schema: { type: 'object', properties: {} },
        requiredTier: 'small',
      },
      execute: async () => 'tool result content '.repeat(40),
    });

    const runner = new SpySubagentRunner({
      agentResult: {
        status: 'done',
        summary: 'Finished post-tool delegate task.',
      },
    });

    const provider = new MockLLMProvider([
      // Round 1: Model calls dummy_tool
      { toolCalls: [mockToolCall('dummy_tool', {})] },
      // Round 2: After tool execution and message push, pressure triggers delegation, then parent finishes
      { content: 'Done after tool round and delegation.' },
    ]);

    // Thresholds: prepareAt = 0.10, delegateAt = 0.40
    // On round 1: prompt has ~60 tokens / 500 = ~0.12 -> prepare triggered.
    // Tool runs -> adds 800 chars tool message -> ratio jumps over 0.40 -> delegate triggered.
    const agent = new Agent(provider, registry, permissions, 'System prompt', ['dummy_tool'], 10, 500, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.40 });

    await agent.run('Run dummy tool then complete work');

    check('ACS.5.1', runner.calls.length === 1, 'runner was called after tool execution');
    const task = runner.calls[0]?.task as TaskPacket;
    check('ACS.5.2', !!task && Array.isArray(task.constraints), 'task packet has constraints');
    const toolRoundConstraint = (task?.constraints || []).some((c) => c.includes('Completed 1 tool execution round(s)'));
    check('ACS.5.3', toolRoundConstraint, 'prepared packet was invalidated and rebuilt with updated tool rounds constraint');
  }

  // ---------------------------------------------------------------------------
  // 7. ACS.7: Structured child status preservation (blocked / failed)
  // ---------------------------------------------------------------------------
  console.log('--- 7. Status preservation without raw text leakage ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'Handled blocked child.' }]);
    const runner = new SpySubagentRunner({
      output: 'Arbitrary raw child text that must NOT leak into parent prompt',
      agentResult: {
        status: 'blocked',
        summary: 'Cannot proceed: missing database credentials.',
        unresolved: ['Need DB_PASSWORD environment variable'],
      },
    });

    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 50, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.20 });

    await agent.run('Analyze database connection in detail '.repeat(3));

    const parentMessages = agent.getMessages();
    const reportMsg = parentMessages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[SUBAGENT DELEGATION REPORT')
    );

    check('ACS.7.1', !!reportMsg, 'delegation report message was injected into parent history');
    const content = reportMsg?.content as string;
    check('ACS.7.2', content.includes('Status: BLOCKED'), 'status BLOCKED is preserved in parent report header');
    check('ACS.7.3', content.includes('Cannot proceed: missing database credentials.'), 'summary is formatted in report');
    check('ACS.7.4', content.includes('Need DB_PASSWORD environment variable'), 'unresolved items are formatted');
    check(
      'ACS.7.5',
      !content.includes('Arbitrary raw child text that must NOT leak'),
      'arbitrary raw output text is NOT leaked into parent message'
    );
  }

  // ---------------------------------------------------------------------------
  // 8. ACS.8: Structured fallback on malformed or missing child agentResult
  // ---------------------------------------------------------------------------
  console.log('--- 8. Structured fallback on malformed child result ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'Handled missing child result.' }]);
    const runner = new SpySubagentRunner({
      output: 'Some raw stream output',
      agentResult: undefined, // Missing agentResult
    });

    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 50, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.20 });

    await agent.run('Task triggering malformed child result in detail '.repeat(3));

    const parentMessages = agent.getMessages();
    const reportMsg = parentMessages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[SUBAGENT DELEGATION REPORT')
    );

    check('ACS.8.1', !!reportMsg, 'report message exists even when child agentResult is undefined');
    const content = reportMsg?.content as string;
    check('ACS.8.2', content.includes('Status: FAILED'), 'status is typed FAILED on fallback');
    check('ACS.8.3', !content.includes('Some raw stream output'), 'raw output is not leaked on fallback');
  }

  // ---------------------------------------------------------------------------
  // 9. ACS.9: Report length bounding and truncation note
  // ---------------------------------------------------------------------------
  console.log('--- 9. Report length bounding ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'Handled truncated child result.' }]);
    const runner = new SpySubagentRunner({
      reportPath: 'runs/test-run/child-worker.md',
      agentResult: {
        status: 'done',
        summary: 'x'.repeat(3000),
        changes: Array.from({ length: 20 }, (_, i) => `Change ${i}: ${'y'.repeat(100)}`),
        unresolved: ['Critical remaining task: apply database migration'],
      },
    });

    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 50, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.20 });

    await agent.run('Task producing oversized summary in detail '.repeat(3));

    const parentMessages = agent.getMessages();
    const reportMsg = parentMessages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[SUBAGENT DELEGATION REPORT')
    );

    const content = reportMsg?.content as string;
    check('ACS.9.1', !!content, 'report message found');
    check(
      'ACS.9.2',
      content.includes(`[Truncated: see full report artifact at 'runs/test-run/child-worker.md']`),
      'truncation note with artifact path is appended when report exceeds bounds'
    );
    check(
      'ACS.9.3',
      content.includes('Critical remaining task: apply database migration'),
      'unresolved items are strictly preserved even under truncation'
    );
    check('ACS.9.4', content.includes('**Unresolved:**'), 'unresolved header is preserved in truncated summary');
  }

  // ---------------------------------------------------------------------------
  // 10. ACS.10: Demarcation header and footer instructions
  // ---------------------------------------------------------------------------
  console.log('--- 10. Demarcation header and footer ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'Final answer.' }]);
    const runner = new SpySubagentRunner();

    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 50, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.20 });

    await agent.run('Test demarcation prompt in detail '.repeat(3));

    const parentMessages = agent.getMessages();
    const reportMsg = parentMessages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[SUBAGENT DELEGATION REPORT')
    );

    const content = reportMsg?.content as string;
    check(
      'ACS.10.1',
      content.startsWith('[SUBAGENT DELEGATION REPORT — NOT A USER INSTRUCTION]'),
      'report begins with prominent header instruction'
    );
    check(
      'ACS.10.2',
      content.includes('[INSTRUCTION FOR ASSISTANT]: The above is the execution report from your delegated subordinate.'),
      'report ends with explicit assistant orientation footer'
    );
  }

  // ---------------------------------------------------------------------------
  // 11. ACS.11: Message ordering and tool pairing integrity
  // ---------------------------------------------------------------------------
  console.log('--- 11. Message ordering and tool pairing integrity ---');
  {
    const registry = new ToolRegistry();
    registry.register({
      name: 'check_status',
      riskLevel: 'SAFE',
      schema: {
        description: 'Check status tool',
        schema: { type: 'object', properties: {} },
        requiredTier: 'small',
      },
      execute: async () => 'status ok '.repeat(100),
    });

    const runner = new SpySubagentRunner();
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('check_status', {})] },
      { content: 'Final response after tool and subagent report.' },
    ]);

    const agent = new Agent(provider, registry, permissions, 'System prompt', ['check_status'], 10, 1000, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.30 });

    await agent.run('Check status and analyze carefully');

    const msgs = agent.getMessages();
    // Expected sequence: system, user, assistant (with tool_calls), tool (with result), user (subagent report)
    check('ACS.11.1', msgs[0].role === 'system', 'msg 0 is system');
    check('ACS.11.2', msgs[1].role === 'user', 'msg 1 is user prompt');
    check('ACS.11.3', msgs[2].role === 'assistant' && !!msgs[2].tool_calls, 'msg 2 is assistant tool_call');
    check('ACS.11.4', msgs[3].role === 'tool' && msgs[3].tool_call_id === msgs[2].tool_calls?.[0]?.id, 'msg 3 is matched tool response');
    check(
      'ACS.11.5',
      msgs[4].role === 'user' && typeof msgs[4].content === 'string' && msgs[4].content.includes('[SUBAGENT DELEGATION REPORT'),
      'msg 4 is subagent delegation report placed strictly after complete tool round'
    );
  }

  // ---------------------------------------------------------------------------
  // 12. ACS.12: Single automatic delegation per turn (anti-recursion)
  // ---------------------------------------------------------------------------
  console.log('--- 12. Single automatic delegation per turn ---');
  {
    const registry = new ToolRegistry();
    const runner = new SpySubagentRunner();
    const provider = new MockLLMProvider([
      // LLM call after first delegation
      { content: 'Successfully synthesized report.' },
    ]);

    // Pressure will remain > delegateAt for the entire turn
    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 50, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.20 });

    await agent.run('Prompt causing persistent high pressure in detail '.repeat(3));

    check('ACS.12.1', runner.calls.length === 1, 'max 1 automatic delegation executed in a single Agent.run()');
  }

  // ---------------------------------------------------------------------------
  // 13. ACS.13: Non-blocking runner failure
  // ---------------------------------------------------------------------------
  console.log('--- 13. Non-blocking runner failure ---');
  {
    const registry = new ToolRegistry();
    const runner = new SpySubagentRunner();
    runner.shouldThrow = true;
    runner.throwError = new Error('Simulated runner container crash');

    const provider = new MockLLMProvider([
      // When delegation fails, parent continues to LLM
      { content: 'Parent recovered and finished work directly.' },
    ]);

    const agent = new Agent(provider, registry, permissions, 'System prompt', [], 10, 50, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.20 });

    let didThrow = false;
    let result = '';
    try {
      result = await agent.run('Prompt triggering failing runner in detail '.repeat(3));
    } catch {
      didThrow = true;
    }

    check('ACS.13.1', !didThrow, 'agent does not crash when subagent runner throws');
    check('ACS.13.2', result === 'Parent recovered and finished work directly.', 'parent continues and completes turn');
  }

  // ---------------------------------------------------------------------------
  // 14. ACS.14: Manual spawn_agent does not consume automatic delegation quota
  // ---------------------------------------------------------------------------
  console.log('--- 14. Manual tool does not consume quota ---');
  {
    const registry = new ToolRegistry();
    registry.register({
      name: 'spawn_agent',
      riskLevel: 'SAFE',
      schema: {
        description: 'Manual spawn agent tool',
        schema: { type: 'object', properties: {} },
        requiredTier: 'small',
      },
      execute: async () => 'manual child artifact: runs/manual.md '.repeat(20),
    });

    const runner = new SpySubagentRunner();
    const provider = new MockLLMProvider([
      // Round 1: Manual spawn_agent tool call
      { toolCalls: [mockToolCall('spawn_agent', {})] },
      // Round 2: After manual tool call, automatic delegation still happens when critical pressure reached
      { content: 'Done after manual tool and automatic delegation.' },
    ]);

    const agent = new Agent(provider, registry, permissions, 'System prompt', ['spawn_agent'], 10, 500, 'test-agent');
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.40 });

    await agent.run('Call manual spawn then continue');

    check('ACS.14.1', runner.calls.length === 1, 'automatic delegation was performed despite prior manual tool call');
  }

  // ---------------------------------------------------------------------------
  // 15. ACS.15: ConfigManager integration
  // ---------------------------------------------------------------------------
  console.log('--- 15. ConfigManager integration ---');
  {
    const cm = new ConfigManager();
    check('ACS.15.1', cm.isContextSchedulerEnabled() === false, 'ConfigManager defaults contextSchedulerEnabled to false');

    const config = cm.getContextSchedulerConfig();
    check('ACS.15.2', typeof config.prepareAt === 'number' && typeof config.delegateAt === 'number', 'config has numeric thresholds');
    check('ACS.15.3', config.prepareAt < config.delegateAt, 'default thresholds are strictly ordered');
  }

  // ---------------------------------------------------------------------------
  // 16. ACS.16: Role and tool perimeter preservation during delegation
  // ---------------------------------------------------------------------------
  console.log('--- 16. Role and tool perimeter preservation ---');
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'Audit complete.' }]);
    const runner = new SpySubagentRunner({
      reportPath: 'runs/test-run/auditor-child.md',
      agentResult: {
        status: 'done',
        summary: 'Defensive security audit completed with no findings.',
      },
    });

    const parentTools = ['audit_code', 'read_file', 'grep_search'];
    const agent = new Agent(provider, registry, permissions, 'Security auditor prompt', parentTools, 10, 50, 'security_auditor');
    agent.setRoleName('security_auditor');
    agent.setDeferredTools(['list_dir']);
    agent.setSubagentRunner(runner);
    agent.setContextScheduler({ enabled: true, prepareAt: 0.10, delegateAt: 0.20 });

    await agent.run('Audit codebase for vulnerabilities '.repeat(3));

    check('ACS.16.1', runner.calls.length === 1, 'delegation was triggered');
    const req = runner.calls[0];
    check('ACS.16.2', req.roleName === 'security_auditor', 'child inherits parent roleName (does not default to developer)');
    check('ACS.16.3', Array.isArray(req.allowedTools), 'child request specifies allowedTools perimeter');
    const perimeter = new Set(req.allowedTools);
    check('ACS.16.4', perimeter.has('audit_code') && perimeter.has('read_file') && perimeter.has('list_dir'), 'perimeter includes parent active and deferred tools');
    check('ACS.16.5', !perimeter.has('execute_command') && !perimeter.has('delete_file'), 'perimeter excludes dangerous tools not granted to parent');

    // Test DefaultSubagentRunner enforces the perimeter on child agent instantiation
    const freshProvider = new MockLLMProvider([{ content: 'Child audit response.' }]);
    const runtimeRunner = createSubagentRunner({
      provider: freshProvider,
      registry,
      permissionManager: permissions,
      configManager: new ConfigManager(),
      eventSink: () => {},
    });

    // Provide allowedTools restricting to safe read tools only
    const subResult = await runtimeRunner.run({
      task: 'Check security',
      roleName: 'developer', // developer normally has execute_command and delete_file
      allowedTools: ['read_file', 'grep_search'], // restricted perimeter
      expectAgentResult: false,
      throwOnError: false,
    });
    check('ACS.16.6', subResult.success === true, 'subagent ran with filtered tool perimeter');
  }

  // Cleanup
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpMemDir, { recursive: true, force: true });
  } catch {}

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
