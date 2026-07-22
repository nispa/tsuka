import { ProviderConfig } from './config';

/**
 * Scansione dei server LLM all'avvio: interroga i provider configurati per
 * capire quale server è effettivamente attivo e quale modello è disponibile
 * (o già caricato in memoria, nel caso di Ollama) in quel momento.
 */

export interface ScanCandidate {
  name: string;
  config: ProviderConfig;
  apiKey: string;
}

export interface ProviderScanResult {
  name: string;
  config: ProviderConfig;
  models: string[];
  /** Modello attualmente caricato in RAM sul server (endpoint /api/ps di Ollama), se rilevabile. */
  loadedModel: string | null;
}

export function isLocalUrl(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1');
}

async function fetchJson(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<any> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Interroga un singolo provider. Torna i modelli disponibili e quello
 * eventualmente già caricato, oppure null se il server non risponde.
 */
export async function probeProvider(
  name: string,
  config: ProviderConfig,
  apiKey: string,
  timeoutMs = 2500
): Promise<ProviderScanResult | null> {
  const base = config.baseUrl.replace(/\/+$/, '');
  let models: string[] = [];
  let loadedModel: string | null = null;

  try {
    // Endpoint standard OpenAI-compatibile (Ollama, llama.cpp/Unsloth, OpenRouter)
    const auth = apiKey && apiKey !== 'local' ? { Authorization: `Bearer ${apiKey}` } : undefined;
    const data = await fetchJson(`${base}/models`, timeoutMs, auth);
    const entries = Array.isArray(data?.data) ? data.data : [];
    models = entries.map((m: any) => m.id).sort();
    // Unsloth Studio marca il modello in RAM con "loaded": true;
    // LM Studio (/api/v0) usa "state": "loaded"
    const loadedEntry = entries.find((m: any) => m.loaded === true || m.state === 'loaded');
    if (loadedEntry?.id) loadedModel = loadedEntry.id;
  } catch {
    // Fallback nativo Ollama per i server locali
    if (!isLocalUrl(base)) return null;
    try {
      const data = await fetchJson(base.replace(/\/v1$/, '') + '/api/tags', timeoutMs);
      if (!Array.isArray(data?.models)) return null;
      models = data.models.map((m: any) => m.name).sort();
    } catch {
      return null;
    }
  }

  // Ollama espone i modelli caricati in RAM su /api/ps: agganciarsi a quello
  // evita di far ricaricare un modello diverso al server.
  if (loadedModel === null && isLocalUrl(base)) {
    try {
      const ps = await fetchJson(base.replace(/\/v1$/, '') + '/api/ps', 1500);
      if (Array.isArray(ps?.models) && ps.models.length > 0 && ps.models[0]?.name) {
        loadedModel = ps.models[0].name;
      }
    } catch {}
  }

  return { name, config, models, loadedModel };
}

/**
 * Forza il caricamento di un modello sul server inviando una richiesta minima
 * (1 token): i server locali con caricamento just-in-time (Unsloth Studio,
 * Ollama) caricano il modello richiesto prima di rispondere. Il timeout è
 * largo perché lo swap di un GGUF grande può richiedere minuti.
 */
export async function warmUpModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs = 300_000
): Promise<boolean> {
  const base = baseUrl.replace(/\/+$/, '');
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey && apiKey !== 'local' ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ok' }],
        max_tokens: 1,
        stream: false
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Scansiona i provider candidati: prima quello attivo in configurazione, poi
 * (se non risponde) gli altri server locali in parallelo. I provider remoti
 * non attivi non vengono interrogati per non dipendere dalla rete all'avvio.
 */
export async function scanProviders(
  candidates: ScanCandidate[],
  activeName: string
): Promise<ProviderScanResult | null> {
  const active = candidates.find((c) => c.name === activeName);
  if (active) {
    const result = await probeProvider(active.name, active.config, active.apiKey);
    if (result) return result;
  }

  const localOthers = candidates.filter(
    (c) => c.name !== activeName && isLocalUrl(c.config.baseUrl)
  );
  const results = await Promise.all(
    localOthers.map((c) => probeProvider(c.name, c.config, c.apiKey))
  );
  return results.find((r): r is ProviderScanResult => r !== null) ?? null;
}
