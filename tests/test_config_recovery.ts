/** Regression tests for T23.2: invalid configuration recovery and atomic persistence. */
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
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-config-recovery-'));
  process.env.TSUKA_HOME = tmpHome;
  fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(tmpHome, 'providers.json'));

  const { ConfigManager } = await import('../src/core/config');
  const configPath = path.join(tmpHome, 'tsuka.config.json');

  try {
    const malformed = '{"activeProvider":"ollama",';
    fs.writeFileSync(configPath, malformed, 'utf8');
    const recovered = new ConfigManager();
    const backups = fs.readdirSync(tmpHome).filter((name) => name.startsWith('tsuka.config.json.corrupt-'));
    check('CFGREC.1', backups.length === 1, 'malformed configuration gets one recoverable backup');
    check('CFGREC.2', fs.readFileSync(path.join(tmpHome, backups[0]), 'utf8') === malformed, 'backup preserves the original bytes exactly');
    check('CFGREC.3', recovered.getActiveProviderName() === 'ollama', 'defaults are restored after malformed configuration');

    recovered.setActiveProvider('unsloth');
    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { activeProvider: string };
    check('CFGREC.4', persisted.activeProvider === 'unsloth', 'a recovered configuration can be persisted atomically');
    check('CFGREC.5', !fs.readdirSync(tmpHome).some((name) => name.includes('.tmp-')), 'temporary config files are not left behind');

    const semanticInvalid = JSON.stringify({ activeProvider: 42 });
    fs.writeFileSync(configPath, semanticInvalid, 'utf8');
    new ConfigManager();
    const semanticBackups = fs.readdirSync(tmpHome).filter((name) => name.startsWith('tsuka.config.json.corrupt-'));
    const semanticBackup = semanticBackups
      .map((name) => path.join(tmpHome, name))
      .find((candidate) => fs.readFileSync(candidate, 'utf8') === semanticInvalid);
    check('CFGREC.6', Boolean(semanticBackup), 'semantically invalid JSON is backed up before recovery');

    const fixedNow = Date.now;
    try {
      Date.now = () => 1700000000000;
      const collisionPath = path.join(tmpHome, 'tsuka.config.json.corrupt-1700000000000');
      fs.writeFileSync(collisionPath, 'existing backup', 'utf8');
      fs.writeFileSync(configPath, '[1,2,3]', 'utf8');
      new ConfigManager();
    } finally {
      Date.now = fixedNow;
    }
    check('CFGREC.7', fs.existsSync(path.join(tmpHome, 'tsuka.config.json.corrupt-1700000000000-1')), 'backup naming remains collision-safe');
  } finally {
    delete process.env.TSUKA_HOME;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
