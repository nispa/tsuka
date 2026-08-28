/**
 * Regression coverage for provider-aware model discovery.
 *
 * When no local backend is reachable, startup may fall back to an authenticated
 * remote provider. The TUI model picker must also expose provider selection when
 * the active backend cannot return a model list.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

async function main(): Promise<void> {
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-provider-fallback-'));
  fs.writeFileSync(path.join(temporaryHome, 'tsuka.config.json'), JSON.stringify({
    activeProvider: 'ollama',
    providers: {
      ollama: { baseUrl: 'http://localhost:11434/v1', model: 'local-model' },
      openrouter: { baseUrl: 'https://openrouter.test/api/v1', model: 'cloud/model' },
      custom: { baseUrl: 'https://custom.test/v1', model: 'custom/model' },
    },
    webSearch: { provider: 'duckduckgo' },
    activeRole: 'developer',
    activeTrait: 'professional',
    activeCharacter: 'custom',
  }, null, 2));
  fs.writeFileSync(path.join(temporaryHome, 'providers.json'), JSON.stringify({
    version: 1,
    providers: {
      ollama: { displayName: 'Local', class: 'LOCAL', baseUrl: 'http://localhost:11434/v1', defaultModel: 'local-model', capabilities: {} },
      openrouter: {
        displayName: 'Cloud', class: 'CLOUD', baseUrl: 'https://openrouter.test/api/v1', defaultModel: 'cloud/model',
        capabilities: { freeModels: { aliases: ['openrouter/free'], suffixes: [':free'], includeZeroPriced: true } }
      }
    }
  }, null, 2));
  process.env.TSUKA_HOME = temporaryHome;

  const { scanProviders } = await import('../src/core/discovery');
  const { ConfigManager } = await import('../src/core/config');
  const { TuiStore } = await import('../src/tui/store');
  const { SystemModals } = await import('../src/tui/modals/systemModals');
  const { hasZeroTokenPricing, isFreeModel, filterProviderModels } = await import('../src/core/modelCatalog');
  const freeCapability = { aliases: ['openrouter/free'], suffixes: [':free'], includeZeroPriced: true };
  const originalFetch = globalThis.fetch;

  try {
    let remoteCalls = 0;
    let openRouterModels = ['cloud/model'];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = String(url);
      if (target === 'http://localhost:11434/v1/models') {
        return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
      }
      if (target.startsWith('https://openrouter.test/')) {
        remoteCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: openRouterModels.map((id) => ({
            id,
            context_length: 128_000,
            pricing: id === 'stealth/ox-alpha' ? { prompt: '0', completion: '0' } : undefined,
          })) }),
        } as Response;
      }
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const remoteFallback = await scanProviders([
      { name: 'ollama', config: { baseUrl: 'http://localhost:11434/v1', model: 'local-model' }, apiKey: 'local' },
      { name: 'openrouter', config: { baseUrl: 'https://openrouter.test/api/v1', model: 'cloud/model' }, apiKey: 'secret-key' },
    ], 'ollama');
    check('PF1', remoteFallback?.name === 'openrouter' && remoteFallback.models.includes('cloud/model'), 'an authenticated remote provider replaces a local backend with no models');

    remoteCalls = 0;
    const anonymousFallback = await scanProviders([
      { name: 'ollama', config: { baseUrl: 'http://localhost:11434/v1', model: 'local-model' }, apiKey: 'local' },
      { name: 'openrouter', config: { baseUrl: 'https://openrouter.test/api/v1', model: 'cloud/model' }, apiKey: '' },
    ], 'ollama');
    check('PF2', anonymousFallback === null && remoteCalls === 0, 'an unauthenticated remote provider is not reported as chat-ready');

    const configManager = new ConfigManager();
    const store = new TuiStore();
    const provider = {
      getCurrentModel: () => 'local-model',
      getBaseUrl: () => 'http://localhost:11434/v1',
      listModels: async () => { throw new Error('offline'); },
      setCurrentModel: () => {},
      reconfigure: () => {},
    } as any;

    await SystemModals.openModelModal(store, provider, configManager, () => {}, () => {}, async () => {});
    const failureModal = store.getState().activeModal;
    check(
      'PF3',
      failureModal?.title === 'Select LLM Provider Gateway' && failureModal.options?.some((option) => option.value === 'openrouter') === true,
      'the model picker opens provider selection when the active backend is offline'
    );

    configManager.setActiveProvider('openrouter');
    provider.getCurrentModel = () => 'cloud/model';
    provider.getBaseUrl = () => 'https://openrouter.test/api/v1';
    provider.listModels = async () => ['cloud/model'];
    await SystemModals.openModelModal(store, provider, configManager, () => {}, () => {}, async () => {});
    const modelModal = store.getState().activeModal;
    check(
      'PF4',
      modelModal?.options?.[0]?.value === '__change_provider__',
      'the normal model list always includes an explicit provider selector'
    );

    check(
      'PF5',
      modelModal?.options?.some((option) => option.value === '__show_free_models__') === true,
      'the OpenRouter model picker exposes the free-model filter'
    );

    const catalogue = ['openrouter/free', 'vendor/paid', 'vendor/model:free'];
    check(
      'PF6',
      isFreeModel('vendor/model:free', freeCapability) && isFreeModel('openrouter/free', freeCapability) && !isFreeModel('vendor/paid', freeCapability),
      'configured free-model suffixes and aliases are recognized'
    );
    check(
      'PF7',
      JSON.stringify(filterProviderModels(catalogue, 'free', freeCapability)) === JSON.stringify(['openrouter/free', 'vendor/model:free']) &&
        filterProviderModels(catalogue, 'free').length === catalogue.length,
      'the free filter applies only when the provider declares the capability'
    );

    check(
      'PF7b',
      hasZeroTokenPricing({ prompt: '0', completion: '0' }) &&
        !hasZeroTokenPricing({ prompt: '0', completion: '0.000001' }) &&
        JSON.stringify(filterProviderModels([...catalogue, 'stealth/ox-alpha'], 'free', freeCapability, ['stealth/ox-alpha'])) ===
          JSON.stringify(['openrouter/free', 'vendor/model:free', 'stealth/ox-alpha']),
      'zero-priced OpenRouter models are free even when their IDs have no :free suffix'
    );

    provider.getCurrentModel = () => 'vendor/model:free';
    provider.listModels = async () => catalogue;
    openRouterModels = catalogue;
    await SystemModals.openModelModal(store, provider, configManager, () => {}, () => {}, async () => {}, 'free');
    const freeModal = store.getState().activeModal;
    check(
      'PF8',
      freeModal?.options?.some((option) => option.value === 'vendor/paid') === false &&
        freeModal?.options?.some((option) => option.value === 'vendor/model:free') === true &&
        freeModal?.options?.some((option) => option.value === '__show_all_models__') === true,
      'the TUI free view hides paid models and offers a way back to the full catalogue'
    );

    openRouterModels = [...catalogue, 'stealth/ox-alpha'];
    await SystemModals.openModelModal(store, provider, configManager, () => {}, () => {}, async () => {}, 'free');
    const pricedFreeModal = store.getState().activeModal;
    check(
      'PF9',
      pricedFreeModal?.options?.some((option) => option.value === 'stealth/ox-alpha') === true,
      'the TUI free view includes models advertised with zero prompt and completion pricing'
    );
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(temporaryHome, { recursive: true, force: true });
    delete process.env.TSUKA_HOME;
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
