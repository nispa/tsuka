/**
 * Regression coverage for bounded recovery from incomplete write_file calls (T23.14).
 *
 * Verifies:
 * - Comprehensive validation feedback listing all missing required parameters.
 * - Recovery flow: validation error -> corrected call -> successful file commit.
 * - Bounded loop termination when consecutive validation errors reach max threshold.
 * - Unchanged destination file after validation failures and aborts.
 * - Safe offset and staging preservation in resumable writes across validation errors.
 * - Counter isolation between tools and resets on successful calls.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Agent } from '../src/core/agent';
import { AgentEvent } from '../src/core/agentEvents';
import { TOOLS_DEFAULTS } from '../src/core/constants';
import { MockLLMProvider } from './mocks/mockProvider';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { validateToolArgs } from '../src/tools/schema';
import { createWriteFileTool } from '../src/tools/impl/writeFile';

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

async function main(): Promise<void> {
  console.log('=== Bounded write_file recovery tests (T23.14) ===\n');

  const tmpRoot = fs.mkdtempSync(path.join(process.cwd(), '.smoke-wfr-'));
  const testFile = path.join(tmpRoot, 'output.txt');

  try {
    // -------------------------------------------------------------------------
    // 1. Validation error message completeness
    // -------------------------------------------------------------------------
    console.log('--- 1. Validation Error Feedback Completeness ---');
    const writeSchema = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    };

    const errBoth = validateToolArgs({}, writeSchema, 'write_file');
    check(
      'WFR.1a',
      errBoth !== null && errBoth.includes("'path'") && errBoth.includes("'content'") && errBoth.includes('together in every call'),
      'reports both missing required parameters together when none are provided'
    );

    const errPathOnly = validateToolArgs({ content: 'data' }, writeSchema, 'write_file');
    check(
      'WFR.1b',
      errPathOnly !== null && errPathOnly.includes("Missing required parameter 'path'"),
      'reports single missing parameter path when content is provided'
    );

    const errContentOnly = validateToolArgs({ path: 'file.txt' }, writeSchema, 'write_file');
    check(
      'WFR.1c',
      errContentOnly !== null && errContentOnly.includes("Missing required parameter 'content'"),
      'reports single missing parameter content when path is provided'
    );

    // -------------------------------------------------------------------------
    // 2. Recovery flow in Agent loop: validation error -> corrected call -> saved
    // -------------------------------------------------------------------------
    console.log('--- 2. Recovery from Incomplete Call in Agent Loop ---');
    fs.writeFileSync(testFile, 'initial content', 'utf8');

    const registry = new ToolRegistry();
    registry.register(createWriteFileTool(), { alwaysAllow: true });
    const permissions = new PermissionManager();
    permissions.setAllowAllWrite(true);

    // Round 1: calls write_file missing 'content'
    // Round 2: receives error, calls write_file with both 'path' and 'content'
    // Round 3: completes with final text
    const provider = new MockLLMProvider([
      {
        content: null as any,
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ path: testFile }),
            },
          },
        ],
      },
      {
        content: null as any,
        toolCalls: [
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ path: testFile, content: 'corrected full content' }),
            },
          },
        ],
      },
      {
        content: 'File successfully written after correcting parameter omission.',
      },
    ]);

    const agent = new Agent(provider, registry, permissions, 'System prompt', ['write_file'], 10, 1000, 'test-agent');
    const result = await agent.run('Save corrected file content');

    check('WFR.2a', result.includes('File successfully written'), 'agent completes run after recovering from validation error');
    check('WFR.2b', fs.readFileSync(testFile, 'utf8') === 'corrected full content', 'file destination updated with corrected content');

    // -------------------------------------------------------------------------
    // 3. Bounded termination on consecutive validation errors
    // -------------------------------------------------------------------------
    console.log('--- 3. Bounded Termination on Repeated Validation Failures ---');
    fs.writeFileSync(testFile, 'untouched original', 'utf8');

    // Provider makes alternating invalid calls repeatedly
    const invalidCallsProvider = new MockLLMProvider([
      {
        content: null as any,
        toolCalls: [
          {
            id: 'call_inv_1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ path: testFile }), // missing content
            },
          },
        ],
      },
      {
        content: null as any,
        toolCalls: [
          {
            id: 'call_inv_2',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ content: 'orphan content' }), // missing path
            },
          },
        ],
      },
      {
        content: null as any,
        toolCalls: [
          {
            id: 'call_inv_3',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({}), // missing both
            },
          },
        ],
      },
      {
        content: 'Should not reach this point',
      },
    ]);

    const events: AgentEvent[] = [];
    const agentAborting = new Agent(invalidCallsProvider, registry, permissions, 'System prompt', ['write_file'], 10, 1000, 'test-agent');
    const abortResult = await agentAborting.run('Write file with repeated errors', undefined, undefined, (ev) => events.push(ev));

    check(
      'WFR.3a',
      abortResult.includes('[Safety limit reached]') && abortResult.includes('consecutive parameter validation errors'),
      'agent terminates with safety limit reached error message'
    );
    check(
      'WFR.3b',
      events.some((e) => e.type === 'validation_limit' && e.toolName === 'write_file' && e.limit === TOOLS_DEFAULTS.maxConsecutiveValidationErrors),
      'validation_limit event emitted with correct tool and limit details'
    );
    check(
      'WFR.3c',
      fs.readFileSync(testFile, 'utf8') === 'untouched original',
      'destination file remains strictly untouched after repeated validation errors'
    );

    // -------------------------------------------------------------------------
    // 4. Resumable write with validation failure midway
    // -------------------------------------------------------------------------
    console.log('--- 4. Resumable Write Staging Preserved Across Mid-Transaction Error ---');
    const resumableTarget = path.join(tmpRoot, 'resumable.txt');
    fs.writeFileSync(resumableTarget, 'prior data', 'utf8');

    // Round 1: Stages chunk 1 (7 bytes) -> returns next offset 7
    // Round 2: Incomplete call (missing content) -> validation error
    // Round 3: Corrected call with chunk 2, complete: true
    const resumableProvider = new MockLLMProvider([
      {
        content: null as any,
        toolCalls: [
          {
            id: 'r_call_1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ path: resumableTarget, content: 'Header-', offset: 0 }),
            },
          },
        ],
      },
      {
        content: null as any,
        toolCalls: [
          {
            id: 'r_call_2',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ path: resumableTarget, offset: 7 }), // missing content
            },
          },
        ],
      },
      {
        content: null as any,
        toolCalls: [
          {
            id: 'r_call_3',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ path: resumableTarget, content: 'Body', offset: 7, complete: true }),
            },
          },
        ],
      },
      {
        content: 'Resumable write successfully finished.',
      },
    ]);

    const resumableAgent = new Agent(resumableProvider, registry, permissions, 'System prompt', ['write_file'], 10, 1000, 'test-agent');
    const resResult = await resumableAgent.run('Perform resumable write with recovery');

    check('WFR.4a', resResult.includes('Resumable write successfully finished'), 'resumable transaction concludes successfully');
    check('WFR.4b', fs.readFileSync(resumableTarget, 'utf8') === 'Header-Body', 'committed content is accurate');

    // -------------------------------------------------------------------------
    // 5. Counter reset on valid call
    // -------------------------------------------------------------------------
    console.log('--- 5. Consecutive Counter Reset on Valid Call ---');
    const resetFile = path.join(tmpRoot, 'reset.txt');
    // Round 1: invalid call (1 error)
    // Round 2: invalid call (2 errors)
    // Round 3: valid call (counter resets to 0)
    // Round 4: invalid call (1 error, does not abort)
    // Round 5: valid completion
    const resetProvider = new MockLLMProvider([
      {
        content: null as any,
        toolCalls: [{ id: 'rc_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: resetFile }) } }],
      },
      {
        content: null as any,
        toolCalls: [{ id: 'rc_2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: resetFile }) } }],
      },
      {
        content: null as any,
        toolCalls: [{ id: 'rc_3', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: resetFile, content: 'chunk1', offset: 0 }) } }],
      },
      {
        content: null as any,
        toolCalls: [{ id: 'rc_4', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ offset: 6 }) } }],
      },
      {
        content: null as any,
        toolCalls: [{ id: 'rc_5', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: resetFile, content: 'chunk2', offset: 6, complete: true }) } }],
      },
      {
        content: 'All done cleanly.',
      },
    ]);

    const resetAgent = new Agent(resetProvider, registry, permissions, 'System prompt', ['write_file'], 10, 1000, 'test-agent');
    const resetResult = await resetAgent.run('Counter reset test');

    check('WFR.5a', resetResult.includes('All done cleanly'), 'agent succeeds because valid call reset consecutive error count');
    check('WFR.5b', fs.readFileSync(resetFile, 'utf8') === 'chunk1chunk2', 'final file committed properly');

    // -------------------------------------------------------------------------
    // 6. Threshold reached mid-batch halts before subsequent calls (P1 T23.14)
    // -------------------------------------------------------------------------
    console.log('--- 6. Mid-Batch Abort Prevents Subsequent Calls ---');
    const midBatchFile = path.join(tmpRoot, 'mid_batch.txt');
    // A single round with 4 tool calls: 3 invalid calls followed by 1 valid call.
    // The 4th call must NEVER be executed and the file must NOT be created!
    const midBatchProvider = new MockLLMProvider([
      {
        content: null as any,
        toolCalls: [
          { id: 'mb_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: midBatchFile }) } },
          { id: 'mb_2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ content: 'no path' }) } },
          { id: 'mb_3', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({}) } },
          { id: 'mb_4', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: midBatchFile, content: 'SHOULD NEVER BE WRITTEN' }) } },
        ],
      },
      {
        content: 'Should not reach this point',
      },
    ]);

    const midBatchAgent = new Agent(midBatchProvider, registry, permissions, 'System prompt', ['write_file'], 10, 1000, 'test-agent');
    const midBatchResult = await midBatchAgent.run('Mid-batch abort test');

    check('WFR.6a', midBatchResult.includes('[Safety limit reached]'), 'mid-batch abort stops on 3rd validation error');
    check('WFR.6b', !fs.existsSync(midBatchFile), 'subsequent 4th valid call in batch was NOT executed and file was not created');

    // -------------------------------------------------------------------------
    // 7. Operational error with valid parameters resets consecutive validation counter (P2 T23.14)
    // -------------------------------------------------------------------------
    console.log('--- 7. Operational Error with Valid Parameters Resets Validation Counter ---');
    const opErrFile = path.join(tmpRoot, 'op_err.txt');
    let round3Executed = false;
    const customRegistry = new ToolRegistry();
    customRegistry.register({
      name: 'write_file',
      riskLevel: 'SAFE',
      execute: async (_args) => {
        if (!round3Executed) {
          round3Executed = true;
          return { success: false, output: 'Operational failure: simulated disk I/O error', isValidationError: false };
        }
        fs.writeFileSync(opErrFile, 'recovered after op error', 'utf8');
        return { success: true, output: 'File written successfully' };
      },
    });

    const opErrProvider = new MockLLMProvider([
      {
        content: null as any,
        toolCalls: [{ id: 'op_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: opErrFile }) } }], // val error 1
      },
      {
        content: null as any,
        toolCalls: [{ id: 'op_2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ content: 'no path' }) } }], // val error 2
      },
      {
        content: null as any,
        toolCalls: [{ id: 'op_3', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: opErrFile, content: 'valid params' }) } }], // op error (valid params)
      },
      {
        content: null as any,
        toolCalls: [{ id: 'op_4', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: opErrFile }) } }], // val error 1 (not 3!)
      },
      {
        content: null as any,
        toolCalls: [{ id: 'op_5', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: opErrFile, content: 'final content' }) } }], // success
      },
      {
        content: 'Completed despite prior operational error.',
      },
    ]);

    const opErrAgent = new Agent(opErrProvider, customRegistry, permissions, 'System prompt', ['write_file'], 10, 1000, 'test-agent');
    const opErrResult = await opErrAgent.run('Operational error reset test');

    check('WFR.7a', opErrResult.includes('Completed despite prior operational error'), 'agent did not abort because operational error reset validation counter');
    check('WFR.7b', fs.existsSync(opErrFile), 'file was created successfully');

  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
