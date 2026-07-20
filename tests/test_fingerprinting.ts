/**
 * Test unitari per il Capability Fingerprinting (modelProfile.ts + integrazione tier).
 * Esecuzione: npx tsx tests/test_fingerprinting.ts
 * Nota: NON esegue benchmark live (vedi test_benchmark_live.ts, lento): qui testiamo
 * mapping tier, persistenza profili e integrazione con getModelTier.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeTier, getModelProfile } from '../src/core/modelProfile';
import { getModelTier } from '../src/tools/registry';

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
  console.log('=== Test Capability Fingerprinting (unit) ===\n');

  // --- computeTier: mapping punteggi → tier ---
  check('X2.1a', computeTier({ instruction: 1, json: 1, toolCalling: 1 }) === 'large', 'toolCalling 1 → large');
  check('X2.1b', computeTier({ instruction: 1, json: 1, toolCalling: 0.5 }) === 'medium', 'toolCalling 0.5 → medium');
  check('X2.1c', computeTier({ instruction: 0, json: 0, toolCalling: 0 }) === 'small', 'toolCalling 0 → small');

  // --- Persistenza: salviamo un profilo finto e lo rileggiamo ---
  const profilePath = path.resolve(process.cwd(), 'models_profile.json');
  const backup = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : null;
  try {
    fs.writeFileSync(profilePath, JSON.stringify({
      profiles: {
        '__probe_model__': {
          model: '__probe_model__',
          provider: 'test',
          tier: 'large',
          scores: { instruction: 1, json: 1, toolCalling: 1 },
          tokensPerSecond: 42.5,
          testedAt: new Date().toISOString()
        }
      }
    }, null, 2), 'utf-8');

    const read = getModelProfile('__probe_model__');
    check('X2.2a', read !== null && read.tokensPerSecond === 42.5, 'profilo salvato e riletto da disco');

    // --- Integrazione: getModelTier usa il profilo misurato al posto dell'euristica ---
    check('X2.2b', getModelTier('__probe_model__') === 'large', 'getModelTier usa il tier misurato');
    check('X2.2c', getModelTier('qwenpaw-9b-sconosciuto') === 'small', 'fallback euristica per modelli senza profilo');

    const missing = getModelProfile('__modello_che_non_esiste__');
    check('X2.2d', missing === null, 'modello senza profilo → null');
  } finally {
    if (backup !== null) {
      fs.writeFileSync(profilePath, backup, 'utf-8');
    } else if (fs.existsSync(profilePath)) {
      fs.unlinkSync(profilePath);
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
