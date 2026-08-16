import * as fs from 'fs';
import { homePath } from './apphome';
import type { ILLMProvider, ReasoningEffort } from './provider';
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
 * v4 (T8.10): il benchmark spazza i 4 livelli di reasoning_effort invece di
 * misurarne uno solo (quello di default, mai esplicitato prima d'ora) — un
 * profilo v3 è stato misurato a un effort ignoto e applicato a un altro:
 * va rifatto, non solo riletto con soglie diverse.
 */
export const BENCHMARK_VERSION = 4;

/** I 4 livelli spazzati dal benchmark, in ordine crescente di sforzo/costo. */
export const REASONING_EFFORT_LEVELS: ReasoningEffort[] = ['none', 'low', 'medium', 'xhigh'];

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
  /** Livello di reasoning_effort con cui QUESTO profilo è stato misurato (T8.10).
   *  Chiave di indicizzazione insieme al nome modello (vedi profileKey). */
  reasoningEffort: ReasoningEffort;
  /** Media dei token di completamento sui test eseguiti a questo livello (T8.10):
   *  tokensPerSecond da solo non rileva l'over-thinking (stessa velocità, molti
   *  più token emessi per la stessa risposta a un effort più alto). */
  avgCompletionTokens: number;
}

interface ProfilesFile {
  profiles: Record<string, ModelProfile>;
  recommendations?: Record<string, ReasoningEffort>;
}

const PROFILE_PATH = homePath('models_profile.json');

let cache: { raw: string; data: ProfilesFile } | null = null;

function loadProfilesData(): ProfilesFile {
  try {
    if (!fs.existsSync(PROFILE_PATH)) {
      cache = { raw: '', data: { profiles: {}, recommendations: {} } };
      return cache.data;
    }
    const raw = fs.readFileSync(PROFILE_PATH, 'utf-8');
    if (cache && cache.raw === raw) {
      return cache.data;
    }
    const data = JSON.parse(raw) as ProfilesFile;
    if (!data.profiles) data.profiles = {};
    if (!data.recommendations) data.recommendations = {};
    cache = { raw, data };
    return cache.data;
  } catch {
    return cache?.data || { profiles: {}, recommendations: {} };
  }
}

function loadProfiles(): Record<string, ModelProfile> {
  return loadProfilesData().profiles;
}

/**
 * Restituisce lo sforzo di ragionamento consigliato misurato dal benchmark per un dato modello.
 */
export function getRecommendedEffort(modelName: string): ReasoningEffort | null {
  if (!modelName) return null;
  const data = loadProfilesData();
  const rec = data.recommendations?.[modelName];
  if (rec) {
    const profile = getModelProfile(modelName, rec);
    if (profile) return rec;
  }
  // Se non esplicito in recommendations, cerca tra i profili validi
  for (const effort of REASONING_EFFORT_LEVELS) {
    const p = getModelProfile(modelName, effort);
    if (p && p.tier === 'large') return effort;
  }
  for (const effort of REASONING_EFFORT_LEVELS) {
    const p = getModelProfile(modelName, effort);
    if (p && p.tier === 'medium') return effort;
  }
  return null;
}

/**
 * Chiave di indicizzazione dei profili in models_profile.json (T8.10):
 * "modello@effort" invece del solo nome modello — un profilo misurato a un
 * livello di reasoning_effort non deve mai essere applicato girando a un altro
 * (il difetto che T8.10 corregge, vedi TASKS.md).
 */
export function profileKey(modelName: string, effort: ReasoningEffort): string {
  return `${modelName}@${effort}`;
}

/**
 * Restituisce il profilo misurato del modello per un dato livello di
 * reasoning_effort, se presente e misurato con la versione corrente del
 * benchmark (i profili di versioni precedenti sono trattati come assenti: i
 * vecchi test erano troppo facili, o non specificavano affatto l'effort usato
 * — sovrastimavano il tier — serve rimisurare con /benchmark).
 * `effort` di default: 'xhigh', il livello più costoso — è anche il default
 * documentato di alcuni modelli locali (vedi TASKS.md T8.10): un chiamante che
 * non conosce l'effort realmente in uso deve assumere lo scenario peggiore,
 * non quello più comodo, per non riconcedere un tier che il modello non ha
 * mai dimostrato di meritare a quel livello.
 */
