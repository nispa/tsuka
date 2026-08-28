/**
 * Unit and contract tests for the modular tool subsystem (T21.4).
 *
 * Validates ToolRegistry facade, schema loader, parameter validator,
 * tier policy engine, and authorized tool execution.
 */

import {
  ToolRegistry,
  loadToolSchema,
  validateToolArgs,
  fallbackSchema,
  getModelTier,
  hasNativeFunctionCalling,
  executeAuthorizedTool,
  formatPermissionDetails,
  type Tool,
  type ToolExecutionContext
} from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`PASS ${id} - ${detail}`);
  } else {
    failed++;
    console.log(`FAIL ${id} - ${detail}`);
  }
}

async function runTests(): Promise<void> {
  console.log('--- Tool Subsystem Contract Tests (T21.4) ---');

  // Group 1: Registration & Facade Operations
  const registry = new ToolRegistry();
  const dummyTool: Tool = {
    name: 'test_dummy',
    riskLevel: 'SAFE',
    execute: async (args: { input?: string }) => `Echo: ${args.input || 'none'}`
  };

  registry.register(dummyTool);
  check('REG.1', registry.getTool('test_dummy') === dummyTool, 'registers and retrieves tool');
  check('REG.2', registry.getAllTools().length === 1, 'lists all registered tools');

  let duplicateError = false;
  try {
    registry.register(dummyTool);
  } catch {
    duplicateError = true;
  }
  check('REG.3', duplicateError, 'rejects duplicate tool registration');

  const unregistered = registry.unregister('test_dummy');
  check('REG.4', unregistered && registry.getTool('test_dummy') === undefined, 'unregisters tool cleanly');

  // Group 2: Schema Loader & Parameter Validation
  const readFileSchema = loadToolSchema('read_file');
  check('SCHEMA.1', readFileSchema.requiredTier === 'small', 'loads native schema requiredTier');
  check('SCHEMA.2', typeof readFileSchema.description === 'string' && readFileSchema.description.length > 0, 'loads schema description');

  const fallback = fallbackSchema('unknown_xyz');
  check('SCHEMA.3', fallback.description === 'Tool unknown_xyz' && fallback.requiredTier === 'small', 'returns safe fallback schema');

  const testSchema = {
    type: 'object',
    required: ['path', 'count'],
    properties: {
      path: { type: 'string' },
      count: { type: 'integer' },
      verbose: { type: 'boolean' }
    }
  };

  check('VAL.1', validateToolArgs(null, testSchema, 'test') !== null, 'fails on non-object arguments');
  check('VAL.2', validateToolArgs({ _error: 'invalid_json_arguments' }, testSchema, 'test')?.includes('Invalid or malformed') === true, 'handles sanitized JSON error');
  check('VAL.3', validateToolArgs({ count: 5 }, testSchema, 'test')?.includes('Missing required parameter \'path\'') === true, 'catches missing required parameter');
  check('VAL.4', validateToolArgs({ path: 123, count: 5 }, testSchema, 'test')?.includes('must be a string') === true, 'catches invalid string type');
  check('VAL.5', validateToolArgs({ path: 'test.txt', count: 'abc' }, testSchema, 'test')?.includes('must be an integer') === true, 'catches invalid integer string');
  check('VAL.6', validateToolArgs({ path: 'test.txt', count: '10' }, testSchema, 'test') === null, 'accepts valid numeric integer string');
  check('VAL.7', validateToolArgs({ path: 'test.txt', count: 10 }, testSchema, 'test') === null, 'accepts fully valid arguments');

  // Group 3: Tier Policy Engine
  check('TIER.1', getModelTier('unknown-model', undefined, 'https://cloud.example/v1', 'CLOUD') === 'large', 'CLOUD class defaults to large tier');
  check('TIER.2', getModelTier('unknown-model', undefined, 'https://cloud.example/v1', 'LOCAL') === 'small', 'URL alone cannot grant cloud policy');
  check('TIER.4', getModelTier('qwen:7b') === 'small', '7b model defaults to small tier');
  check('TIER.5', getModelTier('qwen:14b') === 'medium', '14b model defaults to medium tier');
  check('TIER.6', getModelTier('qwen:72b') === 'large', '72b model defaults to large tier');
  check('TIER.7', getModelTier('gpt-4o') === 'large', 'frontier pattern matches large tier');

  // Group 4: Authorized Execution & Permission Pipeline
  const pm = new PermissionManager();
  const safeTool: Tool = {
    name: 'safe_sample',
    riskLevel: 'SAFE',
    execute: async (args: any) => `Processed: ${args.value}`
  };

  const execRes1 = await executeAuthorizedTool(safeTool, { value: 'ok' }, { permissionManager: pm });
  check('EXEC.1', execRes1.success && execRes1.output === 'Processed: ok', 'executes SAFE tool directly');

  const customRiskTool: Tool = {
    name: 'classified_sample',
    riskLevel: 'DANGEROUS',
    classifyRisk: (args: any) => (args.mode === 'safe' ? 'SAFE' : 'DANGEROUS'),
    execute: async (args: any) => `Mode: ${args.mode}`
  };

  const execRes2 = await executeAuthorizedTool(customRiskTool, { mode: 'safe' }, { permissionManager: pm });
  check('EXEC.2', execRes2.success && execRes2.output === 'Mode: safe', 'respects classifyRisk hook reduction to SAFE');

  const throwingTool: Tool = {
    name: 'throwing_sample',
    riskLevel: 'SAFE',
    execute: async () => {
      throw new Error('Explosion');
    }
  };

  const execRes3 = await executeAuthorizedTool(throwingTool, {}, { permissionManager: pm });
  check('EXEC.3', !execRes3.success && execRes3.output.includes('Explosion'), 'traps tool execution exceptions cleanly');

  // Details formatter
  const formattedDetails = formatPermissionDetails('write_file', { path: 'foo.txt' });
  check('EXEC.4', formattedDetails === 'Write/overwrite foo.txt', 'formats custom permission details');

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
