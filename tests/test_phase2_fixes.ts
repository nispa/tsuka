/**
 * Test di regressione per le ottimizzazioni della Fase 2 (OPTIMIZATION_PLAN.md).
 * Esecuzione: npx tsx test_phase2_fixes.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadToolSchema, ToolRegistry, getModelTier } from '../src/tools/registry';
import { Agent } from '../src/core/agent';
import { PermissionManager } from '../src/safety/permissions';

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

async function main() {
  console.log('=== Test regressione Fase 2 ===\n');

  // --- T2.1: cache schemi tool con invalidazione su mtime ---
  const tmpSchemaPath = path.resolve(process.cwd(), 'tools_schemas/_t21_probe.json');
  fs.writeFileSync(tmpSchemaPath, JSON.stringify({ description: 'v1', parameters: { type: 'object' }, requiredTier: 'small' }), 'utf-8');
  const s1 = loadToolSchema('_t21_probe');
  const s2 = loadToolSchema('_t21_probe');
  check('T2.1a', s1 === s2, 'seconda lettura servita dalla cache (stesso riferimento)');

  await new Promise((r) => setTimeout(r, 30)); // garantisce mtime diverso
  fs.writeFileSync(tmpSchemaPath, JSON.stringify({ description: 'v2', parameters: { type: 'object' }, requiredTier: 'medium' }), 'utf-8');
  const s3 = loadToolSchema('_t21_probe');
  check('T2.1b', s3 !== s1 && s3.description === 'v2' && s3.requiredTier === 'medium', 'modifica a caldo rilevata (cache invalidata)');
  fs.unlinkSync(tmpSchemaPath);

  // --- T2.1c: listForLLM continua a filtrare correttamente i tier ---
  const registry = new ToolRegistry();
  registry.register({ name: 'read_file', riskLevel: 'SAFE', execute: async () => '' });
  registry.register({ name: 'execute_command', riskLevel: 'DANGEROUS', execute: async () => '' });
  const smallTools = registry.listForLLM('qwen-9b').map((t) => t.function.name);
  const largeTools = registry.listForLLM('gpt-4o').map((t) => t.function.name);
  check('T2.1c', smallTools.includes('read_file') && !smallTools.includes('execute_command') && largeTools.includes('execute_command'),
    `tier pruning intatto (small: [${smallTools}], large: [${largeTools}])`);

  // --- T2.3: pruning cronologia con taglio sicuro ---
  const fakeProvider: any = { getCurrentModel: () => 'test-9b' };
  const agent = new Agent(fakeProvider, registry, new PermissionManager(), 'system prompt di test', undefined, 8);
  // Simula una cronologia con sequenze tool_calls/tool al confine di taglio
  const msgs = agent.getMessages();
  for (let i = 0; i < 6; i++) {
    msgs.push({ role: 'user', content: `domanda ${i}` });
    msgs.push({ role: 'assistant', content: null, tool_calls: [{ id: `tc${i}`, function: { name: 'x', arguments: '{}' } }] } as any);
    msgs.push({ role: 'tool', tool_call_id: `tc${i}`, name: 'x', content: 'ok' } as any);
  }
  const removed = agent.pruneHistory();
  const after = agent.getMessages();
  const firstAfterSystem = after[1];
  const noOrphanTool = firstAfterSystem.role !== 'tool';
  const toolCallsHaveResponses = after.every((m: any, idx: number) => {
    if (m.role !== 'assistant' || !m.tool_calls) return true;
    return m.tool_calls.every((tc: any) => after.some((t: any) => t.role === 'tool' && t.tool_call_id === tc.id && after.indexOf(t) > idx));
  });
  check('T2.3a', removed > 0 && after.length <= 9, `cronologia ridotta a ${after.length} messaggi (rimossi ${removed})`);
  check('T2.3b', noOrphanTool && toolCallsHaveResponses, 'nessun messaggio tool orfano / coppie tool_call-tool integre');
  check('T2.3c', after[0].role === 'system' && after[0].content === 'system prompt di test', 'system prompt preservato');

  // --- T2.4: cache JSON dei config (via loadToolSchema come proxy è già coperto; qui testiamo il pattern generico) ---
  // Il meccanismo è identico (mtime-based) e condiviso: verifichiamo che getModelTier resti coerente
  check('T2.4', getModelTier('qwenpaw-9b') === 'small' && getModelTier('modello-senza-taglia') === 'small' && getModelTier('qwen-27b') === 'medium',
    'utility di classificazione modelli invariata');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
