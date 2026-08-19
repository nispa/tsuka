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
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';

const testsDir = __dirname;

// T6.5: isola la memoria condivisa reale dell'utente dalla suite di test. Le suite che
// esercitano /goal e Agent col mock scrivono davvero fatti via MemoryStore.getInstance()
// (goal.ts, agent.ts) — senza questo, npm test sporca memory/memory.json. Un solo punto di
// isolamento: TSUKA_MEMORY_FILE punta a un file in una cartella temporanea, letto da
// MemoryStore quando non si passa un filePath esplicito (src/core/memory.ts). Le suite
// girano come child process (spawnSync eredita process.env di default), quindi basta
// impostarla qui prima del loop. Cartella ripulita alla fine, qualunque sia l'esito.
const testMemoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-test-memory-'));
process.env.TSUKA_MEMORY_FILE = path.join(testMemoryDir, 'memory.json');

const suites = [
  'test_think_parser.ts',
  'test_markdown_render.ts',
  'test_phase1_fixes.ts',
  'test_phase2_fixes.ts',
  'test_memory.ts',
  'test_memory_scope.ts',
  'test_phase3_fixes.ts',
  'test_fingerprinting.ts',
  'test_benchmark_dsl.ts',
  'test_self_authoring.ts',
  'test_platform.ts',
  'test_team_loop.ts',
  'test_completer.ts',
  'test_interrupt.ts',
  'test_roles.ts',
  'test_tier_pruning.ts',
  'test_characters.ts',
  'test_traits.ts',
  'test_presets.ts',
  'test_workspace_jail.ts',
  'test_mock_provider.ts',
  'test_protocol_parsing.ts',
  'test_token_calibration.ts',
  'test_team_modes.ts',
  'test_goal_orchestrator.ts',
  'test_permission_queue.ts',
  'test_parallel_workspace.ts',
  'test_blackboard.ts',
  'test_context_budget.ts',
  'test_spawn_agent_context.ts',
  'test_memory_phase3.ts',
  'test_reasoning_effort.ts',
  'test_effort_propagation.ts',
  'test_generation_timeout.ts',
  'test_spawn_agent_reasoning_effort.ts',
  'test_prompt_overhead.ts',
  'test_deferred_tools.ts',
  'test_memory_dedup.ts',
  'test_effort_command.ts',
  'test_multi_skill.ts',
  'test_loop.ts',
  'test_init.ts',
  'test_sampling_params.ts',
  'test_security_agent.ts',
  'test_malformed_toolcall_retry.ts',
  'test_write_file_append.ts',
  'test_reasoning_memory.ts',
  'test_context_detection.ts',
  'test_toolcall_sanitization.ts',
  'test_reasoning_budget.ts',
  'test_safe_tools.ts',
  'test_call.ts',
  'test_team.ts',
  'test_browser_evolution.ts',
  'test_download_file.ts',
  'test_mention_completion.ts',
  'test_escalation_tools.ts',
  'test_continue_command.ts',
  'test_config_limits.ts',
  'test_tui.ts',
  'test_tui_subagent_queue_copy.ts',
  'test_tui_fileviewer_export.ts',
  'test_multiline_tools_filter.ts',
  'test_inference_telemetry.ts',
  'test_tui_data_driven.ts',
  'test_cli_spinner.ts',
  'test_files_explorer.ts',
  'test_wiki_build.ts'
];

let passed = 0;
let failed = 0;

console.log(chalk.bold('=== Tsuka Test Suite ===\n'));

for (const suite of suites) {
  const fullPath = path.join(testsDir, suite);
  const start = Date.now();
  // Usa process.execPath con --import tsx e cwd/env espliciti (massima affidabilità cross-platform)
  const result = spawnSync(process.execPath, ['--import', 'tsx', fullPath], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
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

// Pulizia della cartella di memoria temporanea (T6.5): non deve restare nulla nel
// filesystem dopo la corsa, successo o fallimento che sia.
try {
  fs.rmSync(testMemoryDir, { recursive: true, force: true });
} catch {}

process.exit(failed > 0 ? 1 : 0);
