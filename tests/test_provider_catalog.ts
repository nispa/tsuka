/** Contract tests for the data-driven provider catalogue. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let passed = 0;
let failed = 0;
function check(id: string, condition: boolean, detail: string): void {
  if (condition) { passed++; console.log(`PASS ${id} - ${detail}`); }
  else { failed++; console.log(`FAIL ${id} - ${detail}`); }
}

async function main(): Promise<void> {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-provider-catalog-'));
  const catalog = {
    version: 1,
    providers: {
      alpha: {
        displayName: 'Alpha Gateway', class: 'CLOUD', baseUrl: 'https://alpha.example/v1',
        defaultModel: 'alpha-default', apiKeyEnv: 'ALPHA_TEST_KEY',
        capabilities: { freeModels: { suffixes: [':gratis'], includeZeroPriced: true } }
      },
      beta: {
        displayName: 'Beta Local', class: 'LOCAL', baseUrl: 'http://127.0.0.1:9999/v1',
        defaultModel: 'beta-default', capabilities: {}
      }
    }
  };
  fs.writeFileSync(path.join(tempHome, 'providers.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(tempHome, 'tsuka.config.json'), JSON.stringify({
    activeProvider: 'alpha', providerOverrides: { alpha: { model: 'alpha-selected' } },
    webSearch: { provider: 'duckduckgo' }, activeRole: 'developer', activeTrait: 'professional', activeCharacter: 'custom'
  }, null, 2));
  process.env.TSUKA_HOME = tempHome;
  process.env.ALPHA_TEST_KEY = 'catalog-secret';

  try {
    const { ConfigManager } = await import('../src/core/config');
    const { getModelTier } = await import('../src/tools/registry');
    const { filterProviderModels } = await import('../src/core/modelCatalog');
    const manager = new ConfigManager();
    const active = manager.getActiveProviderConfig();

    check('CAT.1', manager.getProviderNames().join(',') === 'alpha,beta', 'provider names come only from providers.json');
    check('CAT.2', active.model === 'alpha-selected' && active.baseUrl === 'https://alpha.example/v1', 'runtime config merges catalogue data with model overrides');
    check('CAT.3', active.class === 'CLOUD' && manager.isParallelExecutionEnabled(), 'CLOUD class drives shared cloud policy');
    check('CAT.4', manager.getApiKey() === 'catalog-secret', 'apiKeyEnv is resolved without provider-specific code');
    check('CAT.5', getModelTier('unknown', undefined, active.baseUrl, active.class) === 'large', 'tool tier consumes provider class, not URL identity');
    check('CAT.6', JSON.stringify(filterProviderModels(['paid', 'model:gratis'], 'free', active.capabilities.freeModels)) === JSON.stringify(['model:gratis']), 'free filtering consumes the declared capability');
    check('CAT.7', !fs.readFileSync(path.join(process.cwd(), 'src/core/cloudProvider.ts'), 'utf8').includes('alpha'), 'provider identities are absent from policy code');
  } finally {
    delete process.env.ALPHA_TEST_KEY;
    delete process.env.TSUKA_HOME;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
