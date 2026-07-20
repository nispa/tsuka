import * as fs from 'fs';
import * as path from 'path';
import type { LLMProvider } from './provider';

/**
 * Capability Fingerprinting: misura OGGETTIVAMENTE le capacità di un modello
 * (instruction following, output JSON, function calling, velocità) tramite un
 * piccolo benchmark, invece di indovinarle dal nome (euristica "9b"/"70b").
 *
 * Il profilo è salvato in models_profile.json e usato dal ToolRegistry per
 * decidere il tier dei tool (small/medium/large) in modo misurato.
 */

export interface ModelScores {
  /** 0 o 1: segue istruzioni esatte di formato */
  instruction: number;
  /** 0 o 1: produce JSON valido e conforme */
  json: number;
  /** 0 / 0.5 / 1: emette tool call validi con argomenti corretti */
  toolCalling: number;
}

export interface ModelProfile {
  model: string;
  provider: string;
  tier: 'small' | 'medium' | 'large';
  scores: ModelScores;
  tokensPerSecond: number;
  testedAt: string; // ISO 8601
}

interface ProfilesFile {
  profiles: Record<string, ModelProfile>;
}

const PROFILE_PATH = path.resolve(process.cwd(), 'models_profile.json');
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
 * Restituisce il profilo misurato del modello, se presente (altrimenti null).
 */
export function getModelProfile(modelName: string): ModelProfile | null {
  const profiles = loadProfiles();
  return profiles[modelName] ?? null;
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
 * Deriva il tier dai punteggi misurati.
 */
export function computeTier(scores: ModelScores): 'small' | 'medium' | 'large' {
  if (scores.toolCalling >= 0.75) return 'large';
  if (scores.toolCalling >= 0.4) return 'medium';
  return 'small';
}

/**
 * Esegue il benchmark di capability fingerprinting su un modello.
 * Tre micro-test (instruction, JSON, tool calling) + misura della velocità.
 * Il profilo risultante viene salvato su disco e restituito.
 */
export async function runBenchmark(
  provider: LLMProvider,
  model: string,
  onProgress?: (step: string) => void
): Promise<ModelProfile> {
  const previousModel = provider.getCurrentModel();
  provider.setCurrentModel(model);

  try {
    // ── Test 1: instruction following (misura anche la velocità) ──
    onProgress?.('Test 1/3: instruction following...');
    const r1 = await provider.chatWithTools(
      [{ role: 'user', content: 'Rispondi esattamente e solamente con la parola: PONG. Nessun altro testo, nessuna punteggiatura.' }],
      undefined
    );
    const instruction = r1.content.trim().replace(/[^A-Za-z]/g, '').toUpperCase() === 'PONG' ? 1 : 0;
    const tokensPerSecond = r1.stats?.tokensPerSecond ?? 0;

    // ── Test 2: output JSON strutturato ──
    onProgress?.('Test 2/3: output JSON...');
    const r2 = await provider.chatWithTools(
      [{ role: 'user', content: 'Rispondi SOLO con un oggetto JSON valido con chiavi "a" (numero intero) e "b" (stringa). Nessun testo prima o dopo, nessun blocco markdown.' }],
      undefined
    );
    let json = 0;
    try {
      const m = r2.content.match(/\{[\s\S]*\}/);
      if (m) {
        const obj = JSON.parse(m[0]);
        if (typeof obj.a === 'number' && typeof obj.b === 'string') json = 1;
      }
    } catch {}

    // ── Test 3: function calling ──
    onProgress?.('Test 3/3: function calling...');
    const weatherTool = [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: "Restituisce le condizioni meteo di una città.",
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'Nome della città' }
          },
          required: ['city']
        }
      }
    }];
    const r3 = await provider.chatWithTools(
      [{ role: 'user', content: 'Che tempo fa a Roma? Usa il tool get_weather per rispondere.' }],
      weatherTool
    );
    let toolCalling = 0;
    const tc = r3.toolCalls?.[0];
    if (tc) {
      toolCalling = 0.5; // ha emesso una tool call, ma con argomenti non validi
      try {
        const args = JSON.parse(tc.function.arguments);
        if (tc.function.name === 'get_weather' && typeof args.city === 'string' && args.city.trim().length > 0) {
          toolCalling = 1;
        }
      } catch {}
    }

    const scores: ModelScores = { instruction, json, toolCalling };
    const profile: ModelProfile = {
      model,
      provider: provider.getBaseUrl(),
      tier: computeTier(scores),
      scores,
      tokensPerSecond,
      testedAt: new Date().toISOString()
    };
    saveProfile(profile);
    return profile;
  } finally {
    provider.setCurrentModel(previousModel);
  }
}
