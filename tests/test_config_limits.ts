/**
 * Test per le costanti configurabili in tsuka.config.json:
 * maxToolRounds, memoryMaxFacts, maxHistoryTokens, maxHistoryMessages, ecc.
 * Isolamento con TSUKA_HOME temporaneo.
 * Esecuzione: npx tsx tests/test_config_limits.ts
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

async function run() {
  console.log('=== Test Configurable Limits & Settings ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-config-limits-'));
  process.env.TSUKA_HOME = tmpHome;

  const { ConfigManager } = await import('../src/core/config');
  const { Agent } = await import('../src/core/agent');
  const { MemoryStore } = await import('../src/core/memory');
  const { ToolRegistry } = await import('../src/tools/registry');
  const { PermissionManager } = await import('../src/safety/permissions');
  const { MockLLMProvider } = await import('./mocks/mockProvider');

  // 1. Defaults con file config assente
  const config = new ConfigManager();
  check('CFG.1', config.getMaxToolRounds() === 15, `default maxToolRounds è 15 (trovato: ${config.getMaxToolRounds()})`);
  check('CFG.2', config.getMemoryMaxFacts() === 200, `default memoryMaxFacts è 200 (trovato: ${config.getMemoryMaxFacts()})`);
  check('CFG.3', config.getMaxHistoryMessages() === 500, `default maxHistoryMessages è 500 (trovato: ${config.getMaxHistoryMessages()})`);
  check('CFG.4', config.getMaxHistoryTokens() === 65536, `default maxHistoryTokens è 65536 (trovato: ${config.getMaxHistoryTokens()})`);

  // 2. Default propagato ad Agent
  const mockProvider = new MockLLMProvider([{ content: 'ok' }]);
  const registry = new ToolRegistry();
  const pm = new PermissionManager();
  const defaultAgent = new Agent(mockProvider, registry, pm, 'sys');
  check('CFG.5', defaultAgent.getMaxToolRounds() === 15, `Agent default maxToolRounds è 15 (trovato: ${defaultAgent.getMaxToolRounds()})`);

  // 3. Valori personalizzati da tsuka.config.json
  const customConfigPath = path.join(tmpHome, 'tsuka.config.json');
  fs.writeFileSync(
    customConfigPath,
    JSON.stringify({
      activeProvider: 'ollama',
      providers: {
        ollama: { baseUrl: 'http://localhost:11434/v1', model: 'custom-model' }
      },
      maxToolRounds: 25,
      memoryMaxFacts: 50,
      maxHistoryMessages: 100,
      maxHistoryTokens: 16384
    }, null, 2),
    'utf-8'
  );

  const customConfig = new ConfigManager();
  check('CFG.6', customConfig.getMaxToolRounds() === 25, `maxToolRounds legge valore personalizzato 25 (trovato: ${customConfig.getMaxToolRounds()})`);
  check('CFG.7', customConfig.getMemoryMaxFacts() === 50, `memoryMaxFacts legge valore personalizzato 50 (trovato: ${customConfig.getMemoryMaxFacts()})`);
  check('CFG.8', customConfig.getMaxHistoryMessages() === 100, `maxHistoryMessages legge valore personalizzato 100 (trovato: ${customConfig.getMaxHistoryMessages()})`);
  check('CFG.9', customConfig.getMaxHistoryTokens() === 16384, `maxHistoryTokens legge valore personalizzato 16384 (trovato: ${customConfig.getMaxHistoryTokens()})`);

  // 4. Configurazione personalizzata propagata ad Agent
  const customAgent = new Agent(
    mockProvider,
    registry,
    pm,
    'sys',
    undefined,
    customConfig.getMaxHistoryMessages(),
    customConfig.getMaxHistoryTokens(),
    undefined,
    undefined,
    undefined,
    customConfig.getMaxToolRounds()
  );
  check('CFG.10', customAgent.getMaxToolRounds() === 25, `Agent personalizzato riceve maxToolRounds = 25 (trovato: ${customAgent.getMaxToolRounds()})`);

  // 5. MemoryStore usa memoryMaxFacts
  const memoryStore = new MemoryStore(path.join(tmpHome, 'memory', 'test-mem.json'));
  // Popola 60 fatti: con maxFacts=50, deve restare a 50 dopo eviction
  for (let i = 1; i <= 60; i++) {
    memoryStore.addFact(`Fatto numero ${i}`, 'test');
  }
  check('CFG.11', memoryStore.count() === 50, `MemoryStore applica memoryMaxFacts=50 (trovati: ${memoryStore.count()})`);

  // 6. Validazione dei limiti minimi
  fs.writeFileSync(
    customConfigPath,
    JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'test' } },
      maxToolRounds: -5,
      memoryMaxFacts: 2
    }, null, 2),
    'utf-8'
  );
  const invalidConfig = new ConfigManager();
  check('CFG.12', invalidConfig.getMaxToolRounds() === 15, 'maxToolRounds invalido (<1) ricade su default 15');
  check('CFG.13', invalidConfig.getMemoryMaxFacts() === 200, 'memoryMaxFacts invalido (<10) ricade su default 200');

  // 7. Nuove costanti centralizzate: ContextTracker, history, LLM limits
  check('CFG.14', config.getContextTrackerMaxEntries() === 100, `default contextTrackerMaxEntries è 100 (trovato: ${config.getContextTrackerMaxEntries()})`);
  check('CFG.15', config.getCliMaxHistory() === 100, `default cliMaxHistory è 100 (trovato: ${config.getCliMaxHistory()})`);
  check('CFG.16', config.getGoalCondensedHistoryCharLimit() === 1500, `default goalCondensedHistoryCharLimit è 1500 (trovato: ${config.getGoalCondensedHistoryCharLimit()})`);
  check('CFG.17', config.getFirstTokenTimeoutMs() === 120000, `default firstTokenTimeoutMs è 120000 (trovato: ${config.getFirstTokenTimeoutMs()})`);
  check('CFG.18', config.getLlmMaxRetries() === 3, `default llmMaxRetries è 3 (trovato: ${config.getLlmMaxRetries()})`);
  check('CFG.19', config.getLlmMaxTokensCeiling() === 8192, `default llmMaxTokensCeiling è 8192 (trovato: ${config.getLlmMaxTokensCeiling()})`);
  check('CFG.20', config.getBrowseFetchTimeoutMs() === 30000, `default browseFetchTimeoutMs è 30000 (trovato: ${config.getBrowseFetchTimeoutMs()})`);
  check('CFG.21', config.getDownloadFetchTimeoutMs() === 60000, `default downloadFetchTimeoutMs è 60000 (trovato: ${config.getDownloadFetchTimeoutMs()})`);

  const { ContextTracker } = await import('../src/core/contextTracker');
  const tracker = new ContextTracker(15);
  for (let i = 1; i <= 25; i++) {
    tracker.addEntry({
      timestamp: new Date().toISOString(),
      agentName: `agent_${i}`,
      tokenCount: 10,
      promptTokens: 5,
      action: `action_${i}`
    });
  }
  check('CFG.22', tracker.getAll().length === 15, `ContextTracker rispetta la capacità massima personalizzata (trovati: ${tracker.getAll().length})`);

  delete process.env.TSUKA_HOME;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
