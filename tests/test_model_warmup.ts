/**
 * T14.19: `/models` in the TUI updated TSUKA's own pointer but never actually asked the server
 * to load the newly-selected model — the CLI's warm-up request (`warmUpModel`, a real 1-token
 * completion that forces the swap) existed only behind an interactive `prompts()` confirmation
 * that can't render inside the TUI, so the TUI's model-switch paths never called it at all. This
 * covers the extracted, prompt-free warm-up (`warmUpIfNeeded`/`syncModelOnServer` in
 * `cli/commands/provider.ts`) that the TUI now calls directly.
 *
 * Isolamento (stesso schema di test_context_budget.ts): TSUKA_HOME temporaneo con un
 * tsuka.config.json dedicato — `syncModelOnServer` costruisce un `ConfigManager` reale, la cui
 * `setActiveProvider` scrive su CONFIG_PATH; senza isolamento scriverebbe sul config reale
 * dell'utente. Import dinamico DOPO aver impostato TSUKA_HOME, perché CONFIG_PATH viene
 * calcolato al load del modulo core/config.ts (e cli/commands/provider.ts lo importa).
 * Esecuzione: npx tsx tests/test_model_warmup.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
  console.log('=== Test warm-up del modello senza prompt interattivo (T14.19) ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-warmup-home-'));
  fs.writeFileSync(
    path.join(tmpHome, 'tsuka.config.json'),
    JSON.stringify({
      activeProvider: 'unsloth',
      providers: {
        ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' },
        openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'x' },
        unsloth: { baseUrl: 'http://localhost:8090/v1', model: 'model-a' },
      },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer',
      activeTrait: 'professional',
      activeCharacter: 'custom',
    }, null, 2)
  );
  process.env.TSUKA_HOME = tmpHome;

  // Import dinamico DOPO aver impostato TSUKA_HOME: CONFIG_PATH è calcolato al load del modulo.
  const { warmUpIfNeeded, syncModelOnServer } = await import('../src/cli/commands/provider');
  const { ConfigManager } = await import('../src/core/config');
  const { setLogSink, resetLogSink } = await import('../src/core/logSink');

  let messages: Array<{ level: 'log' | 'warn' | 'error'; text: string }> = [];
  setLogSink({
    log: (text) => messages.push({ level: 'log', text }),
    warn: (text) => messages.push({ level: 'warn', text }),
    error: (text) => messages.push({ level: 'error', text }),
  });

  // These paths only ever run from the TUI (see T14.19) — TSUKA_TUI makes CLITheme.createSpinner
  // return the T14.17 shim that reports through logSink instead of a real ora spinner writing
  // straight to stdout, so this actually exercises the code path that matters.
  process.env.TSUKA_TUI = '1';

  const originalFetch = globalThis.fetch;

  // 1) Remote provider: never worth a warm-up request, must never even try.
  messages = [];
  globalThis.fetch = (async () => { throw new Error('must not be called'); }) as any;
  await warmUpIfNeeded('https://openrouter.ai/api/v1', 'key', 'gpt-x', 'gpt-old');
  check('WU1', messages.length === 0, 'nessuna chiamata per un provider remoto (non locale)');

  // 2) No baseline loaded model: nothing to compare against, must never try.
  messages = [];
  globalThis.fetch = (async () => { throw new Error('must not be called'); }) as any;
  await warmUpIfNeeded('http://localhost:8090/v1', 'local', 'llama3', null);
  check('WU2', messages.length === 0, 'nessuna chiamata se non si sa cosa è già caricato');

  // 3) Requested model already loaded: nothing to do.
  messages = [];
  globalThis.fetch = (async () => { throw new Error('must not be called'); }) as any;
  await warmUpIfNeeded('http://localhost:8090/v1', 'local', 'llama3', 'llama3');
  check('WU3', messages.length === 0, 'nessuna chiamata se il modello richiesto è già quello caricato');

  // 4) Local server with a genuinely different model loaded: sends the real warm-up request.
  messages = [];
  let warmUpBody: any = null;
  let warmUpUrl = '';
  globalThis.fetch = (async (url: any, init: any) => {
    warmUpUrl = String(url);
    warmUpBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({}) } as Response;
  }) as any;
  await warmUpIfNeeded('http://localhost:8090/v1', 'local', 'llama3-new', 'llama3-old');
  check('WU4a', warmUpUrl === 'http://localhost:8090/v1/chat/completions', `endpoint corretto: ${warmUpUrl}`);
  check('WU4b', warmUpBody?.model === 'llama3-new' && warmUpBody?.max_tokens === 1, `richiesta minimale sul modello target: ${JSON.stringify(warmUpBody)}`);
  check('WU4c', messages.some((m) => m.level === 'log' && m.text.includes('llama3-new') && m.text.includes('loaded and ready')), `esito riportato via logSink: ${JSON.stringify(messages)}`);

  // 5) Failed warm-up: reported as a warning, never throws.
  messages = [];
  globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) }) as Response) as any;
  let threw = false;
  try {
    await warmUpIfNeeded('http://localhost:8090/v1', 'local', 'llama3-new', 'llama3-old');
  } catch {
    threw = true;
  }
  check('WU5', !threw && messages.some((m) => m.level === 'warn' && m.text.includes('Warm up request failed')), 'fallimento riportato come warning, nessun crash');

  // 6) syncModelOnServer: probes what the server has loaded, then warms up only if it differs
  //    from the target — the path the TUI's own /models command actually calls.
  messages = [];
  const configManager = new ConfigManager();
  let warmUpCalled = false;
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.endsWith('/v1/models')) {
      return { ok: true, json: async () => ({ data: [{ id: 'model-a', loaded: true }, { id: 'model-b' }] }) } as Response;
    }
    if (u.endsWith('/props') || u.endsWith('/slots')) return { ok: false, json: async () => ({}) } as Response;
    if (u.endsWith('/chat/completions')) {
      warmUpCalled = true;
      const body = JSON.parse(init.body);
      check('WU6b', body.model === 'model-b', `warm-up sul modello target scelto, non su quello caricato: ${body.model}`);
      return { ok: true, json: async () => ({}) } as Response;
    }
    return { ok: false, json: async () => ({}) } as Response;
  }) as any;
  await syncModelOnServer(configManager, 'model-b');
  check('WU6a', warmUpCalled, 'un modello target diverso da quello caricato scatena il warm-up');

  globalThis.fetch = originalFetch;
  resetLogSink();
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.TSUKA_HOME;
  delete process.env.TSUKA_TUI;

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
