import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleInitCmd, parseInitArgs } from '../src/cli/initCmd';

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
  console.log('=== Test Comando tsuka init (T7.2) ===\n');

  // Test 1: Parsing argomenti CLI
  {
    const opts = parseInitArgs(['--preset', 'full', '--pack', 'osint,devops', '--force']);
    check('IT1a', opts.preset === 'full', 'parseInitArgs rispetta --preset full');
    check('IT1b', opts.pack?.length === 2 && opts.pack.includes('osint') && opts.pack.includes('devops'), 'parseInitArgs rispetta --pack multilinea/lista');
    check('IT1c', opts.force === true, 'parseInitArgs rispetta --force');
  }

  // Test 2: Inizializzazione in cartella temporanea (preset core)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-init-test-'));
  try {
    const success = await handleInitCmd(['--preset', 'core'], tempDir);
    check('IT2a', success === true, 'handleInitCmd restituisce true su cartella nuova');

    const tsukaDir = path.join(tempDir, '.tsuka');
    check('IT2b', fs.existsSync(tsukaDir), 'cartella .tsuka/ creata con successo');
    check('IT2c', fs.existsSync(path.join(tsukaDir, 'config.json')), '.tsuka/config.json creato');

    const subDirs = ['memory', 'workflow_logs', 'output', 'roles', 'traits', 'characters', 'teams'];
    const allDirsExist = subDirs.every((d) => fs.existsSync(path.join(tsukaDir, d)));
    check('IT2d', allDirsExist, 'tutte le sottocartelle obbligatorie sono state create');

    // I nomi non si scrivono qui: si leggono dal manifest, che è la fonte di verità
    // di cosa il preset core deve installare.
    const coreManifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'presets', 'core.json'), 'utf-8'));
    const missingChars = (coreManifest.characters || []).filter(
      (c: string) => !fs.existsSync(path.join(tsukaDir, 'characters', `${c}.json`))
    );
    check('IT2e', missingChars.length === 0, `tutti i personaggi del preset core sono stati copiati (mancanti: ${missingChars.join(', ') || 'nessuno'})`);

    // Test 3: Re-init senza --force viene rifiutato
    const reInitNoForce = await handleInitCmd(['--preset', 'core'], tempDir);
    check('IT3', reInitNoForce === false, 're-init senza --force restituisce false e non sovrascrive');

    // Test 4: Re-init con --force ha successo
    const reInitForce = await handleInitCmd(['--preset', 'core', '--force'], tempDir);
    check('IT4', reInitForce === true, 're-init con --force sovrascrive con successo');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Test 5: Init con pack opzionale (--pack osint)
  const tempDirPack = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-init-pack-test-'));
  try {
    const success = await handleInitCmd(['--preset', 'core', '--pack', 'osint'], tempDirPack);
    check('IT5a', success === true, 'init con --pack osint ha successo');
    const packManifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'presets', 'packs', 'osint.json'), 'utf-8')
    );
    const missingPackChars = (packManifest.characters || []).filter(
      (c: string) => !fs.existsSync(path.join(tempDirPack, '.tsuka', 'characters', `${c}.json`))
    );
    check('IT5b', missingPackChars.length === 0,
      `i personaggi elencati nel pack osint sono stati copiati (mancanti: ${missingPackChars.join(', ') || 'nessuno'})`);
  } finally {
    fs.rmSync(tempDirPack, { recursive: true, force: true });
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test init:', err);
  process.exit(1);
});
