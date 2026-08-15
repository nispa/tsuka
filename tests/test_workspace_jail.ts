/**
 * Test per la jail del workspace (T0.2, PLANNING-QUALITA.md).
 * Verifica che resolveSafePath rifiuti percorsi fuori dalla workspace root e che,
 * quando "workspaceRoot" non è configurato, il default sia la cwd del processo
 * (non "nessuna restrizione").
 * Esecuzione: npx tsx tests/test_workspace_jail.ts
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
  console.log('=== Test Jail Workspace ===\n');

  // Isola il config in una TSUKA_HOME temporanea: non tocca il tsuka.config.json reale.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-jail-home-'));
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-jail-ws-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-jail-outside-'));

  process.env.TSUKA_HOME = tmpHome;
  fs.writeFileSync(
    path.join(tmpHome, 'tsuka.config.json'),
    JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer',
      activeTrait: 'professional',
      activeCharacter: 'custom',
      workspaceRoot: tmpWorkspace
    }, null, 2)
  );

  // Import dinamico DOPO aver impostato TSUKA_HOME: CONFIG_PATH viene calcolato al load del modulo.
  const { ConfigManager } = await import('../src/core/config');
  const { resolveSafePath } = await import('../src/tools/impl/utils');

  // --- J1: getWorkspaceRoot rispetta il valore esplicito in config ---
  const cfg = new ConfigManager();
  check('J1', cfg.getWorkspaceRoot() === path.resolve(tmpWorkspace), 'workspaceRoot esplicito letto correttamente');

  // --- J2: percorso dentro la workspace è accettato ---
  const insideFile = path.join(tmpWorkspace, 'ok.txt');
  let insideOk = false;
  try {
    resolveSafePath(insideFile);
    insideOk = true;
  } catch {}
  check('J2', insideOk, 'percorso dentro la workspace root non viene rifiutato');

  // --- J3: percorso fuori dalla workspace viene rifiutato con errore descrittivo ---
  const outsideFile = path.join(outsideDir, 'leak.txt');
  let rejected = false;
  let errorMsg = '';
  try {
    resolveSafePath(outsideFile);
  } catch (e: any) {
    rejected = true;
    errorMsg = e.message;
  }
  check('J3', rejected && /[Aa]ccesso negato/.test(errorMsg), `percorso fuori workspace rifiutato: "${errorMsg}"`);

  // --- J4: la workspace root stessa (path esatto, es. list_dir su '.') è accettata ---
  let rootOk = false;
  try {
    resolveSafePath(tmpWorkspace);
    rootOk = true;
  } catch {}
  check('J4', rootOk, 'la workspace root stessa non viene rifiutata (caso list_dir("."))');

  // --- J5: sottocartella della workspace root è accettata ---
  const subDir = path.join(tmpWorkspace, 'sub');
  fs.mkdirSync(subDir);
  let subOk = false;
  try {
    resolveSafePath(path.join(subDir, 'nested.txt'));
    subOk = true;
  } catch {}
  check('J5', subOk, 'sottocartella della workspace root non viene rifiutata');

  // --- J6: senza "workspaceRoot" in config, il default è la cwd del processo (non nessuna restrizione) ---
  fs.writeFileSync(
    path.join(tmpHome, 'tsuka.config.json'),
    JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer',
      activeTrait: 'professional',
      activeCharacter: 'custom'
    }, null, 2)
  );
  const cfgDefault = new ConfigManager();
  check('J6', cfgDefault.getWorkspaceRoot() === process.cwd(), 'workspaceRoot non configurato → default cwd, non "nessuna restrizione"');

  // --- J7: default a cwd rifiuta comunque un percorso fuori dalla cwd ---
  let defaultRejected = false;
  try {
    resolveSafePath(outsideFile);
  } catch {
    defaultRejected = true;
  }
  check('J7', defaultRejected, 'default a cwd blocca comunque un percorso esterno');

  // Pulizia
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpWorkspace, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch {}
  delete process.env.TSUKA_HOME;

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
