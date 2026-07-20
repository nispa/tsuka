/**
 * Test runner per Tsuka.
 * Esecuzione: npm test   (oppure npx tsx tests/run_tests.ts)
 *
 * Esegue tutte le suite di test e riporta il risultato aggregato.
 * Ogni suite termina con process.exit(0) in caso di successo o process.exit(1)
 * in caso di fallimento — questo runner le esegue come child process.
 */

import { spawnSync } from 'child_process';
import * as path from 'path';
import chalk from 'chalk';

const testsDir = __dirname;

const suites = [
  'test_think_parser.ts',
  'test_markdown_render.ts',
  'test_phase1_fixes.ts',
  'test_phase2_fixes.ts',
  'test_memory.ts',
  'test_phase3_fixes.ts',
  'test_fingerprinting.ts',
  'test_self_authoring.ts',
  'test_platform.ts',
  'test_team_loop.ts',
  'test_roles.ts',
  'test_tier_pruning.ts',
  'test_characters.ts',
  'test_traits.ts',
];

let passed = 0;
let failed = 0;

console.log(chalk.bold('=== Tsuka Test Suite ===\n'));

for (const suite of suites) {
  const fullPath = path.join(testsDir, suite);
  const start = Date.now();
  // Usa node con --import tsx invece di npx (più affidabile cross-platform)
  const result = spawnSync('node', ['--import', 'tsx', fullPath], {
    stdio: 'pipe',
    timeout: 120_000,
    windowsHide: true,
    encoding: 'utf8',
  });

  const elapsed = Date.now() - start;
  const output = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const lastLine = output.split('\n').pop() || '';

  if (result.status === 0) {
    passed++;
    const match = lastLine.match(/(\d+) passati/);
    const count = match ? match[1] : '?';
    console.log(chalk.green(`  PASS  ${suite} (${count} test, ${elapsed}ms)`));
  } else {
    failed++;
    console.log(chalk.red(`  FAIL  ${suite} (${elapsed}ms)`));
    if (stderr.length > 0) {
      console.log(chalk.gray(stderr.slice(0, 300)));
    }
    if (output.length > 0) {
      console.log(output.slice(0, 500));
    }
  }
}

console.log(chalk.bold(`\n=== Risultato: ${chalk.green(passed)} suite OK, ${chalk.red(failed)} fallite ===`));
process.exit(failed > 0 ? 1 : 0);
