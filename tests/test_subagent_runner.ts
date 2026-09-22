/**
 * Test suite for SubagentRunner (T22.7).
 *
 * Verifies:
 * - Dependency validation in runner construction
 * - Execution with raw string tasks
 * - Execution with structured TaskPacket briefings
 * - Structured AgentResult parsing when requested (expectAgentResult)
 * - Safe fallback / absence of fake AgentResult when not requested
 * - Typed lifecycle events (subagent_start, subagent_end)
 * - Event, chunk, and stat stream forwarding
 * - Error handling with typed failure result vs throwOnError
 * - Run artifact generation in runs/
 * - Blackboard note posting inside active runs
 * - Memory isolation with persistMemory: false
 */

import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultSubagentRunner, createSubagentRunner } from '../src/core/subagentRunner';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { Blackboard } from '../src/core/blackboard';
import { createTaskPacket } from '../src/core/taskPacket';
import { serializeAgentResult } from '../src/core/agentResult';
import { Agent } from '../src/core/agent';
import { spawnAgentTool } from '../src/tools/impl/spawnAgent';
import type { ChatStats } from '../src/core/provider';
import type { ISubagentRunner } from '../src/core/types';

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

async function runTests(): Promise<void> {
  console.log('=== SubagentRunner Tests (T22.7) ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-subrunner-home-'));
  const tmpMemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-subrunner-mem-'));
  process.env.TSUKA_HOME = tmpHome;
  process.env.TSUKA_MEMORY_FILE = path.join(tmpMemDir, 'memory.json');

  const registry = new ToolRegistry();
  registry.register(spawnAgentTool);
  const permissions = new PermissionManager();

  // ---------------------------------------------------------------------------
  // 1. Dependency Validation
  // ---------------------------------------------------------------------------
  console.log('--- 1. Dependency Validation ---');
  let threwNoProvider = false;
  try {
    new DefaultSubagentRunner({ provider: null as any, registry });
  } catch {
    threwNoProvider = true;
  }
  check('SR1.1', threwNoProvider, 'throws when provider is missing');

  let threwNoRegistry = false;
  try {
    new DefaultSubagentRunner({ provider: new MockLLMProvider([]), registry: null as any });
  } catch {
    threwNoRegistry = true;
  }
  check('SR1.2', threwNoRegistry, 'throws when registry is missing');

  // ---------------------------------------------------------------------------
  // 2. Raw String Task Execution & Forwarding
  // ---------------------------------------------------------------------------
  console.log('--- 2. Raw String Task Execution ---');
  const mockChunks: Array<{ chunk: string; author?: string }> = [];
  const mockStats: Array<{ stats: ChatStats; label?: string }> = [];
  const mockEvents: any[] = [];

  const provider1 = new MockLLMProvider([
    {
      content: 'Refactored module successfully.',
      stats: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
    },
  ]);

  const runner = createSubagentRunner({
    provider: provider1,
    registry,
    permissionManager: permissions,
  });

  const runResult1 = await runner.run(
    {
      task: 'Refactor auth module',
      roleName: 'developer',
      persistMemory: false,
    },
    {
      onChunk: (chunk, _channel, author) => mockChunks.push({ chunk, author }),
      onStats: (stats, label) => mockStats.push({ stats, label }),
      onEvent: (ev) => mockEvents.push(ev),
    }
  );

  check('SR2.1', runResult1.success === true, 'runner completed successfully');
  check('SR2.2', runResult1.agentLabel === 'developer', 'returned correct agentLabel');
  check('SR2.3', runResult1.roleName === 'developer', 'returned correct roleName');
  check('SR2.4', runResult1.output === 'Refactored module successfully.', 'captured complete child output');
  check('SR2.5', !!runResult1.reportPath && fs.existsSync(path.join(tmpHome, runResult1.reportPath)), 'saved report artifact on disk');
  check('SR2.6', runResult1.agentResult === undefined, 'did not fabricate AgentResult for free-text task');
  check('SR2.7', mockEvents.some((e) => e.type === 'subagent_start' && e.name === 'developer'), 'emitted subagent_start event');
  check('SR2.8', mockEvents.some((e) => e.type === 'subagent_end' && e.success === true), 'emitted subagent_end event');
  check('SR2.9', mockStats.some((s) => s.label === 'developer' && s.stats.totalTokens === 165), 'forwarded stats attributed to subagent');

  // ---------------------------------------------------------------------------
  // 3. Structured TaskPacket Execution (Unstructured Output)
  // ---------------------------------------------------------------------------
  console.log('--- 3. TaskPacket Execution ---');
  const packet1 = createTaskPacket('Implement rate limiter', {
    constraints: ['No external Redis', 'In-memory token bucket'],
    acceptanceCriteria: ['Pass unit tests'],
  });

  let receivedTaskPrompt = '';
  const inspectProvider = new MockLLMProvider([
    {
      content: 'Rate limiter implemented.',
    },
  ]);

  const runnerPacket = createSubagentRunner({
    provider: inspectProvider,
    registry,
    permissionManager: permissions,
  });

  const runResult2 = await runnerPacket.run({
    task: packet1,
    roleName: 'developer',
    persistMemory: false,
  });

  check('SR3.1', runResult2.success === true, 'TaskPacket execution completed successfully');
  check('SR3.2', runResult2.agentResult === undefined, 'leaves agentResult undefined when expectAgentResult is false');

  const history = inspectProvider.callLog;
  const lastCall = history[0];
  const lastUserMsg = lastCall?.messages?.find((m: any) => m.role === 'user');
  check('SR3.3', !!lastUserMsg && String(lastUserMsg.content).includes('# Objective\nImplement rate limiter'), 'briefing formatted objective');
  check('SR3.4', !!lastUserMsg && String(lastUserMsg.content).includes('# Constraints\n- No external Redis'), 'briefing formatted constraints');
  check('SR3.5', !!lastUserMsg && String(lastUserMsg.content).includes('# Acceptance Criteria\n- Pass unit tests'), 'briefing formatted acceptance criteria');

  // ---------------------------------------------------------------------------
  // 4. expectAgentResult: true with Structured Output
  // ---------------------------------------------------------------------------
  console.log('--- 4. expectAgentResult with Valid AgentResult ---');
  const expectedAgentResult = {
    status: 'done' as const,
    summary: 'Rate limiter implemented and tested.',
    changes: ['src/rateLimiter.ts'],
    decisions: ['Used token bucket algorithm'],
    evidence: { files: ['src/rateLimiter.ts'], tests: ['test_rate_limiter.ts'] },
  };

  const structuredProvider = new MockLLMProvider([
    {
      content: `Here is my report:\n\`\`\`json\n${serializeAgentResult(expectedAgentResult)}\n\`\`\``,
    },
  ]);

  const runnerStructured = createSubagentRunner({
    provider: structuredProvider,
    registry,
    permissionManager: permissions,
  });

  const runResult3 = await runnerStructured.run({
    task: packet1,
    roleName: 'developer',
    expectAgentResult: true,
    persistMemory: false,
  });

  check('SR4.1', runResult3.success === true, 'structured run succeeded');
  check('SR4.2', !!runResult3.agentResult, 'parsed agentResult present');
  check('SR4.3', runResult3.agentResult?.status === 'done', 'agentResult has done status');
  check('SR4.4', runResult3.agentResult?.summary === expectedAgentResult.summary, 'agentResult has matching summary');
  check('SR4.5', runResult3.agentResult?.changes?.[0] === 'src/rateLimiter.ts', 'agentResult has matching changes');

  // ---------------------------------------------------------------------------
  // 5. expectAgentResult: true with Malformed / Prose Output (Fail-Closed)
  // ---------------------------------------------------------------------------
  console.log('--- 5. expectAgentResult with Malformed Output ---');
  const malformedProvider = new MockLLMProvider([
    {
      content: 'I did not follow the JSON formatting instruction at all.',
    },
  ]);

  const runnerMalformed = createSubagentRunner({
    provider: malformedProvider,
    registry,
    permissionManager: permissions,
  });

  const runResult4 = await runnerMalformed.run({
    task: 'Some task',
    expectAgentResult: true,
    persistMemory: false,
  });

  check('SR5.1', runResult4.success === true, 'runner completed turn');
  check('SR5.2', !!runResult4.agentResult, 'agentResult fallback constructed');
  check('SR5.3', runResult4.agentResult?.status === 'failed', 'fallback status is failed');
  check('SR5.4', Array.isArray(runResult4.agentResult?.unresolved), 'fallback includes unresolved information');

  // ---------------------------------------------------------------------------
  // 6. Error Handling: Typed Failure vs throwOnError
  // ---------------------------------------------------------------------------
  console.log('--- 6. Error Handling ---');
  const failingProvider = new MockLLMProvider([
    {
      error: { message: 'Network connection reset by peer' },
    },
  ]);

  const runnerFailing = createSubagentRunner({
    provider: failingProvider,
    registry,
    permissionManager: permissions,
  });

  // 6.1 Default throwOnError: false
  const runResult5 = await runnerFailing.run({
    task: 'Network task',
    persistMemory: false,
  });

  check('SR6.1', runResult5.success === false, 'runner returns success: false');
  check('SR6.2', runResult5.output.includes('Network connection reset'), 'output includes error message');
  check('SR6.3', runResult5.error !== undefined, 'error object returned on typed failure');

  // 6.2 throwOnError: true
  const throwingProvider = new MockLLMProvider([
    {
      error: { message: 'Network connection reset by peer' },
    },
  ]);
  const runnerThrowing = createSubagentRunner({
    provider: throwingProvider,
    registry,
    permissionManager: permissions,
  });

  let didThrow = false;
  try {
    await runnerThrowing.run({
      task: 'Network task',
      throwOnError: true,
      persistMemory: false,
    });
  } catch (err: any) {
    didThrow = true;
    check('SR6.4', err.message.includes('Network connection reset'), 're-throws error when throwOnError is true');
  }
  check('SR6.5', didThrow, 'throwOnError: true re-throws execution error');

  // ---------------------------------------------------------------------------
  // 7. Blackboard Run Integration
  // ---------------------------------------------------------------------------
  console.log('--- 7. Blackboard Run Integration ---');
  const bbProvider = new MockLLMProvider([
    { content: 'Done work in blackboard.' },
  ]);
  const runnerBB = createSubagentRunner({
    provider: bbProvider,
    registry,
    permissionManager: permissions,
  });

  const runId = Blackboard.newRunId();
  try {
    await Blackboard.withRun(runId, async () => {
      const bb = Blackboard.current();
      check('SR7.1', !!bb, 'active blackboard found');
      const bbResult = await runnerBB.run({
        task: 'Team task',
        roleName: 'developer',
      });
      check('SR7.2', bbResult.success === true, 'subagent in blackboard succeeded');
      const notes = bb!.read();
      const artifactNote = notes.find((n) => n.key === 'artefatto-sub-agente');
      check('SR7.3', !!artifactNote, 'posted artefatto-sub-agente note to blackboard');
      check('SR7.4', artifactNote?.value === bbResult.reportPath, 'note value matches reportPath');
    });
  } finally {
    Blackboard.endRun(runId);
  }

  // ---------------------------------------------------------------------------
  // 8. Memory Isolation
  // ---------------------------------------------------------------------------
  console.log('--- 8. Memory Isolation ---');
  const memIsolationProvider = new MockLLMProvider([
    { content: 'Task without memory pollution.' },
  ]);
  const runnerIsolated = createSubagentRunner({
    provider: memIsolationProvider,
    registry,
    permissionManager: permissions,
  });

  const isolatedMemFile = process.env.TSUKA_MEMORY_FILE!;
  const memExistsBefore = fs.existsSync(isolatedMemFile);
  await runnerIsolated.run({
    task: 'Isolated task',
    persistMemory: false,
  });
  const memExistsAfter = fs.existsSync(isolatedMemFile);
  check('SR8.1', memExistsBefore === memExistsAfter, 'persistMemory: false did not create or mutate memory file');

  // ---------------------------------------------------------------------------
  // 9. Pipeline Runner Injection to spawn_agent (Issue 1)
  // ---------------------------------------------------------------------------
  console.log('--- 9. Pipeline Runner Injection to spawn_agent ---');
  let customRunnerCalls = 0;
  const mockCustomRunner: ISubagentRunner = {
    async run(req, ctx) {
      customRunnerCalls++;
      return {
        success: true,
        output: 'Custom runner handled delegation.',
        agentLabel: 'custom-subagent',
        roleName: req.roleName || 'developer',
        reportPath: 'runs/test/custom.md',
      };
    },
  };

  const toolExecResult = await spawnAgentTool.execute(
    { task: 'Delegate to subagent' },
    {
      provider: provider1,
      registry,
      permissionManager: permissions,
      subagentRunner: mockCustomRunner,
    }
  );
  check('SR9.1', customRunnerCalls === 1, 'spawnAgentTool executed injected subagentRunner');
  check('SR9.2', toolExecResult.includes('Custom runner handled delegation'), 'spawnAgentTool returns custom runner output');

  const agentWithRunner = new Agent(
    new MockLLMProvider([
      {
        toolCalls: [mockToolCall('spawn_agent', { task: 'Subtask from parent agent' })],
      },
      {
        content: 'Parent agent acknowledged subagent completion.',
      },
    ]),
    registry,
    permissions,
    'Parent system prompt',
    ['spawn_agent']
  );
  agentWithRunner.setSubagentRunner(mockCustomRunner);
  await agentWithRunner.run('Please spawn a subagent');
  check('SR9.3', customRunnerCalls === 2, 'Agent.run forwarded subagentRunner into spawn_agent tool round');

  // ---------------------------------------------------------------------------
  // 10. Fallback Error Bounding with expectAgentResult (Issue 2)
  // ---------------------------------------------------------------------------
  console.log('--- 10. Fallback Error Bounding (Issue 2) ---');
  const hugeErrorMessage = 'CRITICAL_FAILURE_'.repeat(100); // 1,700 chars (> 1000 maxItemChars)
  const hugeErrorProvider = new MockLLMProvider([
    {
      error: { message: hugeErrorMessage },
    },
  ]);
  const runnerWithHugeError = createSubagentRunner({
    provider: hugeErrorProvider,
    registry,
    permissionManager: permissions,
  });

  let hugeErrorResult: any;
  let hugeErrorThrew = false;
  try {
    hugeErrorResult = await runnerWithHugeError.run({
      task: 'Task with huge error',
      expectAgentResult: true,
      throwOnError: false,
      persistMemory: false,
    });
  } catch {
    hugeErrorThrew = true;
  }
  check('SR10.1', !hugeErrorThrew, 'runner does not throw when error exceeds item limit with expectAgentResult');
  check('SR10.2', hugeErrorResult?.success === false, 'runner returns success: false for huge error');
  check('SR10.3', !!hugeErrorResult?.agentResult, 'constructed agentResult fallback is present');
  check('SR10.4', hugeErrorResult?.agentResult?.status === 'failed', 'fallback status is failed');
  check('SR10.5', (hugeErrorResult?.agentResult?.unresolved?.[0]?.length ?? 0) <= 1000, 'unresolved error detail is bounded within maxItemChars (<= 1000)');

  // ---------------------------------------------------------------------------
  // 11. Atomic Finalization on Persistence Failure (Issue 3)
  // ---------------------------------------------------------------------------
  console.log('--- 11. Atomic Finalization on Persistence Failure (Issue 3) ---');
  const successProvider = new MockLLMProvider([
    { content: 'Work done successfully before write failure.' },
  ]);
  const runnerForWriteFailure = createSubagentRunner({
    provider: successProvider,
    registry,
    permissionManager: permissions,
  });

  const capturedEvents: any[] = [];
  const badRunId = 'invalid:path/with\0badchars';
  let writeFailThrew = false;
  let writeFailResult: any;
  try {
    writeFailResult = await runnerForWriteFailure.run(
      {
        task: 'Task with un-persistable path',
        runId: badRunId,
        throwOnError: false,
        persistMemory: false,
      },
      {
        onEvent: (ev) => capturedEvents.push(ev),
      }
    );
  } catch {
    writeFailThrew = true;
  }
  check('SR11.1', !writeFailThrew, 'persistence error does not throw unhandled exception when throwOnError is false');
  check('SR11.2', writeFailResult?.success === false, 'runner returns success: false on persistence error');
  const subagentEndEvents = capturedEvents.filter((ev) => ev.type === 'subagent_end');
  check('SR11.3', subagentEndEvents.length === 1, 'emitted exactly one subagent_end event');
  check('SR11.4', subagentEndEvents[0]?.success === false, 'subagent_end reports success: false instead of false-positive true');

  console.log(`\n=== SubagentRunner Test Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled failure in SubagentRunner test suite:', err);
  process.exit(1);
});
