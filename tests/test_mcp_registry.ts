/**
 * MCP -> ToolRegistry integration test (T20.1): prefixed names, remote schemas,
 * tier gating, PermissionManager execution, connection ownership, and visible
 * degradation when a server cannot start.
 * Run with: npx tsx tests/test_mcp_registry.ts
 */
import * as path from 'path';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { connectMcpServers } from '../src/core/mcp/connectMcpServers';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

const SERVER = path.join(__dirname, 'fixtures', 'mock_mcp_server.mjs');

async function run() {
  console.log('=== Test MCP Registry Integration ===\n');
  const registry = new ToolRegistry();
  const pm = new PermissionManager(async () => 'yes');

  // 1. Healthy server: tools registered with the mcp__<server>__<tool> names.
  const report = await connectMcpServers(registry, {
    mock: { command: process.execPath, args: [SERVER] },
  });
  const allNames = registry.getAllTools().map((t) => t.name);
  check(
    'MCPR.1',
    report.connected.includes('mock') && allNames.includes('mcp__mock__echo') && allNames.includes('mcp__mock__add'),
    `server connected and prefixed tools registered (${report.toolsRegistered} total)`
  );

  // 2. listForLLM exposes them with the inline schema from the server
  const forLlm = registry.listForLLM('qwen2.5-coder:7b', ['mcp__mock__echo']);
  const echoDef = forLlm.find((t) => t.function.name === 'mcp__mock__echo');
  check(
    'MCPR.2',
    !!echoDef && /Echoes the message/.test(echoDef.function.description) && !!echoDef.function.parameters?.properties?.message,
    'listForLLM exposes the MCP server description and inline input schema'
  );

  // 3. Tier gating applies to MCP tools too (requiredTier 'small' -> visible to small models)
  const smallModelDefs = registry.listForLLM('llama3.2:3b', ['mcp__mock__echo']);
  check('MCPR.3', smallModelDefs.length === 1, 'tier gating exposes a small-tier MCP tool to a small model');

  // 4. executeTool round-trip through permission manager and transport
  const result = await registry.executeTool('mcp__mock__echo', { message: 'dal registry' }, pm);
  check('MCPR.4', result.success && result.output === 'echo: dal registry', 'executeTool returns the remote callTool result');

  // 5. Validation uses the remote schema: required parameter enforced
  const invalid = await registry.executeTool('mcp__mock__echo', {}, pm);
  check('MCPR.5', !invalid.success && /Missing required parameter 'message'/.test(invalid.output), 'argument validation enforces the remote schema');

  // 6. Default risk level RESTRICTED: denial path is user-driven, so verify the
  //    registered static level instead of driving an interactive prompt.
  const echoTool = registry.getTool('mcp__mock__echo')!;
  check('MCPR.6', echoTool.riskLevel === 'RESTRICTED', 'MCP tools use the configured default RESTRICTED risk level');

  // 7. riskLevel override from config
  const registry2 = new ToolRegistry();
  const safeConnection = await connectMcpServers(registry2, {
    safe_mock: { command: process.execPath, args: [SERVER], riskLevel: 'SAFE' },
  });
  const safeEcho = registry2.getTool('mcp__safe_mock__echo')!;
  check('MCPR.7', safeEcho.riskLevel === 'SAFE', 'server configuration overrides the default risk level');

  // 8. Closing one connection must not stop clients owned by another registry.
  await report.close();
  const independentResult = await registry2.executeTool('mcp__safe_mock__echo', { message: 'still alive' }, pm);
  check(
    'MCPR.8',
    independentResult.success && independentResult.output === 'echo: still alive',
    'closing one connection leaves independently owned MCP clients running'
  );

  // 9. Failing server: degrade visibly without throwing.
  const registry3 = new ToolRegistry();
  const failReport = await connectMcpServers(registry3, {
    broken: { command: process.execPath, args: ['-e', 'process.exit(9)'], timeoutMs: 5000 },
  });
  check(
    'MCPR.9',
    failReport.failed.includes('broken') && failReport.connected.length === 0,
    'a server that exits during startup is reported as failed without blocking startup'
  );

  // 10. enabled:false keeps a configured server off.
  const registry4 = new ToolRegistry();
  const disabledReport = await connectMcpServers(registry4, {
    off: { command: process.execPath, args: [SERVER], enabled: false },
  });
  check(
    'MCPR.10',
    disabledReport.connected.length === 0 && registry4.getAllTools().length === 0,
    'enabled:false skips the configured server without connecting'
  );

  // 11. Undefined configuration is a no-op.
  const registry5 = new ToolRegistry();
  const emptyReport = await connectMcpServers(registry5, undefined);
  check('MCPR.11', emptyReport.connected.length === 0 && emptyReport.failed.length === 0, 'missing configuration is a clean no-op');

  await Promise.all([
    safeConnection.close(),
    failReport.close(),
    disabledReport.close(),
    emptyReport.close(),
  ]);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
