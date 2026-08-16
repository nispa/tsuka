/**
 * Test per T11.5 — Dynamic Context Window Auto-Detection.
 *
 * Verifica che detectContextWindow estragga correttamente la dimensione del context
 * window da vari payload e formati di server (llama-server /props e /slots, Ollama /api/show,
 * OpenRouter /models, vLLM /models) e che ConfigManager applichi la precedenza dinamica.
 *
 * Esecuzione: npx tsx tests/test_context_detection.ts
 */
import { detectContextWindow } from '../src/core/discovery';
import { ConfigManager } from '../src/core/config';

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
  console.log('=== Test Dynamic Context Window Auto-Detection (T11.5) ===\n');

  const originalFetch = globalThis.fetch;

  try {
    // 1. llama-server (/props)
    {
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/props')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              default_generation_settings: { n_ctx: 32768, n_predict: 4096 }
            })
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      const ctx = await detectContextWindow('http://localhost:8080/v1', '', 'qwen2.5-coder:7b');
      check('CD.1', ctx === 32768, `llama-server /props rileva correttamente n_ctx (32768, ottenuto: ${ctx})`);
    }

    // 2. llama-server (/slots)
    {
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/props')) {
          return { ok: false, status: 404 } as any;
        }
        if (urlStr.includes('/slots')) {
          return {
            ok: true,
            status: 200,
            json: async () => ([
              { id: 0, n_ctx: 16384 }
            ])
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      const ctx = await detectContextWindow('http://127.0.0.1:8080/v1', '', 'llama-3');
      check('CD.2', ctx === 16384, `llama-server fallback /slots rileva n_ctx (16384, ottenuto: ${ctx})`);
    }

    // 3. Ollama (/api/show con model_info)
    {
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/show')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              model_info: {
                "general.architecture": "llama",
                "llama.context_length": 65536
              }
            })
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      const ctx = await detectContextWindow('http://localhost:11434/v1', '', 'qwen2.5:14b');
      check('CD.3', ctx === 65536, `Ollama /api/show rileva context_length da model_info (65536, ottenuto: ${ctx})`);
    }

    // 4. Ollama (/api/show con parameters num_ctx)
    {
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/show')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              parameters: "num_ctx 131072\ntemperature 0.7"
            })
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      const ctx = await detectContextWindow('http://localhost:11434/v1', '', 'custom-model');
      check('CD.4', ctx === 131072, `Ollama /api/show rileva num_ctx da parameters (131072, ottenuto: ${ctx})`);
    }

    // 5. OpenRouter (/models con context_length)
    {
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/models')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "anthropic/claude-3.5-sonnet", context_length: 200000 },
                { id: "meta-llama/llama-3.3-70b-instruct", context_length: 128000 }
              ]
            })
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      const ctx = await detectContextWindow('https://openrouter.ai/api/v1', 'test-key', 'meta-llama/llama-3.3-70b-instruct');
      check('CD.5', ctx === 128000, `OpenRouter /models rileva context_length per modello (128000, ottenuto: ${ctx})`);
    }

    // 6. vLLM (/models con max_model_len)
    {
      globalThis.fetch = async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/models')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "deepseek-ai/DeepSeek-Coder", max_model_len: 65536 }
              ]
            })
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      const ctx = await detectContextWindow('http://localhost:8000/v1', '', 'deepseek-ai/DeepSeek-Coder');
      check('CD.6', ctx === 65536, `vLLM /models rileva max_model_len (65536, ottenuto: ${ctx})`);
    }

    // 7. ConfigManager precedence
    {
      const config = new ConfigManager();
      check('CD.7a', config.getRuntimeContextTokens() === null, 'inizialmente nessun runtimeContextTokens');
      const defaultVal = config.getMaxHistoryTokens();
      check('CD.7b', defaultVal >= 1024, `fallback da config valido (${defaultVal})`);

      config.setRuntimeContextTokens(32768);
      check('CD.7c', config.getMaxHistoryTokens() === 32768, `precedenza runtime attiva (32768)`);

      config.setRuntimeContextTokens(null);
      check('CD.7d', config.getMaxHistoryTokens() === defaultVal, `reset a fallback su rimozione runtime (${defaultVal})`);
    }

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
