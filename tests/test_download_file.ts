/**
 * Test per il tool download_file:
 * - Scrittura file nella workspace jail
 * - Protezione path traversal (rifiuto fuori jail)
 * - Riconoscimento ed esecuzione corretta tramite ToolRegistry e PermissionManager
 * Esecuzione: npx tsx tests/test_download_file.ts
 */
import * as fs from 'fs';
import * as path from 'path';
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
  console.log('=== Test Tool download_file ===\n');

  const registry = await createDefaultRegistry();
  const pm = new PermissionManager();
  pm.setAllowAllWrite(true);

  // 1. Tool registrato correttamente
  const downloadTool = registry.getTool('download_file');
  check('DL.1', !!downloadTool && downloadTool.name === 'download_file' && downloadTool.riskLevel === 'RESTRICTED', 'Tool download_file registrato con riskLevel RESTRICTED');

  // 2. Schema presente e valido
  const schemas = registry.listForLLM('gpt-4o');
  const dlSchema = schemas.find((s: any) => s.function?.name === 'download_file');
  check('DL.2', !!dlSchema && dlSchema.function?.parameters?.properties?.url !== undefined, 'Schema JSON download_file presente e conforme');

  // 3. Esecuzione con server mock o fetch intercettata
  const testDest = path.join('output', 'test_download_artifact.txt');
  const originalFetch = globalThis.fetch;

  try {
    // Mock di fetch per test offline deterministico
    globalThis.fetch = async (input: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/plain' : null)
        },
        arrayBuffer: async () => Buffer.from('Contenuto binario di test scaricato con successo!\n'),
      } as any;
    };

    const result = await registry.executeTool('download_file', {
      url: 'https://example.com/assets/sample.txt',
      path: testDest
    }, pm);

    check('DL.3', result.success && (result.output.includes('scaricato con successo') || result.output.includes('downloaded successfully')) && result.output.includes(testDest), 'Esecuzione download_file con salvataggio nel workspace');
    check('DL.4', fs.existsSync(testDest) && fs.readFileSync(testDest, 'utf-8').includes('Contenuto binario di test'), 'File creato fisicamente su disco con contenuto corretto');

    // 4. Test deduzione automatica nome file quando path è omesso
    const autoResult = await registry.executeTool('download_file', {
      url: 'https://example.com/images/chart.png'
    }, pm);

    check('DL.5', autoResult.success && autoResult.output.includes('chart.png'), 'Deduzione automatica del nome file da URL');

    // 5. Test protezione Jail (path traversal verso l'esterno)
    const failResult = await registry.executeTool('download_file', {
      url: 'https://example.com/payload.sh',
      path: '../../../../windows/system32/cmd.exe'
    }, pm);
    const jailBlocked = !failResult.success && (failResult.output.toLowerCase().includes('negato') || failResult.output.toLowerCase().includes('denied'));
    check('DL.6', jailBlocked, 'Protezione workspace jail: rifiutati path traversal all\'esterno della root');

  } finally {
    globalThis.fetch = originalFetch;

    // Pulizia file di test
    if (fs.existsSync(testDest)) {
      try { fs.unlinkSync(testDest); } catch {}
    }
    const autoFile = path.join('downloads', 'chart.png');
    if (fs.existsSync(autoFile)) {
      try { fs.unlinkSync(autoFile); } catch {}
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
