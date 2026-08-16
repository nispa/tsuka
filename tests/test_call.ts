/**
 * Test per la preparazione e logica di conferenza multi-agente /call.
 * Esecuzione: npx tsx tests/test_call.ts
 */
import { resolveCharacter, loadRole, loadTrait, loadSystemPrompt } from '../src/cli/shared';

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
  console.log('=== Test Conferenza Multi-Agente (/call) ===\n');

  // Risoluzione personaggi per mestiere
  const researcher = resolveCharacter('researcher');
  const dev = resolveCharacter('developer');
  const auditor = resolveCharacter('security_auditor');

  check('CALL.1', !!researcher && !!dev && !!auditor, 'Risoluzione corretta dei ruoli base nel catalogo');

  if (researcher && dev && auditor) {
    const topic = 'Analisi architettura del sistema';
    const participants = [researcher, dev, auditor];

    for (const p of participants) {
      const role = loadRole(p.role);
      const trait = loadTrait(p.trait);
      const sysPrompt = loadSystemPrompt(role, trait, 'test-model', undefined, p, topic);

      check(`CALL.2.${p.aiName}`, sysPrompt.includes(p.aiName) && sysPrompt.includes(role.systemPrompt), `System prompt corretto per ${p.aiName}`);
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
