/** Regression tests for workspace-local configuration selection and persistence. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let passed = 0;
let failed = 0;
function check(id: string, condition: boolean, detail: string): void {
  if (condition) { passed++; console.log(`✔ ${id} PASS — ${detail}`); }
  else { failed++; console.log(`✘ ${id} FAIL — ${detail}`); }
}

async function main(): Promise<void> {
  const originalCwd = process.cwd();
  const originalTsukaHome = process.env.TSUKA_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-config-workspace-home-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-config-workspace-'));
  process.env.TSUKA_HOME = home;
  fs.copyFileSync(path.join(originalCwd, 'providers.json'), path.join(home, 'providers.json'));
  const globalPath = path.join(home, 'tsuka.config.json');
  const localDir = path.join(workspace, '.tsuka');
  const localPath = path.join(localDir, 'config.json');
  fs.writeFileSync(globalPath, JSON.stringify({ activeProvider: 'ollama' }));
  const globalBytesBefore = fs.readFileSync(globalPath);
  fs.mkdirSync(localDir);
  fs.writeFileSync(localPath, JSON.stringify({ activeProvider: 'openrouter' }));

  try {
    process.chdir(workspace);
    const { ConfigManager, CONFIG_PATH } = await import('../src/core/config');
    const local = new ConfigManager();
    check('CFGWS.1', path.resolve(CONFIG_PATH) === path.resolve(localPath), 'local config has precedence');
    check('CFGWS.2', local.getActiveProviderName() === 'openrouter', 'runtime reads the selected local config');
    local.setActiveCharacter('workspace-only');
    check('CFGWS.3', JSON.parse(fs.readFileSync(localPath, 'utf8')).activeCharacter === 'workspace-only', 'writes use the selected local config');
    check('CFGWS.4', fs.readFileSync(globalPath).equals(globalBytesBefore), 'global config bytes remain unchanged');

    fs.rmSync(localDir, { recursive: true, force: true });
    const fallback = new ConfigManager();
    check('CFGWS.5', fallback.getActiveProviderName() === 'ollama', 'global config is the fallback without a local config');
    const globalBytesAfterFallback = fs.readFileSync(globalPath);

    fs.mkdirSync(localDir);
    fs.writeFileSync(localPath, '{ broken');
    const recovered = new ConfigManager();
    const backups = fs.readdirSync(localDir).filter((name) => name.startsWith('config.json.corrupt-'));
    check('CFGWS.6', backups.length === 1 && recovered.getActiveProviderName() === 'ollama', 'local corruption is recovered in place');
    check('CFGWS.7', fs.readFileSync(globalPath).equals(globalBytesAfterFallback), 'global config bytes survive local recovery');
  } finally {
    process.chdir(originalCwd);
    if (originalTsukaHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = originalTsukaHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
