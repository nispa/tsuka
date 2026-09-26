/**
 * Session lifecycle regressions reported by the maintainer (2026-09-27):
 * - failing over to another provider at startup must not rewrite the user's choice in
 *   tsuka.config.json (one slow start of Unsloth Studio moved TSUKA to OpenRouter for good);
 * - /reset in the TUI must clear the context tracker and the header counters, as the CLI's
 *   /reset already cleared the tracker.
 *
 * Run: npx tsx tests/test_session_reset_failover.ts
 */
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-session-'));
  const priorHome = process.env.TSUKA_HOME;
  process.env.TSUKA_HOME = home;
  fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(home, 'providers.json'));
  const configFile = path.join(home, 'tsuka.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ activeProvider: 'unsloth', workspaceRoot: process.cwd() }));
  const saved = () => JSON.parse(fs.readFileSync(configFile, 'utf-8'));

  const { ConfigManager } = await import('../src/core/config');
  try {
    // --- startup failover is session-only ---
    ConfigManager.useProviderForSession('ollama');
    const cm = new ConfigManager();
    check('SR.1', cm.getActiveProviderName() === 'ollama' && new ConfigManager().getActiveProviderName() === 'ollama',
      'every ConfigManager instance sees the session provider');
    cm.updateActiveModel('some-model');
    check('SR.2', saved().activeProvider === 'unsloth' && cm.getConfiguredProviderName() === 'unsloth',
      'saving the config (e.g. a model change) keeps the user choice on disk');
    check('SR.3', saved().providerOverrides?.ollama?.model === 'some-model', 'the model change applies to the provider actually in use');
    cm.setActiveProvider('openrouter');
    check('SR.4', saved().activeProvider === 'openrouter' && new ConfigManager().getActiveProviderName() === 'openrouter',
      'an explicit /provider choice is saved and ends the session override');

    // --- /reset in the TUI clears the tracker and the counters ---
    const { ContextTracker } = await import('../src/core/contextTracker');
    const { TuiStore } = await import('../src/tui/store');
    const { findCommand } = await import('../src/tui/commands');
    const tracker = ContextTracker.getInstance();
    tracker.addEntry({ timestamp: new Date().toISOString(), agentName: 'a', tokenCount: 10, promptTokens: 100 } as any);
    tracker.recordDecision('delegate');
    const store = new TuiStore();
    store.updateStats({ usedTokens: 5000, percentage: 61, maxTokens: 16384, turnCount: 7, toolCallsCount: 12 });
    let resetCalls = 0;
    await findCommand('/reset')!.run({
      store,
      setAgent: () => {},
      recreateAgent: () => ({}) as any,
      cliContext: () => ({ permissionManager: { resetSession: () => resetCalls++ } }) as any,
    } as any, '');
    const stats = store.getState().stats;
    check('SR.5', tracker.getAll().length === 0 && tracker.getSchedulerMetrics().delegateDecisions === 0,
      '/reset empties the context tracker and its scheduler metrics');
    check('SR.6', stats.usedTokens === 0 && stats.percentage === 0 && stats.turnCount === 0 && stats.maxTokens === 16384,
      '/reset zeroes the header counters and keeps the window size');
    check('SR.7', resetCalls === 1, 'session permissions are reset too');
  } finally {
    ConfigManager.useProviderForSession(null);
    if (priorHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = priorHome;
    fs.rmSync(home, { recursive: true, force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal test error:', error);
  process.exit(1);
});
