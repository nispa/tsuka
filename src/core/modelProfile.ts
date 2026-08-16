import * as fs from 'fs';
import { homePath } from './apphome';
import type { ILLMProvider, ReasoningEffort } from './provider';
import {
  loadBenchmarkTests, getBenchmarkTestsHash, runBenchTest,
  BenchTestResult, BenchCategory
} from './benchmarkTests';

/**
 * Capability Fingerprinting: objectively measures model capabilities
 * (instruction following, JSON output, function calling, speed) via a focused
 * benchmark instead of heuristics from the model name string.
 *
 * Profiles are saved in `models_profile.json` and used by `ToolRegistry` to
 * select the appropriate tool tier (small/medium/large).
 */

export const BENCHMARK_VERSION = 4;

/** The 4 reasoning effort levels swept by benchmark in increasing order. */
export const REASONING_EFFORT_LEVELS: ReasoningEffort[] = ['none', 'low', 'medium', 'xhigh'];

export interface ModelScores {
  /** 0..1: weighted average of "instruction" category tests in benchmarks/ */
  instruction: number;
  /** 0..1: weighted average of "json" category tests in benchmarks/ */
  json: number;
  /** 0..1: weighted average of "toolCalling" category tests in benchmarks/ */
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
  /** Test suite hash in benchmarks/ at time of measurement */
  testsHash?: string;
  /** Score of each individual test executed */
  testResults?: BenchTestResult[];
  /** Reasoning effort level at which this profile was measured (T8.10) */
  reasoningEffort: ReasoningEffort;
  /** Average completion tokens across tests executed at this level */
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
 * Returns the recommended reasoning effort measured by benchmark for a given model.
 */
export function getRecommendedEffort(modelName: string): ReasoningEffort | null {
  if (!modelName) return null;
  const data = loadProfilesData();
  const rec = data.recommendations?.[modelName];
  if (rec) {
    const profile = getModelProfile(modelName, rec);
    if (profile) return rec;
  }
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
 * Composite index key for model profiles in models_profile.json (T8.10):
 * "model@effort" prevents cross-effort tier contamination.
 */
export function profileKey(modelName: string, effort: ReasoningEffort): string {
  return `${modelName}@${effort}`;
}

/**
 * Returns the measured profile of the model for a given reasoning effort level.
 */
export function getModelProfile(modelName: string, effort: ReasoningEffort = 'xhigh'): ModelProfile | null {
  const profiles = loadProfiles();
  const profile = profiles[profileKey(modelName, effort)] ?? null;
  if (profile && (profile.benchmarkVersion ?? 1) !== BENCHMARK_VERSION) {
    return null;
  }
  if (profile && profile.testsHash !== getBenchmarkTestsHash()) {
    return null;
  }
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
 * Derives capability tier from measured benchmark scores.
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

function tierRank(tier: 'small' | 'medium' | 'large'): number {
  return tier === 'large' ? 2 : tier === 'medium' ? 1 : 0;
}

export interface BenchmarkSweepResult {
  /** One profile for each of the 4 reasoning effort levels. */
  profiles: ModelProfile[];
  /** Lowest effort level achieving the highest tier observed. */
  recommendedEffort: ReasoningEffort | null;
}

/**
 * Executes a capability fingerprinting benchmark across all reasoning effort levels.
 */
export async function runBenchmark(
  provider: ILLMProvider,
  model: string,
  onProgress?: (step: string) => void
): Promise<BenchmarkSweepResult> {
  const tests = loadBenchmarkTests();
  if (tests.length === 0) {
    throw new Error('No tests found in benchmarks/ — please provide at least one benchmark JSON file.');
  }

  const previousModel = provider.getCurrentModel();
  provider.setCurrentModel(model);

  try {
    onProgress?.(`${tests.length} tests loaded from benchmarks/, sweeping ${REASONING_EFFORT_LEVELS.length} reasoning effort levels...`);

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

    let recommendedEffort: ReasoningEffort | null = null;
    if (profiles.length > 0) {
      const maxRank = Math.max(...profiles.map((p) => tierRank(p.tier)));
      const best = profiles.find((p) => tierRank(p.tier) === maxRank);
      recommendedEffort = best?.reasoningEffort ?? null;
      if (recommendedEffort && profiles.length > 0) {
        saveProfile(profiles[0], recommendedEffort);
      }
    }

    return { profiles, recommendedEffort };
  } finally {
    provider.setCurrentModel(previousModel);
  }
}