export function getModelProfile(modelName: string, effort: ReasoningEffort = 'xhigh'): ModelProfile | null {
  const profiles = loadProfiles();
  const profile = profiles[profileKey(modelName, effort)] ?? null;
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

function saveProfile(profile: ModelProfile, recommendedEffort?: ReasoningEffort | null): void {
  const data = loadProfilesData();
  data.profiles[profileKey(profile.model, profile.reasoningEffort)] = profile;
  if (recommendedEffort) {
    if (!data.recommendations) data.recommendations = {};
    data.recommendations[profile.model] = recommendedEffort;
  }
  const raw = JSON.stringify(data, null, 2);
  fs.writeFileSync(PROFILE_PATH, raw, 'utf-8');
  cache = { raw, data };
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

/** Ordina i tier per confrontarli ("il tier più alto" della raccomandazione). */
function tierRank(tier: 'small' | 'medium' | 'large'): number {
  return tier === 'large' ? 2 : tier === 'medium' ? 1 : 0;
}

export interface BenchmarkSweepResult {
  /** Un profilo per ciascuno dei 4 livelli di reasoning_effort, nell'ordine di REASONING_EFFORT_LEVELS. */
  profiles: ModelProfile[];
  /** Livello più basso che raggiunge il tier più alto osservato fra i 4 (T8.10):
   *  la risposta misurata a "quanto deve pensare il modello", non indovinata dal
   *  nome. null solo se non è stato possibile misurare nessun livello. */
  recommendedEffort: ReasoningEffort | null;
}

/**
 * Esegue il benchmark di capability fingerprinting su un modello (v4, T8.10).
 * A differenza di v3 (che misurava un solo run al reasoning_effort di default,
 * mai esplicitato), spazza TUTTI e 4 i livelli (REASONING_EFFORT_LEVELS): ogni
 * livello esegue l'intero set di `benchmarks/*.json` e produce un profilo
 * proprio, salvato con chiave "modello@effort" (vedi profileKey) — un profilo
 * misurato a un livello non si applica mai a un altro.
 */
export async function runBenchmark(
  provider: ILLMProvider,
  model: string,
  onProgress?: (step: string) => void
): Promise<BenchmarkSweepResult> {
  const tests = loadBenchmarkTests();
  if (tests.length === 0) {
    throw new Error('Nessun test trovato in benchmarks/ — aggiungi almeno un file .json di test.');
  }

  const previousModel = provider.getCurrentModel();
  provider.setCurrentModel(model);

  try {
    onProgress?.(`${tests.length} test caricati da benchmarks/, × ${REASONING_EFFORT_LEVELS.length} livelli di reasoning_effort...`);

    const profiles: ModelProfile[] = [];

    for (const effort of REASONING_EFFORT_LEVELS) {
      const testResults: BenchTestResult[] = [];
      let tokensPerSecond = 0;
      let completionTokensSum = 0;
      let completionTokensCount = 0;

      for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        onProgress?.(`[${effort}] Test ${i + 1}/${tests.length}: ${test.name} [${test.category}]...`);
        const outcome = await runBenchTest(provider, test, { reasoningEffort: effort });
        if (tokensPerSecond === 0 && outcome.tokensPerSecond) {
          tokensPerSecond = outcome.tokensPerSecond;
        }
        if (typeof outcome.avgCompletionTokens === 'number') {
          completionTokensSum += outcome.avgCompletionTokens;
          completionTokensCount++;
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
        testResults,
        reasoningEffort: effort,
        avgCompletionTokens: completionTokensCount > 0 ? Math.round(completionTokensSum / completionTokensCount) : 0
      };
      saveProfile(profile);
      profiles.push(profile);
    }

    // Raccomandazione: fra i livelli misurati, il tier più alto raggiunto da
    // qualcuno di essi, e fra quelli che lo raggiungono il più economico
    // (REASONING_EFFORT_LEVELS è già in ordine crescente di sforzo).
    let recommendedEffort: ReasoningEffort | null = null;
    if (profiles.length > 0) {
      const maxRank = Math.max(...profiles.map((p) => tierRank(p.tier)));
      const best = profiles.find((p) => tierRank(p.tier) === maxRank);
      recommendedEffort = best?.reasoningEffort ?? null;
      if (recommendedEffort && profiles.length > 0) {
        // Riassegna e persiste la raccomandazione nel file
        saveProfile(profiles[0], recommendedEffort);
      }
    }

    return { profiles, recommendedEffort };
  } finally {
    provider.setCurrentModel(previousModel);
  }
}
