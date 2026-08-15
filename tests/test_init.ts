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

    const devChar = path.join(tsukaDir, 'characters', 'dev.json');
    const segugioChar = path.join(tsukaDir, 'characters', 'segugio.json');
    check('IT2e', fs.existsSync(devChar) && fs.existsSync(segugioChar), 'i personaggi del preset core (dev, segugio) sono stati copiati');

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
    const volpeChar = path.join(tempDirPack, '.tsuka', 'characters', 'volpe.json');
    check('IT5b', fs.existsSync(volpeChar), 'il personaggio del pack osint (volpe) è stato copiato');
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
