/**
 * Test di regressione per i bug fix della Fase 1 (OPTIMIZATION_PLAN.md).
 * Esecuzione: npx tsx test_phase1_fixes.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { editFileTool } from '../src/tools/impl/editFile';
import { getPsInfoTool } from '../src/tools/impl/getPsInfo';
import { executeCommandTool } from '../src/tools/impl/executeCommand';
import { ConfigManager } from '../src/core/config';

import { isWindows } from '../src/core/platform';

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
  console.log('=== Test regressione Fase 1 ===\n');

  // --- T1.1: editFile non deve interpretare i pattern speciali $ nel replacement ---
  const tmpFile = path.resolve(process.cwd(), '.smoke_t11.txt');
  fs.writeFileSync(tmpFile, 'hello world', 'utf-8');
  const replacement = '$&_$1_$`_END';
  await editFileTool.execute({ path: tmpFile, targetContent: 'world', replacementContent: replacement });
  const content = fs.readFileSync(tmpFile, 'utf-8');
  fs.unlinkSync(tmpFile);
  check('T1.1', content === `hello ${replacement}`, `contenuto: ${JSON.stringify(content)}`);

  // --- T1.3: ConfigManager non riscrive il file se è già completo ---
  // (primo load: applica eventuali default mancanti una tantum; secondo load: nessuna scrittura)
  new ConfigManager();
  const configPath = path.resolve(process.cwd(), 'tsuka.config.json');
  const mtimeBefore = fs.statSync(configPath).mtimeMs;
  await new Promise((r) => setTimeout(r, 50));
  new ConfigManager();
  const mtimeAfter = fs.statSync(configPath).mtimeMs;
  check('T1.3', mtimeBefore === mtimeAfter, 'tsuka.config.json non riscritto su load pulito');

  // --- T1.4: execute_command funziona ancora per comandi normali (no falso timeout) ---
  const isWin = isWindows();
  const dateCmd = isWin ? 'Get-Date -Format "yyyy"' : 'date +%Y';
  const cmdOut = await executeCommandTool.execute({ command: dateCmd });
  check('T1.4', /^\d{4}/m.test(cmdOut) || cmdOut.includes(new Date().getFullYear().toString()), 'comando normale eseguito correttamente');

  // --- T1.6: get_ps_info 'env' non deve esporre variabili sensibili ---
  process.env.SMOKE_TEST_SECRET_KEY = 'valore_segreto_di_test';
  const envOut = await getPsInfoTool.execute({ category: 'env' });
  const leaksSensitive = /SMOKE_TEST_SECRET_KEY|valore_segreto_di_test/.test(envOut);
  const stillWorks = envOut.includes('USERNAME') || envOut.includes('COMPUTERNAME') || envOut.includes('"Name"') || envOut.includes('USER') || envOut.includes('PATH') || envOut.includes('HOME');
  check('T1.6a', !leaksSensitive, 'variabile KEY di test esclusa dal dump env');
  check('T1.6b', stillWorks, 'dump env continua a funzionare per variabili innocue');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
