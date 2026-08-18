import { ProviderConfig } from './config';

/**
 * Startup scan for LLM servers: probes configured providers to determine
 * which server is active and which model is available (or loaded in RAM).
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
  /** Currently loaded model in RAM (e.g. Ollama's /api/ps endpoint), if detectable. */
  loadedModel: string | null;
  /** Dynamically detected context window length for the active model. */
  contextWindow?: number | null;
}

export function isLocalUrl(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1');
}

/**
 * Dynamically detects the context window size from the active server/model.
 * Supports:
 * - llama-server / llama.cpp (/props, /slots)
 * - Ollama (/api/show -> model_info / parameters)
 * - OpenRouter (/v1/models -> context_length)
 * - vLLM (/v1/models -> max_model_len)
 */
export async function detectContextWindow(
  baseUrl: string,
  apiKey: string = '',
  model: string = '',
  timeoutMs = 2500
): Promise<number | null> {
  const base = baseUrl.replace(/\/+$/, '');
  const baseRoot = base.replace(/\/v1\/?$/, '');
  const auth = { Authorization: `Bearer ${apiKey || 'local'}` };

  // 1. llama-server / llama.cpp (/props)
  if (isLocalUrl(base)) {
    try {
      const props = await fetchJson(`${baseRoot}/props`, timeoutMs);
      const nCtx = props?.default_generation_settings?.n_ctx ?? props?.n_ctx ?? props?.default_generation_settings?.params?.n_ctx;
      if (typeof nCtx === 'number' && nCtx > 0) return nCtx;
    } catch {}

    // Fallback llama-server (/slots)
    try {
      const slots = await fetchJson(`${baseRoot}/slots`, timeoutMs);
      if (Array.isArray(slots) && slots.length > 0) {
        const slotCtx = slots[0]?.n_ctx ?? slots[0]?.params?.n_ctx;
        if (typeof slotCtx === 'number' && slotCtx > 0) return slotCtx;
      }
    } catch {}

    // 2. Ollama (/api/show)
    if (model) {
      try {
        const response = await fetch(`${baseRoot}/api/show`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: model }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (response.ok) {
          const showData = await response.json();
          const info = showData?.model_info || {};
          // Search standard *.context_length keys
          for (const key of Object.keys(info)) {
            if (key.endsWith('.context_length') || key === 'context_length') {
              const val = info[key];
              if (typeof val === 'number' && val > 0) return val;
            }
          }
          // Search in parameters (e.g. "num_ctx 32768")
          if (typeof showData?.parameters === 'string') {
            const match = showData.parameters.match(/num_ctx\s+(\d+)/i);
            if (match) {
              const numCtx = parseInt(match[1], 10);
              if (!isNaN(numCtx) && numCtx > 0) return numCtx;
            }
          }
        }
      } catch {}
    }
  }

  // 3. OpenRouter / vLLM / OpenAI-compatible endpoint (/models)
  try {
    const data = await fetchJson(`${base}/models`, timeoutMs, auth);
    const entries = Array.isArray(data?.data) ? data.data : [];
    if (model) {
      const target = entries.find((m: any) => m.id === model || m.id?.endsWith(`/${model}`));
      if (target) {
        const ctx = target.context_length ?? target.max_model_len ?? target.context_window;
        if (typeof ctx === 'number' && ctx > 0) return ctx;
      }
    }
    // Single model fallback (e.g. vLLM)
    if (entries.length === 1) {
      const ctx = entries[0].context_length ?? entries[0].max_model_len ?? entries[0].context_window;
      if (typeof ctx === 'number' && ctx > 0) return ctx;
    }
  } catch {}

  return null;
}

async function fetchJson(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<any> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Probes a single provider: returns available models and loaded model if reachable, or null.
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
    // Standard OpenAI-compatible endpoint (Ollama, llama.cpp/Unsloth, OpenRouter)
    const auth = { Authorization: `Bearer ${apiKey || 'local'}` };
    const data = await fetchJson(`${base}/models`, timeoutMs, auth);
    const entries = Array.isArray(data?.data) ? data.data : [];
    models = entries.map((m: any) => m.id).sort();
    // Unsloth Studio marks RAM model with "loaded": true; LM Studio uses "state": "loaded"
    const loadedEntry = entries.find((m: any) => m.loaded === true || m.state === 'loaded');
    if (loadedEntry?.id) loadedModel = loadedEntry.id;
  } catch {
    // Native Ollama fallback for local servers
    if (!isLocalUrl(base)) return null;
    try {
      const data = await fetchJson(base.replace(/\/v1$/, '') + '/api/tags', timeoutMs);
      if (!Array.isArray(data?.models)) return null;
      models = data.models.map((m: any) => m.name).sort();
    } catch {
      return null;
    }
  }

  // Ollama exposes loaded RAM models on /api/ps
  if (loadedModel === null && isLocalUrl(base)) {
    try {
      const ps = await fetchJson(base.replace(/\/v1$/, '') + '/api/ps', 1500);
      if (Array.isArray(ps?.models) && ps.models.length > 0 && ps.models[0]?.name) {
        loadedModel = ps.models[0].name;
      }
    } catch {}
  }

  const activeModel = loadedModel ?? config.model ?? (models.length > 0 ? models[0] : '');
  const contextWindow = await detectContextWindow(config.baseUrl, apiKey, activeModel, 1500);

  return { name, config, models, loadedModel, contextWindow };
}

/**
 * Warms up a local model by sending a 1-token minimal request.
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
 * Scans candidate providers: first the configured active provider, then
 * remaining local servers in parallel.
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
