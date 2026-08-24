/**
 * Test per l'astrazione cross-platform (platform.ts + tool di sistema).
 * Esecuzione: npx tsx tests/test_platform.ts
 */
import { getShellConfig, isWindows, getPlatformName } from '../src/core/platform';
import { executeCommandTool } from '../src/tools/impl/executeCommand';
import { getPsInfoTool } from '../src/tools/impl/getPsInfo';
import { resetLogSink, setLogSink } from '../src/core/logSink';

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
  console.log(`=== Test Cross-Platform (piattaforma corrente: ${getPlatformName()}) ===\n`);

  // --- X1.1: shell config coerente con la piattaforma ---
  const cfg = getShellConfig();
  if (isWindows()) {
    check('X1.1a', cfg.shell === 'powershell.exe', `shell Windows: ${cfg.shell}`);
    check('X1.1b', cfg.buildArgs('echo hi').includes('-Command'), 'argomenti PowerShell presenti');
  } else {
    check('X1.1a', cfg.shell === '/bin/sh', `shell POSIX: ${cfg.shell}`);
    check('X1.1b', cfg.buildArgs('echo hi')[0] === '-c', 'argomenti sh presenti');
  }

  // --- X1.2: execute_command works and routes live output through logSink ---
  const marker = `probe_${Date.now()}`;
  const echoCmd = isWindows() ? `Write-Output ${marker}` : `echo ${marker}`;
  let streamedOutput = '';
  let rawWrites = 0;
  const originalStdoutWrite = process.stdout.write;
  setLogSink({
    log: () => {},
    warn: () => {},
    error: () => {},
    write: (text) => { streamedOutput += text; },
  });
  (process.stdout as any).write = () => { rawWrites++; return true; };
  let out = '';
  try {
    out = await executeCommandTool.execute({ command: echoCmd });
  } finally {
    (process.stdout as any).write = originalStdoutWrite;
    resetLogSink();
  }
  check('X1.2', out.includes(marker), `execute_command cross-platform: output contiene il marker`);
  check('X1.2b', streamedOutput.includes(marker), 'execute_command streams output through logSink');
  check('X1.2c', rawWrites === 0, 'execute_command never writes directly to stdout');

  // --- X1.3: get_ps_info 'processes' e 'env' funzionano e filtrano i segreti ---
  process.env.PLATFORM_PROBE_SECRET_KEY = 'valore_segreto_probe';
  const procOut = await getPsInfoTool.execute({ category: 'processes' });
  check('X1.3a', procOut.length > 10 && !procOut.startsWith('Errore') && !procOut.startsWith('Error') && !procOut.startsWith('Failed'), `processi elencati (${procOut.length} caratteri)`);

  const envOut = await getPsInfoTool.execute({ category: 'env' });
  check('X1.3b', !envOut.includes('PLATFORM_PROBE_SECRET_KEY') && !envOut.includes('valore_segreto_probe'), 'env filtrata su questa piattaforma');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
