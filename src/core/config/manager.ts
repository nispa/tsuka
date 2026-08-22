import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../apphome';
import { AGENT_DEFAULTS, CLI_DEFAULTS, LLM_DEFAULTS, MEMORY_DEFAULTS, TOOLS_DEFAULTS } from '../constants';
import { logSink } from '../logSink';
import { matchesModelId, sanitizeSamplingParams } from './sampling';
import {
  AppConfig,
  ProviderConfig,
  SamplingProfileConfig,
  SamplingProfileParams,
  defaultAppConfig,
} from './types';

export const CONFIG_PATH = homePath('tsuka.config.json');

/**
 * Loads, heals and serves tsuka.config.json. Getters follow one pattern: accept a
 * valid user override, fall back to the central defaults in `src/core/constants.ts`
 * (AGENTS.md directive 9) when the value is missing or out of range.
 */
export class ConfigManager {
  private config!: AppConfig;
  private runtimeContextTokens: number | null = null;

  constructor() {
    this.load();
  }

  load(): void {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        this.config = JSON.parse(raw);
        let dirty = false;
        if (!this.config.webSearch) {
          this.config.webSearch = { provider: 'duckduckgo' };
          dirty = true;
        }
        if (!this.config.activeRole) {
          this.config.activeRole = 'developer';
          dirty = true;
        }
        if (!this.config.activeTrait) {
          this.config.activeTrait = 'professional';
          dirty = true;
        }
        if (!this.config.activeCharacter) {
          this.config.activeCharacter = 'custom';
          dirty = true;
        }
        if (dirty) {
          this.save();
        }
      } else {
        // Clean default fallback when configuration file is missing
        this.config = defaultAppConfig();
        this.save();
      }
    } catch (error: any) {
      logSink.error(`Error loading tsuka.config.json: ${error.message}. Using default fallback configuration.`);
    }
  }

  save(): void {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error: any) {
      logSink.error(`Error saving configuration: ${error.message}`);
    }
  }

  getActiveProviderName(): 'ollama' | 'openrouter' | 'unsloth' | string {
    return this.config.activeProvider;
  }

  setActiveProvider(provider: 'ollama' | 'openrouter' | 'unsloth' | string): void {
    this.config.activeProvider = provider;
    this.save();
  }

  getActiveProviderConfig(): ProviderConfig {
    const provider = this.config.activeProvider;
    return this.config.providers[provider];
  }

  getApiKey(): string {
    return this.getApiKeyFor(this.config.activeProvider);
  }

  getApiKeyFor(provider: string): string {
    if (provider === 'openrouter') {
      return process.env.OPENROUTER_API_KEY || '';
    }
    if (provider === 'unsloth') {
      return process.env.UNSLOTH_API_KEY || 'local';
    }
    return 'local';
  }

  getProviderNames(): string[] {
    return Object.keys(this.config.providers);
  }

  getProviderConfig(name: string): ProviderConfig | undefined {
    return this.config.providers[name];
  }

  updateActiveModel(modelName: string): void {
    const provider = this.config.activeProvider;
    if (this.config.providers[provider]) {
      this.config.providers[provider].model = modelName;
      this.save();
    }
  }

  getWebSearchProvider(): 'duckduckgo' | 'tavily' | 'google' {
    return this.config.webSearch?.provider || 'duckduckgo';
  }

  setWebSearchProvider(provider: 'duckduckgo' | 'tavily' | 'google'): void {
    if (!this.config.webSearch) {
      this.config.webSearch = { provider };
    } else {
      this.config.webSearch.provider = provider;
    }
    this.save();
  }

  getActiveRole(): string {
    return this.config.activeRole || 'developer';
  }

  setActiveRole(role: string): void {
    this.config.activeRole = role;
    this.save();
  }

  getActiveTrait(): string {
    return this.config.activeTrait || 'professional';
  }

  setActiveTrait(trait: string): void {
    this.config.activeTrait = trait;
    this.save();
  }

  getActiveCharacter(): string {
    return this.config.activeCharacter || 'custom';
  }

  setActiveCharacter(char: string): void {
    this.config.activeCharacter = char;
    this.save();
  }

  /**
   * Returns default UI mode ('tui' by default, or 'cli').
   */
  getDefaultUi(): 'tui' | 'cli' {
    return this.config.defaultUi === 'cli' ? 'cli' : 'tui';
  }

  setDefaultUi(ui: 'tui' | 'cli'): void {
    this.config.defaultUi = ui;
    this.save();
  }

  /**
   * Maximum message count retained in session history.
   * Default: 500 (guard limit; primary compaction is token-driven via maxHistoryTokens).
   */
  getMaxHistoryMessages(): number {
    const value = this.config.maxHistoryMessages;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 4) {
      return Math.floor(value);
    }
    return AGENT_DEFAULTS.maxHistoryMessages;
  }

  /**
   * Sets dynamically detected runtime context window tokens from the server.
   */
  setRuntimeContextTokens(tokens: number | null): void {
    this.runtimeContextTokens = typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 1024
      ? Math.floor(tokens)
      : null;
  }

  /**
   * Returns dynamically detected runtime context window tokens.
   */
  getRuntimeContextTokens(): number | null {
    return this.runtimeContextTokens;
  }

  /**
   * Maximum session context window tokens: uses detected runtime size or config default (65536).
   */
  getMaxHistoryTokens(): number {
    if (this.runtimeContextTokens !== null && this.runtimeContextTokens >= 1024) {
      return this.runtimeContextTokens;
    }
    const value = this.config.maxHistoryTokens;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1024) {
      return Math.floor(value);
    }
    return AGENT_DEFAULTS.defaultHistoryTokens;
  }

  /**
   * Whether roles declaring `coreTools` defer the remaining tools behind `load_tools` (T14.14).
   * Default: true. Set false to send every allowed tool schema on every round, as before T14.14.
   */
  getDeferredToolsEnabled(): boolean {
    return this.config.deferredToolsEnabled !== false;
  }

  /**
   * Single tool result context cap in estimated tokens (T8.8). Default: 4000.
   */
  getMaxToolResultTokens(): number {
    const value = this.config.maxToolResultTokens;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 256) {
      return Math.floor(value);
    }
    return AGENT_DEFAULTS.maxToolResultTokens;
  }

  /**
   * Maximum consecutive tool execution rounds per user turn. Default: 15.
   */
  getMaxToolRounds(): number {
    const value = this.config.maxToolRounds;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }
    return AGENT_DEFAULTS.maxToolRounds;
  }

  /**
   * Maximum facts retained in persistent memory (MemoryStore). Default: 200.
   */
  getMemoryMaxFacts(): number {
    const value = this.config.memoryMaxFacts;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 10) {
      return Math.floor(value);
    }
    return MEMORY_DEFAULTS.maxFacts;
  }

  /**
   * Active long-term memory backend name resolved against the registry in
   * `src/core/memory/registry.ts`. Default: 'json'.
   */
  getMemoryBackend(): string {
    const value = this.config.memoryBackend;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().toLowerCase();
    }
    return 'json';
  }

  /**
   * Maximum rounds in a /team workflow. Default: 3.
   */
  getTeamMaxRounds(): number {
    const value = (this.config as any).teamMaxRounds;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }
    return AGENT_DEFAULTS.teamMaxRounds;
  }

  /**
   * Base workspace directory root for file sandbox security checks.
   */
  getWorkspaceRoot(): string {
    const root = this.config.workspaceRoot;
    if (typeof root === 'string' && root.trim().length > 0) {
      return path.resolve(root.trim());
    }
    return process.cwd();
  }

  /**
   * Maximum character cap for memory sections injected into system prompts (T8.3). Default: 600.
   */
  getMemoryMaxChars(): number {
    const value = this.config.memoryMaxChars;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 100) {
      return Math.floor(value);
    }
    return MEMORY_DEFAULTS.promptMaxChars;
  }

  /**
   * Final fallback reasoning effort level from configuration.
   */
  getDefaultReasoningEffort(): 'none' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
    const value = this.config.reasoningEffort;
    return value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ? value : undefined;
  }

  /**
   * Persists the reasoning effort default (and removes the key with undefined).
   * Written by /effort alongside the runtime pin so the choice survives restarts;
   * entry points (cli/index.ts, tui/app.ts) re-apply it as the startup pin.
   */
  setDefaultReasoningEffort(value: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | undefined): void {
    this.config.reasoningEffort = value;
    this.save();
  }

  /**
   * Wall-clock LLM generation timeout in milliseconds (T8.16). Default: 120000.
   */
  getLlmTimeoutMs(): number {
    const value = this.config.llmTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return LLM_DEFAULTS.generationTimeoutMs;
  }

  /**
   * Shell command execution timeout in milliseconds for execute_command. Default: 120000.
   */
  getCommandTimeoutMs(): number {
    const value = this.config.commandTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return TOOLS_DEFAULTS.commandTimeoutMs;
  }

  /**
   * Parallel execution flag for PARALLEL blocks in /goal (T9.10). Default: false.
   */
  isParallelExecutionEnabled(): boolean {
    return this.config.parallelExecutionEnabled === true;
  }

  /**
   * Default creativity preset ('precise' | 'balanced' | 'creative' | 'low' | 'medium' | 'high').
   */
  getDefaultCreativity(): 'precise' | 'balanced' | 'creative' | 'low' | 'medium' | 'high' | undefined {
    const value = this.config.creativity?.toLowerCase();
    if (value === 'precise' || value === 'balanced' || value === 'creative' || value === 'low' || value === 'medium' || value === 'high') {
      return value as any;
    }
    return undefined;
  }

  /**
   * Sampling parameters configured for `model` in the mode in use (T8.17), or undefined
   * when no key of samplingProfiles matches. Among several matches the longest key wins,
   * so a specific quantization can override its family.
   */
  getSamplingProfile(model: string, mode: 'thinking' | 'instruct'): SamplingProfileParams | undefined {
    const profiles = this.config.samplingProfiles;
    if (!profiles || typeof profiles !== 'object' || !model) return undefined;

    const key = Object.keys(profiles)
      .filter((candidate) => matchesModelId(candidate, model))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return undefined;

    const entry = profiles[key] as SamplingProfileConfig & SamplingProfileParams;
    if (!entry || typeof entry !== 'object') return undefined;
    // Flat profile (no thinking/instruct split): the same values serve both modes.
    const hasModes = entry.thinking !== undefined || entry.instruct !== undefined;
    const raw = hasModes ? entry[mode] : entry;
    return sanitizeSamplingParams(raw, key);
  }

  /**
   * Maximum activity entries in ContextTracker ring buffer. Default: 100.
   */
  getContextTrackerMaxEntries(): number {
    const value = this.config.contextTrackerMaxEntries;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 10) {
      return Math.floor(value);
    }
    return TOOLS_DEFAULTS.contextTrackerMaxEntries;
  }

  /**
   * Maximum command history lines retained in REPL history file. Default: 100.
   */
  getCliMaxHistory(): number {
    const value = this.config.cliMaxHistory;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 10) {
      return Math.floor(value);
    }
    return CLI_DEFAULTS.maxHistoryLines;
  }

  /**
   * Character threshold above which agent turn outputs in /goal are condensed. Default: 1500.
   */
  getGoalCondensedHistoryCharLimit(): number {
    const value = this.config.goalCondensedHistoryCharLimit;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 100) {
      return Math.floor(value);
    }
    return AGENT_DEFAULTS.goalCondensedHistoryCharLimit;
  }

  /**
   * Initial streaming token timeout in ms. Default: 120000.
   */
  getFirstTokenTimeoutMs(): number {
    const value = this.config.firstTokenTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return LLM_DEFAULTS.firstTokenTimeoutMs;
  }

  /**
   * Maximum retry attempts on network failures or malformed tool call JSON. Default: 3.
   */
  getLlmMaxRetries(): number {
    const value = this.config.llmMaxRetries;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }
    return LLM_DEFAULTS.maxRetries;
  }

  /**
   * Maximum completion tokens ceiling requested in LLM calls. Default: 8192.
   */
  getLlmMaxTokensCeiling(): number {
    const value = this.config.llmMaxTokensCeiling;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 256) {
      return Math.floor(value);
    }
    return LLM_DEFAULTS.maxTokensCeiling;
  }

  /**
   * Whether streaming calls request per-token logprobs for the latent space
   * inspector. Default: false (not all OpenAI-compatible backends accept it).
   */
  getInferenceLogprobsEnabled(): boolean {
    return this.config.inferenceLogprobs === true;
  }

  /**
   * HTTP request timeout in ms for browse_url tool. Default: 30000.
   */
  getBrowseFetchTimeoutMs(): number {
    const value = this.config.browseFetchTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return TOOLS_DEFAULTS.browseFetchTimeoutMs;
  }

  /**
   * HTTP request timeout in ms for download_file tool. Default: 60000.
   */
  getDownloadFetchTimeoutMs(): number {
    const value = this.config.downloadFetchTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return TOOLS_DEFAULTS.downloadFetchTimeoutMs;
  }
}
