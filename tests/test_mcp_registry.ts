/**
 * Test di integrazione MCP -> ToolRegistry (T20.1): nomi prefissati, schema
 * inline servito dal server, tier gating, esecuzione tramite PermissionManager
 * e degradazione visibile di un server che non parte.
 * Esecuzione: npx tsx tests/test_mcp_registry.ts
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
  const pm = new PermissionManager();

  // 1. Healthy server: tools registered with the mcp__<server>__<tool> names
  const report = await connectMcpServers(registry, {
    mock: { command: process.execPath, args: [SERVER] },
  });
  const allNames = registry.getAllTools().map((t) => t.name);
  check(
    'MCPR.1',
    report.connected.includes('mock') && allNames.includes('mcp__mock__echo') && allNames.includes('mcp__mock__add'),
    `server connesso e tool registrati col prefisso (registrati: ${report.toolsRegistered})`
  );

  // 2. listForLLM exposes them with the inline schema from the server
  const forLlm = registry.listForLLM('qwen2.5-coder:7b', ['mcp__mock__echo']);
  const echoDef = forLlm.find((t) => t.function.name === 'mcp__mock__echo');
  check(
    'MCPR.2',
    !!echoDef && /Echoes the message/.test(echoDef.function.description) && !!echoDef.function.parameters?.properties?.message,
    'listForLLM serve descrizione e inputSchema inline del server MCP'
  );

  // 3. Tier gating applies to MCP tools too (requiredTier 'small' -> visible to small models)
  const smallModelDefs = registry.listForLLM('llama3.2:3b', ['mcp__mock__echo']);
  check('MCPR.3', smallModelDefs.length === 1, 'il tier gating vede i tool MCP (requiredTier small su modello small)');

  // 4. executeTool round-trip through permission manager and transport
  const result = await registry.executeTool('mcp__mock__echo', { message: 'dal registry' }, pm);
  check('MCPR.4', result.success && result.output === 'echo: dal registry', 'executeTool esegue il callTool remoto e restituisce il testo');

  // 5. Validation uses the remote schema: required parameter enforced
  const invalid = await registry.executeTool('mcp__mock__echo', {}, pm);
  check('MCPR.5', !invalid.success && /Missing required parameter 'message'/.test(invalid.output), 'la validazione argomenti usa lo schema remoto (required message)');

  // 6. Default risk level RESTRICTED: denial path is user-driven, so verify the
  //    registered static level instead of driving an interactive prompt.
  const echoTool = registry.getTool('mcp__mock__echo')!;
  check('MCPR.6', echoTool.riskLevel === 'RESTRICTED', 'riskLevel di default per i tool MCP è RESTRICTED (MCP_DEFAULTS)');

  // 7. riskLevel override from config
  const registry2 = new ToolRegistry();
  await connectMcpServers(registry2, {
    safe_mock: { command: process.execPath, args: [SERVER], riskLevel: 'SAFE' },
  });
  const safeEcho = registry2.getTool('mcp__safe_mock__echo')!;
  check('MCPR.7', safeEcho.riskLevel === 'SAFE', "l'override riskLevel nella config del server viene rispettato");

  // 8. Failing server: degraded visibly, never throws
  const registry3 = new ToolRegistry();
  const failReport = await connectMcpServers(registry3, {
    broken: { command: process.execPath, args: ['-e', 'process.exit(9)'], timeoutMs: 5000 },
  });
  check(
    'MCPR.8',
    failReport.failed.includes('broken') && failReport.connected.length === 0,
    'un server che muore all\'avvio finisce in failed senza bloccare connectMcpServers'
  );

  // 9. enabled:false keeps a configured server off
  const registry4 = new ToolRegistry();
  const disabledReport = await connectMcpServers(registry4, {
    off: { command: process.execPath, args: [SERVER], enabled: false },
  });
  check(
    'MCPR.9',
    disabledReport.connected.length === 0 && registry4.getAllTools().length === 0,
    'enabled:false tiene il server spento senza tentare la connessione'
  );

  // 10. undefined config is a no-op
  const registry5 = new ToolRegistry();
  const emptyReport = await connectMcpServers(registry5, undefined);
  check('MCPR.10', emptyReport.connected.length === 0 && emptyReport.failed.length === 0, 'config assente = no-op pulito');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
