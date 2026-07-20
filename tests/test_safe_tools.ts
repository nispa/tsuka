import { createDefaultRegistry } from '../src/tools/index';
import { PermissionManager } from '../src/safety/permissions';

async function run() {
  console.log("=== Testing SAFE Tools ===");
  const registry = await createDefaultRegistry();
  const pm = new PermissionManager(); // auto-approva i tool SAFE

  console.log("\n1. Esecuzione 'list_dir'...");
  const listResult = await registry.executeTool('list_dir', {}, pm);
  console.log(listResult.output);

  console.log("\n2. Lettura prime 10 righe di package.json con 'read_file'...");
  const readResult = await registry.executeTool('read_file', { path: 'package.json', startLine: 1, endLine: 10 }, pm);
  console.log(readResult.output);

  console.log("\n3. Recupero processi di sistema con 'get_ps_info'...");
  const psResult = await registry.executeTool('get_ps_info', { category: 'processes' }, pm);
  try {
    const parsed = JSON.parse(psResult.output);
    const count = Array.isArray(parsed) ? parsed.length : 1;
    console.log(`\n✔ Successo! Recuperati ${count} processi in formato JSON.`);
    console.log("Esempi di processi attivi:");
    console.log((Array.isArray(parsed) ? parsed : [parsed]).slice(0, 3));
  } catch {
    console.log("Output non JSON o errore:\n", psResult.output);
  }
}

run().catch(console.error);
