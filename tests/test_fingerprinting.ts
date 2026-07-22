/**
 * Test unitari per il Capability Fingerprinting (modelProfile.ts + integrazione tier).
 * Esecuzione: npx tsx tests/test_fingerprinting.ts
 * Nota: NON esegue benchmark live (vedi test_benchmark_live.ts, lento): qui testiamo
 * mapping tier, persistenza profili e integrazione con getModelTier.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeTier, getModelProfile, BENCHMARK_VERSION } from '../src/core/modelProfile';
import { getBenchmarkTestsHash } from '../src/core/benchmarkTests';
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

  // --- computeTier v2: criteri combinati, non solo toolCalling ---
  check('X2.1a', computeTier({ instruction: 1, json: 1, toolCalling: 1 }) === 'large', 'punteggi pieni → large');
  check('X2.1b', computeTier({ instruction: 0.75, json: 0.7, toolCalling: 0.6 }) === 'medium', 'punteggi intermedi → medium');
  check('X2.1c', computeTier({ instruction: 0, json: 0, toolCalling: 0 }) === 'small', 'punteggi nulli → small');
  check('X2.1d', computeTier({ instruction: 0.5, json: 0.4, toolCalling: 1 }) === 'small',
    'toolCalling perfetto NON basta più per large (json sotto soglia medium)');
  check('X2.1e', computeTier({ instruction: 0.5, json: 1, toolCalling: 1 }) === 'medium',
    'senza precisione di formato niente large, anche con tool perfetti');
  check('X2.1f', computeTier({ instruction: 1, json: 1, toolCalling: 0.8 }) === 'medium',
    'catena di tool incompleta (0.8) → medium, non large');
  check('X2.1g', computeTier({ instruction: 0.8, json: 0.91, toolCalling: 1 }) === 'medium',
    'caso reale 4B (0.8/0.91/1): precisione instruction sotto 0.85 → medium');

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
          testedAt: new Date().toISOString(),
          benchmarkVersion: BENCHMARK_VERSION,
          testsHash: getBenchmarkTestsHash()
        },
        '__probe_stale_tests__': {
          model: '__probe_stale_tests__',
          provider: 'test',
          tier: 'large',
          scores: { instruction: 1, json: 1, toolCalling: 1 },
          tokensPerSecond: 10,
          testedAt: new Date().toISOString(),
          benchmarkVersion: BENCHMARK_VERSION,
          testsHash: 'deadbeef'
        },
        '__probe_legacy__': {
          model: '__probe_legacy__',
          provider: 'test',
          tier: 'large',
          scores: { instruction: 1, json: 1, toolCalling: 1 },
          tokensPerSecond: 10,
          testedAt: new Date().toISOString()
          // nessun benchmarkVersion: profilo v1 (test vecchi, troppo facili)
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

    // --- Versionamento: i profili misurati col benchmark vecchio sono invalidati ---
    check('X2.3a', getModelProfile('__probe_legacy__') === null,
      'profilo senza benchmarkVersion (v1) → trattato come assente');
    check('X2.3b', getModelTier('__probe_legacy__') === 'small',
      'tier del profilo legacy ignorato → fallback euristica');
    check('X2.3c', getModelProfile('__probe_stale_tests__') === null,
      'profilo con hash del set di test diverso → invalidato (test cambiati al volo)');
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
