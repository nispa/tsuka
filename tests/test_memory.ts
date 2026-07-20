/**
 * Test della memoria condivisa persistente (feature M1-M5).
 * Esecuzione: npx tsx test_memory.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../src/core/memory';
import { createDefaultRegistry } from '../src/tools/index';

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
  console.log('=== Test memoria condivisa persistente ===\n');

  const tmpFile = path.resolve(process.cwd(), '.smoke_memory.json');
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

  // --- M1: salvataggio e persistenza tra "sessioni" (nuova istanza = nuovo avvio) ---
  const store1 = new MemoryStore(tmpFile, 5);
  store1.addFact('La porta 22 è chiusa sul server', 'Falco');
  store1.addFact('Il progetto usa TypeScript strict', 'Pippo');
  const store2 = new MemoryStore(tmpFile, 5); // simula una nuova sessione
  check('M1a', store2.count() === 2, `fatti persistiti e ricaricati da nuova istanza (${store2.count()})`);
  check('M1b', store2.search('porta').length === 1 && store2.search('porta')[0].source === 'Falco', 'ricerca per keyword con sorgente');

  // --- M1c: limite FIFO ---
  for (let i = 0; i < 5; i++) store2.addFact(`fatto numero ${i}`, 'test');
  check('M1c', store2.count() === 5 && store2.search('porta').length === 0, 'cap FIFO: i ricordi più vecchi sono rimossi');

  // --- M1d: rimozione e formatForPrompt ---
  const recent = store2.getRecent(1)[0];
  check('M1d', store2.remove(recent.id) && store2.count() === 4, 'rimozione per id');
  const promptSection = store2.formatForPrompt(10, 80);
  check('M1e', promptSection.length > 0 && promptSection.length < 200, `sezione prompt compatta (${promptSection.length} caratteri)`);

  fs.unlinkSync(tmpFile);

  // --- M2: i tool sono auto-scoperti dal registry e funzionano ---
  const registry = await createDefaultRegistry();
  const perm: any = { checkPermission: async () => true };
  const names = registry.listForLLM('gpt-4o').map((t) => t.function.name);
  check('M2a', names.includes('save_memory') && names.includes('recall_memory'), 'tool di memoria rilevati via auto-discovery');

  const saveRes = await registry.executeTool('save_memory', { content: 'Test integrazione memoria' }, perm);
  const recallRes = await registry.executeTool('recall_memory', { query: 'integrazione' }, perm);
  check('M2b', saveRes.success && recallRes.success && recallRes.output.includes('Test integrazione memoria'), 'save_memory + recall_memory end-to-end');

  const emptyRes = await registry.executeTool('save_memory', { content: '   ' }, perm);
  check('M2c', !emptyRes.success, 'contenuto vuoto rifiutato con errore');

  // Pulizia: svuota la memoria reale usata dai tool (singleton su memory/memory.json)
  MemoryStore.getInstance().clear();
  const memDir = path.resolve(process.cwd(), 'memory');
  if (fs.existsSync(memDir)) fs.rmSync(memDir, { recursive: true, force: true });

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
