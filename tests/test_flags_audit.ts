/**
 * Semantic variants and configuration flags audit test suite (T21.8).
 *
 * Verifies that every configuration key and named environment variable discovered
 * in source has an explicit product, compatibility, diagnostic, or presentation
 * classification. Tunable fallbacks are checked against constants.ts separately.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager, defaultAppConfig } from '../src/core/config';
import {
  AGENT_DEFAULTS,
  CLI_DEFAULTS,
  LLM_DEFAULTS,
  MEMORY_DEFAULTS,
  TOOLS_DEFAULTS,
} from '../src/core/constants';

type FlagCategory = 'product' | 'compatibility' | 'diagnostic' | 'presentation';

const CONFIG_CLASSIFICATION: Record<string, FlagCategory> = {
  activeProvider: 'compatibility',
  providerOverrides: 'compatibility',
  providers: 'compatibility',
  webSearch: 'product',
  activeRole: 'product',
  activeTrait: 'product',
  activeCharacter: 'product',
  maxHistoryMessages: 'product',
  maxHistoryTokens: 'product',
  maxToolResultTokens: 'product',
  deferredToolsEnabled: 'product',
  maxToolRounds: 'product',
  memoryMaxFacts: 'product',
  memoryBackend: 'compatibility',
  workspaceRoot: 'product',
  memoryMaxChars: 'product',
  reasoningEffort: 'product',
  llmTimeoutMs: 'compatibility',
  commandTimeoutMs: 'product',
  creativity: 'product',
  parallelExecutionEnabled: 'product',
  contextTrackerMaxEntries: 'diagnostic',
  cliMaxHistory: 'presentation',
  goalCondensedHistoryCharLimit: 'product',
  firstTokenTimeoutMs: 'compatibility',
  llmMaxRetries: 'compatibility',
  llmMaxTokensCeiling: 'compatibility',
  browseFetchTimeoutMs: 'product',
  downloadFetchTimeoutMs: 'product',
  defaultUi: 'presentation',
  inferenceLogprobs: 'diagnostic',
  samplingProfiles: 'compatibility',
  mcpServers: 'compatibility',
};

const ENV_CLASSIFICATION: Record<string, FlagCategory> = {
  TSUKA_HOME: 'product',
  TSUKA_MEMORY_FILE: 'compatibility',
  TSUKA_MEMORY_BACKEND: 'compatibility',
  TSUKA_TUI: 'presentation',
  OPENAI_API_KEY: 'compatibility',
  GOOGLE_SEARCH_API_KEY: 'compatibility',
  GOOGLE_SEARCH_CX: 'compatibility',
  TAVILY_API_KEY: 'compatibility',
  TERM: 'presentation',
};

function sorted(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function discoverAppConfigKeys(): string[] {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'core', 'config', 'types.ts'), 'utf8');
  const declaration = 'export interface AppConfig {';
  const start = source.indexOf(declaration);
  if (start < 0) return [];

  let depth = 0;
  let end = source.length;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) {
      end = index;
      break;
    }
  }

  return sorted(Array.from(source.slice(start, end).matchAll(/^  ([A-Za-z][A-Za-z0-9_]*)\??:/gm), (match) => match[1]));
}

function discoverNamedEnvironmentVariables(root: string): string[] {
  const names = new Set<string>();
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const source = fs.readFileSync(fullPath, 'utf8');
        for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
      }
    }
  };
  visit(root);
  return sorted(names);
}

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`PASS ${id} - ${detail}`);
  } else {
    failed++;
    console.log(`FAIL ${id} - ${detail}`);
  }
}

async function runTests(): Promise<void> {
  console.log('--- Semantic Flags & Configuration Audit (T21.8) ---');

  const defaults = defaultAppConfig();

  // Audit 1: Base product defaults
  check('AUDIT.1', defaults.activeProvider === '', 'activeProvider is selected from providers.json at runtime');
  check('AUDIT.2', defaults.activeRole === 'developer', 'activeRole defaults to developer');
  check('AUDIT.3', defaults.activeTrait === 'professional', 'activeTrait defaults to professional');
  check('AUDIT.4', defaults.activeCharacter === 'custom', 'activeCharacter defaults to custom');
  check('AUDIT.5', defaults.webSearch.provider === 'duckduckgo', 'webSearch defaults to duckduckgo');

  // Audit 2: Fallback to constants.ts when keys are absent
  const config = new ConfigManager();
  // Simulate an empty configuration to test default fallbacks
  (config as unknown as { config: Record<string, never> }).config = {};

  // Agent tunables
  check('AUDIT.6', config.getMaxHistoryMessages() === AGENT_DEFAULTS.maxHistoryMessages, 'maxHistoryMessages maps to AGENT_DEFAULTS');
  check('AUDIT.7', config.getMaxHistoryTokens() === AGENT_DEFAULTS.defaultHistoryTokens, 'maxHistoryTokens maps to AGENT_DEFAULTS.defaultHistoryTokens');
  check('AUDIT.8', config.getMaxToolResultTokens() === AGENT_DEFAULTS.maxToolResultTokens, 'maxToolResultTokens maps to AGENT_DEFAULTS');
  check('AUDIT.9', config.getMaxToolRounds() === AGENT_DEFAULTS.maxToolRounds, 'maxToolRounds maps to AGENT_DEFAULTS');
  check('AUDIT.10', config.getGoalCondensedHistoryCharLimit() === AGENT_DEFAULTS.goalCondensedHistoryCharLimit, 'goalCondensedHistoryCharLimit maps to AGENT_DEFAULTS');

  // LLM tunables
  check('AUDIT.11', config.getLlmTimeoutMs() === LLM_DEFAULTS.generationTimeoutMs, 'llmTimeoutMs maps to LLM_DEFAULTS.generationTimeoutMs');
  check('AUDIT.12', config.getFirstTokenTimeoutMs() === LLM_DEFAULTS.firstTokenTimeoutMs, 'firstTokenTimeoutMs maps to LLM_DEFAULTS');
  check('AUDIT.13', config.getLlmMaxRetries() === LLM_DEFAULTS.maxRetries, 'llmMaxRetries maps to LLM_DEFAULTS');
  check('AUDIT.14', config.getLlmMaxTokensCeiling() === LLM_DEFAULTS.maxTokensCeiling, 'llmMaxTokensCeiling maps to LLM_DEFAULTS');

  // Memory tunables
  check('AUDIT.15', config.getMemoryMaxFacts() === MEMORY_DEFAULTS.maxFacts, 'memoryMaxFacts maps to MEMORY_DEFAULTS');
  check('AUDIT.16', config.getMemoryMaxChars() === MEMORY_DEFAULTS.promptMaxChars, 'memoryMaxChars maps to MEMORY_DEFAULTS.promptMaxChars');
  check('AUDIT.17', config.getMemoryBackend() === 'json', 'memoryBackend defaults to json');

  // Tools & CLI tunables
  check('AUDIT.18', config.getCommandTimeoutMs() === TOOLS_DEFAULTS.commandTimeoutMs, 'commandTimeoutMs maps to TOOLS_DEFAULTS');
  check('AUDIT.19', config.getBrowseFetchTimeoutMs() === TOOLS_DEFAULTS.browseFetchTimeoutMs, 'browseFetchTimeoutMs maps to TOOLS_DEFAULTS');
  check('AUDIT.20', config.getDownloadFetchTimeoutMs() === TOOLS_DEFAULTS.downloadFetchTimeoutMs, 'downloadFetchTimeoutMs maps to TOOLS_DEFAULTS');
  check('AUDIT.21', config.getCliMaxHistory() === CLI_DEFAULTS.maxHistoryLines, 'cliMaxHistory maps to CLI_DEFAULTS.maxHistoryLines');
  check('AUDIT.22', config.getContextTrackerMaxEntries() === TOOLS_DEFAULTS.contextTrackerMaxEntries, 'contextTrackerMaxEntries maps to TOOLS_DEFAULTS.contextTrackerMaxEntries');

  // Audit 3: inventories are derived from source, so additions must be classified.
  const configKeys = discoverAppConfigKeys();
  const classifiedConfigKeys = sorted(Object.keys(CONFIG_CLASSIFICATION));
  check(
    'AUDIT.23',
    JSON.stringify(configKeys) === JSON.stringify(classifiedConfigKeys),
    `all ${configKeys.length} AppConfig keys discovered in source are classified`
  );

  const environmentVariables = discoverNamedEnvironmentVariables(path.join(process.cwd(), 'src'));
  const classifiedEnvironmentVariables = sorted(Object.keys(ENV_CLASSIFICATION));
  check(
    'AUDIT.24',
    JSON.stringify(environmentVariables) === JSON.stringify(classifiedEnvironmentVariables),
    `all ${environmentVariables.length} named environment variables discovered in source are classified`
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
