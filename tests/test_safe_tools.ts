/**
 * Test per i tool SAFE (lettura filesystem, ispezione processi).
 * Esecuzione: npx tsx tests/test_safe_tools.ts
 */
import { createDefaultRegistry } from '../src/tools/index';
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

async function run() {
  console.log('=== Test SAFE Tools ===\n');
  const registry = await createDefaultRegistry();
  const pm = new PermissionManager();

  // 1. list_dir
  const listResult = await registry.executeTool('list_dir', {}, pm);
  check('SAFE.1', listResult.success && listResult.output.includes('package.json'), 'list_dir restituisce l\'elenco file contenente package.json');

  // 2. read_file
  const readResult = await registry.executeTool('read_file', { path: 'package.json', startLine: 1, endLine: 10 }, pm);
  check('SAFE.2', readResult.success && readResult.output.includes('"name": "tsuka"'), 'read_file legge le prime righe di package.json');

  // 3. get_ps_info
  const psResult = await registry.executeTool('get_ps_info', { category: 'processes' }, pm);
  let parsedOk = false;
  try {
    const parsed = JSON.parse(psResult.output);
    parsedOk = Array.isArray(parsed) && parsed.length > 0;
  } catch {
    // Formato tabellare POSIX (ps aux)
    parsedOk = psResult.output.length > 20 && (psResult.output.includes('PID') || psResult.output.includes('USER') || psResult.output.includes('COMMAND') || psResult.output.includes('%CPU'));
  }
  check('SAFE.3', psResult.success && parsedOk, 'get_ps_info restituisce un output di processi valido');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
