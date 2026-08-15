/**
 * Test unitari per il Capability Fingerprinting (modelProfile.ts + integrazione tier).
 * Esecuzione: npx tsx tests/test_fingerprinting.ts
 * Nota: NON esegue benchmark live (vedi test_benchmark_live.ts, lento): qui testiamo
 * mapping tier, persistenza profili e integrazione con getModelTier.
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeTier, getModelProfile, profileKey, BENCHMARK_VERSION, ModelProfile } from '../src/core/modelProfile';
import { getBenchmarkTestsHash } from '../src/core/benchmarkTests';
import { getModelTier } from '../src/tools/registry';

/** Fabbrica di un profilo finto v4 completo (T8.10): evita di ripetere gli stessi
 *  campi obbligatori (reasoningEffort/avgCompletionTokens) in ogni probe. */
function fakeProfile(model: string, effort: ModelProfile['reasoningEffort'], overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    model,
    provider: 'test',
    tier: 'large',
    scores: { instruction: 1, json: 1, toolCalling: 1 },
    tokensPerSecond: 42.5,
    testedAt: new Date().toISOString(),
    benchmarkVersion: BENCHMARK_VERSION,
    testsHash: getBenchmarkTestsHash(),
    reasoningEffort: effort,
    avgCompletionTokens: 100,
    ...overrides
  };
}

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
        [profileKey('__probe_model__', 'xhigh')]: fakeProfile('__probe_model__', 'xhigh'),
        [profileKey('__probe_stale_tests__', 'xhigh')]: fakeProfile('__probe_stale_tests__', 'xhigh', {
          tokensPerSecond: 10,
          testsHash: 'deadbeef'
        }),
        // nessun benchmarkVersion: profilo v1 (test vecchi, troppo facili). Vecchio
        // formato di chiave (senza "@effort"): coerente con com'erano scritti prima di T8.10.
        '__probe_legacy__': {
          model: '__probe_legacy__',
          provider: 'test',
          tier: 'large',
          scores: { instruction: 1, json: 1, toolCalling: 1 },
          tokensPerSecond: 10,
          testedAt: new Date().toISOString()
        },
        // --- T8.10: due livelli diversi per LO STESSO modello, con tier diversi
        // (misura realistica: a effort basso il modello sbaglia i tool, a effort
        // alto no) — la prova che getModelProfile non confonde l'uno con l'altro.
        [profileKey('__probe_isolation__', 'low')]: fakeProfile('__probe_isolation__', 'low', {
          tier: 'small',
          scores: { instruction: 0.5, json: 0.4, toolCalling: 0.3 },
          avgCompletionTokens: 40
        }),
        [profileKey('__probe_isolation__', 'xhigh')]: fakeProfile('__probe_isolation__', 'xhigh', {
          tier: 'large',
          scores: { instruction: 1, json: 1, toolCalling: 1 },
          avgCompletionTokens: 900
        })
      }
    }, null, 2), 'utf-8');

    const read = getModelProfile('__probe_model__', 'xhigh');
    check('X2.2a', read !== null && read.tokensPerSecond === 42.5, 'profilo salvato e riletto da disco');

    // --- Integrazione: getModelTier usa il profilo misurato al posto dell'euristica ---
    // getModelTier non passa un effort esplicito → getModelProfile ricade sul
    // default 'xhigh' (vedi modelProfile.ts): coerente col profilo scritto sopra.
    check('X2.2b', getModelTier('__probe_model__') === 'large', 'getModelTier usa il tier misurato (default xhigh)');
    check('X2.2c', getModelTier('qwenpaw-9b-sconosciuto') === 'small', 'fallback euristica per modelli senza profilo');

    const missing = getModelProfile('__modello_che_non_esiste__');
    check('X2.2d', missing === null, 'modello senza profilo → null');

    // --- Versionamento: i profili misurati col benchmark vecchio sono invalidati ---
    check('X2.3a', getModelProfile('__probe_legacy__', 'xhigh') === null,
      'profilo senza benchmarkVersion (v1) → trattato come assente');
    check('X2.3b', getModelTier('__probe_legacy__') === 'small',
      'tier del profilo legacy ignorato → fallback euristica');
    check('X2.3c', getModelProfile('__probe_stale_tests__', 'xhigh') === null,
      'profilo con hash del set di test diverso → invalidato (test cambiati al volo)');

    // --- T8.10: isolamento fra livelli di reasoning_effort per LO STESSO modello ---
    const low = getModelProfile('__probe_isolation__', 'low');
    const xhigh = getModelProfile('__probe_isolation__', 'xhigh');
    check('X8.10a', low !== null && low.tier === 'small', "profilo misurato a 'low' → tier small, quello misurato");
    check('X8.10b', xhigh !== null && xhigh.tier === 'large', "profilo misurato a 'xhigh' dello STESSO modello → tier large, non contaminato da 'low'");
    check('X8.10c', low?.avgCompletionTokens !== xhigh?.avgCompletionTokens,
      'avgCompletionTokens differisce fra livelli (rileva l\'over-thinking, non solo tokensPerSecond)');
    // Un effort mai misurato per quel modello (qui: 'medium') non deve mai
    // restituire il profilo di un ALTRO livello per lo stesso modello — il difetto
    // esatto descritto in TASKS.md (T8.10): "un profilo misurato a xhigh viene
    // applicato anche quando si gira a low".
    check('X8.10d', getModelProfile('__probe_isolation__', 'medium') === null,
      "livello mai misurato ('medium') → null, MAI il profilo di un altro livello dello stesso modello");

    // --- T8.12: getModelTier propaga l'effort, non lo ignora più (coda di T8.10) ---
    // Stesso nome modello, tier diverso a seconda del livello misurato: prova diretta
    // che getModelTier(modello, effort) legge il profilo alla chiave giusta invece di
    // cercare sempre '@xhigh' e ricadere sull'euristica.
    check('X8.12a', getModelTier('__probe_isolation__', 'low') === 'small',
      "getModelTier con effort='low' esplicito legge il profilo misurato a 'low' (small), non quello a 'xhigh'");
    check('X8.12b', getModelTier('__probe_isolation__', 'xhigh') === 'large',
      "getModelTier con effort='xhigh' esplicito legge il profilo misurato a 'xhigh' (large)");
    check('X8.12c', getModelTier('__probe_isolation__') === 'large',
      "getModelTier senza effort esplicito ricade sul default prudente 'xhigh' (comportamento pre-T8.12 invariato)");
    check('X8.12d', getModelTier('__probe_isolation__', 'medium') === 'small',
      "effort='medium' mai misurato per questo modello → nessun profilo a quella chiave → fallback euristica del nome ('small', nessuna cifra+'b' nel nome)");
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
