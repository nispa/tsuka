/**
 * Unit and contract tests for the shared composition root and lifecycle (T21.6).
 *
 * Validates createHarnessRuntime bootstrapping, custom dependency injection,
 * and idempotent close() lifecycle.
 */

import { createHarnessRuntime } from '../src/core/runtime';
import { ConfigManager } from '../src/core/config';
import { MockLLMProvider } from './mocks/mockProvider';
import { ToolRegistry } from '../src/tools/registry';

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
  console.log('--- Harness Runtime & Lifecycle Tests (T21.6) ---');

  // Test 1: Standard initialization without MCP (connectMcp: false for fast unit test)
  const runtime = await createHarnessRuntime({
    connectMcp: false,
  });

  check('RUNTIME.1', !!runtime.configManager, 'bootstraps configManager');
  check('RUNTIME.2', !!runtime.provider, 'bootstraps LLM provider');
  check('RUNTIME.3', !!runtime.registry, 'bootstraps tool registry');
  check('RUNTIME.4', !!runtime.permissionManager, 'bootstraps permission manager');
  check('RUNTIME.5', runtime.registry.getAllTools().length > 0, 'registers native tools');

  // Test 2: Idempotent close()
  await runtime.close();
  check('RUNTIME.6', true, 'first close() succeeds');
  await runtime.close();
  check('RUNTIME.7', true, 'second close() is idempotent');

  // Test 3: Custom dependencies injection
  const customConfig = new ConfigManager();
  const customProvider = new MockLLMProvider([{ content: 'pong' }]);
  const customRegistry = new ToolRegistry();
  customRegistry.register({
    name: 'custom_ping',
    riskLevel: 'SAFE',
    execute: async () => 'pong',
  });

  let promptHandlerCalled = false;
  const customRuntime = await createHarnessRuntime({
    configManager: customConfig,
    customProvider,
    customRegistry,
    permissionHandler: async () => {
      promptHandlerCalled = true;
      return 'ALLOW_ALWAYS';
    },
    connectMcp: false,
  });

  check('RUNTIME.8', customRuntime.configManager === customConfig, 'uses injected config manager');
  check('RUNTIME.9', customRuntime.provider === customProvider, 'uses injected LLM provider');
  check('RUNTIME.10', customRuntime.registry === customRegistry, 'uses injected tool registry');
  check('RUNTIME.11', customRuntime.registry.getTool('custom_ping') !== undefined, 'custom tool present in injected registry');

  await customRuntime.close();
  check('RUNTIME.12', true, 'custom runtime closes cleanly');

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
