import * as fs from 'fs';
import { homePath } from './apphome';
import type { LLMProvider } from './provider';
import {
  loadBenchmarkTests, getBenchmarkTestsHash, runBenchTest,
  BenchTestResult, BenchCategory
} from './benchmarkTests';

/**
 * Capability Fingerprinting: misura OGGETTIVAMENTE le capacità di un modello
 * (instruction following, output JSON, function calling, velocità) tramite un
 * piccolo benchmark, invece di indovinarle dal nome (euristica "9b"/"70b").
 *
 * Il profilo è salvato in models_profile.json e usato dal ToolRegistry per
 * decidere il tier dei tool (small/medium/large) in modo misurato.
 */

/**
 * Versione del MOTORE di benchmark: incrementarla invalida i profili misurati
 * con le versioni precedenti (trattati come assenti → riproporre /benchmark).
 * v2: test hardcoded più severi dei 3 originali (che ogni modello moderno
 * passava, assegnando LARGE anche a modelli da 4B).
 * v3: test dichiarativi caricati da `benchmarks/*.json` (modificabili al volo);
 * oltre alla versione del motore, il profilo salva l'hash del set di test:
 * cambiare un test invalida automaticamente i profili misurati col set vecchio.
 */
export const BENCHMARK_VERSION = 3;

export interface ModelScores {
  /** 0..1: media pesata dei test di categoria "instruction" in benchmarks/ */
  instruction: number;
  /** 0..1: media pesata dei test di categoria "json" in benchmarks/ */
  json: number;
  /** 0..1: media pesata dei test di categoria "toolCalling" in benchmarks/ */
  toolCalling: number;
}

export interface ModelProfile {
  model: string;
  provider: string;
  tier: 'small' | 'medium' | 'large';
  scores: ModelScores;
  tokensPerSecond: number;
  testedAt: string; // ISO 8601
  benchmarkVersion?: number;
  /** Hash del set di test in benchmarks/ al momento della misura */
  testsHash?: string;
  /** Punteggio di ogni singolo test eseguito */
  testResults?: BenchTestResult[];
}

interface ProfilesFile {
  profiles: Record<string, ModelProfile>;
}

const PROFILE_PATH = homePath('models_profile.json');
let cache: { mtimeMs: number; profiles: Record<string, ModelProfile> } | null = null;

function loadProfiles(): Record<string, ModelProfile> {
  try {
    if (!fs.existsSync(PROFILE_PATH)) {
      cache = { mtimeMs: -1, profiles: {} };
      return cache.profiles;
    }
    const mtimeMs = fs.statSync(PROFILE_PATH).mtimeMs;
    if (cache && cache.mtimeMs === mtimeMs) {
      return cache.profiles;
    }
    const raw = fs.readFileSync(PROFILE_PATH, 'utf-8');
    const data = JSON.parse(raw) as ProfilesFile;
    cache = { mtimeMs, profiles: data.profiles || {} };
    return cache.profiles;
  } catch {
    return cache?.profiles || {};
  }
}

/**
 * Restituisce il profilo misurato del modello, se presente e misurato con la
 * versione corrente del benchmark (i profili di versioni precedenti sono
 * trattati come assenti: i vecchi test erano troppo facili e sovrastimavano
 * il tier — serve rimisurare con /benchmark).
 */
export function getModelProfile(modelName: string): ModelProfile | null {
  const profiles = loadProfiles();
  const profile = profiles[modelName] ?? null;
  if (profile && (profile.benchmarkVersion ?? 1) !== BENCHMARK_VERSION) {
    return null;
  }
  // Set di test cambiato dopo la misura → profilo stantio, va rimisurato
  if (profile && profile.testsHash !== getBenchmarkTestsHash()) {
    return null;
  }
  // Il tier è sempre ricalcolato dai punteggi: se le soglie di computeTier
  // cambiano, i profili già misurati si adeguano senza dover rimisurare
  return profile ? { ...profile, tier: computeTier(profile.scores) } : null;
}

function saveProfile(profile: ModelProfile): void {
  const profiles = { ...loadProfiles() };
  profiles[profile.model] = profile;
  fs.writeFileSync(PROFILE_PATH, JSON.stringify({ profiles }, null, 2), 'utf-8');
  try {
    cache = { mtimeMs: fs.statSync(PROFILE_PATH).mtimeMs, profiles };
  } catch {
    cache = { mtimeMs: -1, profiles };
  }
}

/**
 * Deriva il tier dai punteggi misurati (v2: criteri combinati, non solo toolCalling).
 * LARGE richiede la catena di tool quasi perfetta E precisione su formato/JSON:
 * sono le capacità che servono davvero per execute_command e create_tool.
 */
export function computeTier(scores: ModelScores): 'small' | 'medium' | 'large' {
  if (scores.toolCalling >= 0.9 && scores.instruction >= 0.85 && scores.json >= 0.85) {
    return 'large';
  }
  if (scores.toolCalling >= 0.6 && scores.json >= 0.5) {
    return 'medium';
  }
  return 'small';
}

/**
 * Esegue il benchmark di capability fingerprinting su un modello (v3).
 * I test sono caricati da `benchmarks/*.json`: vengono enumerati, eseguiti in
 * sequenza e ognuno produce un punteggio 0..1; i punteggi confluiscono nella
 * media pesata della propria categoria (instruction / json / toolCalling).
 * Il profilo salva versione del motore + hash del set di test.
 */
export async function runBenchmark(
  provider: LLMProvider,
  model: string,
  onProgress?: (step: string) => void
): Promise<ModelProfile> {
  const tests = loadBenchmarkTests();
  if (tests.length === 0) {
    throw new Error('Nessun test trovato in benchmarks/ — aggiungi almeno un file .json di test.');
  }

  const previousModel = provider.getCurrentModel();
  provider.setCurrentModel(model);

  try {
    onProgress?.(`${tests.length} test caricati da benchmarks/...`);

    const testResults: BenchTestResult[] = [];
    let tokensPerSecond = 0;

    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      onProgress?.(`Test ${i + 1}/${tests.length}: ${test.name} [${test.category}]...`);
      const outcome = await runBenchTest(provider, test);
      if (tokensPerSecond === 0 && outcome.tokensPerSecond) {
        tokensPerSecond = outcome.tokensPerSecond;
      }
      testResults.push({
        name: test.name,
        category: test.category,
        score: Math.round(outcome.score * 100) / 100
      });
    }

    // Media pesata per categoria (peso del test: campo "weight", default 1).
    // Una categoria senza test vale 0: il set deve coprire tutte e tre.
    const categoryScore = (cat: BenchCategory): number => {
      let sum = 0;
      let weight = 0;
      for (let i = 0; i < tests.length; i++) {
        if (tests[i].category !== cat) continue;
        const w = tests[i].weight ?? 1;
        sum += testResults[i].score * w;
        weight += w;
      }
      return weight > 0 ? Math.round((sum / weight) * 100) / 100 : 0;
    };

    const scores: ModelScores = {
      instruction: categoryScore('instruction'),
      json: categoryScore('json'),
      toolCalling: categoryScore('toolCalling')
    };
    const profile: ModelProfile = {
      model,
      provider: provider.getBaseUrl(),
      tier: computeTier(scores),
      scores,
      tokensPerSecond,
      testedAt: new Date().toISOString(),
      benchmarkVersion: BENCHMARK_VERSION,
      testsHash: getBenchmarkTestsHash(),
      testResults
    };
    saveProfile(profile);
    return profile;
  } finally {
    provider.setCurrentModel(previousModel);
  }
}
