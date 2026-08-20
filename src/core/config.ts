import * as fs from 'fs';
import * as path from 'path';
import { homePath } from './apphome';
import { logSink } from './logSink';

export interface ProviderConfig {
  baseUrl: string;
  model: string;
}

/**
 * Sampling parameters for one mode, in wire format (the same names the backend reads).
 * Every field is optional: only the ones present are sent.
 */
export interface SamplingProfileParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  repetition_penalty?: number;
}

/**
 * Sampling profile of a model family, split by mode (T8.17). A profile can also be
 * written flat, without the thinking/instruct split: in that case it applies to both.
 */
export interface SamplingProfileConfig {
  /** Applied when the model reasons (effort other than 'none'). */
  thinking?: SamplingProfileParams;
  /** Applied when the effort is 'none', i.e. no reasoning block. */
  instruct?: SamplingProfileParams;
}

export interface WebSearchConfig {
  provider: 'duckduckgo' | 'tavily' | 'google';
}

export interface AppConfig {
  activeProvider: 'ollama' | 'openrouter' | 'unsloth' | string;
  providers: {
    ollama: ProviderConfig;
    openrouter: ProviderConfig;
    [key: string]: ProviderConfig;
  };
  webSearch: WebSearchConfig;
  activeRole: string;
  activeTrait: string;
  activeCharacter: string;
  maxHistoryMessages?: number;
  maxHistoryTokens?: number;
  maxToolResultTokens?: number;
  /** Whether roles with `coreTools` defer the rest behind `load_tools` (T14.14). Default: true. */
  deferredToolsEnabled?: boolean;
  /** Maximum consecutive tool execution rounds per user turn. Default: 15. */
  maxToolRounds?: number;
  /** Maximum facts retained in persistent memory before score-based eviction. Default: 200. */
  memoryMaxFacts?: number;
  workspaceRoot?: string;
  memoryMaxChars?: number;
  /** Final level of reasoning effort cascade (T8.10). */
  reasoningEffort?: string;
  /** Wall-clock timeout for LLM generation in ms (T8.16). Default: 120000. */
  llmTimeoutMs?: number;
  /** Default command timeout for execute_command in ms. Default: 120000. */
  commandTimeoutMs?: number;
  /** Default creativity preset ('precise' | 'balanced' | 'creative' | 'low' | 'medium' | 'high'). */
  creativity?: string;
  /** Enables true parallel execution for PARALLEL blocks in /goal (T9.10). Default: false. */
  parallelExecutionEnabled?: boolean;
  /** Maximum number of activity records kept in the in-memory ContextTracker ring buffer. Default: 100. */
  contextTrackerMaxEntries?: number;
  /** Maximum command history lines retained in REPL history file. Default: 100. */
  cliMaxHistory?: number;
  /** Character threshold above which agent turn outputs in /goal are condensed into persistent memory. Default: 1500. */
  goalCondensedHistoryCharLimit?: number;
  /** Timeout in ms to wait for the first streaming token before considering the LLM non-responsive. Default: 120000. */
  firstTokenTimeoutMs?: number;
  /** Maximum retry attempts on network failures or malformed tool call JSON. Default: 3. */
  llmMaxRetries?: number;
  /** Ceiling for maximum completion tokens requested in streaming LLM calls. Default: 8192. */
  llmMaxTokensCeiling?: number;
  /** HTTP request timeout in ms for browse_url tool. Default: 30000. */
  browseFetchTimeoutMs?: number;
  /** HTTP request timeout in ms for download_file tool. Default: 60000. */
  downloadFetchTimeoutMs?: number;
  /** Default UI mode when launching tsuka without flags ('tui' or 'cli'). Default: 'tui'. */
  defaultUi?: 'tui' | 'cli';
  /**
   * Requests per-token logprobs from the backend to feed the latent space inspector
   * (confidence + top candidates) with real data. Default: false, because not every
   * OpenAI-compatible backend accepts the parameter (T14.9).
   */
  inferenceLogprobs?: boolean;
  /**
   * Sampling parameters per model family (T8.17). The key matches the model id
   * (case-insensitive substring, or /regex/ when wrapped in slashes); the value carries
   * the parameters for thinking mode and for instruct mode.
   */
  samplingProfiles?: Record<string, SamplingProfileConfig | SamplingProfileParams>;
}

/** Parameter names accepted inside a sampling profile: anything else is ignored. */
export const SAMPLING_PARAM_KEYS = [
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'presence_penalty',
  'frequency_penalty',
  'repetition_penalty'
] as const;

/**
 * Matches a samplingProfiles key against a model id: `/regex/flags` when the key is
 * wrapped in slashes, case-insensitive substring otherwise.
 */
function matchesModelId(key: string, model: string): boolean {
  const regexForm = key.match(/^\/(.*)\/([a-z]*)$/);
  if (regexForm) {
    try {
      return new RegExp(regexForm[1], regexForm[2] || 'i').test(model);
    } catch {
      return false;
    }
  }
  return model.toLowerCase().includes(key.toLowerCase());
}

/** Keeps only known keys holding a finite number, reporting whatever it discards. */
function sanitizeSamplingParams(raw: unknown, source: string): SamplingProfileParams | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(SAMPLING_PARAM_KEYS as readonly string[]).includes(key)) {
      logSink.log(`[Config] samplingProfiles['${source}']: unknown parameter '${key}', ignored.`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      logSink.log(`[Config] samplingProfiles['${source}'].${key}: not a number, ignored.`);
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as SamplingProfileParams) : undefined;
}

export const CONFIG_PATH = homePath('tsuka.config.json');

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
        this.config = {
          activeProvider: 'ollama',
          providers: {
            ollama: {
              baseUrl: 'http://localhost:11434/v1',
              model: 'qwen2.5-coder:7b',
            },
            openrouter: {
              baseUrl: 'https://openrouter.ai/api/v1',
              model: 'meta-llama/llama-3.3-70b-instruct',
            },
            unsloth: {
              baseUrl: 'http://127.0.0.1:8888/v1',
              model: 'default',
            },
          },
          webSearch: {
            provider: 'duckduckgo'
          },
          activeRole: 'developer',
          activeTrait: 'professional',
          activeCharacter: 'custom'
        };
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
    return 500;
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
    return 65536;
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
    return 4000;
  }

  /**
   * Maximum consecutive tool execution rounds per user turn. Default: 15.
   */
  getMaxToolRounds(): number {
    const value = this.config.maxToolRounds;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }
    return 15;
  }

  /**
   * Maximum facts retained in persistent memory (MemoryStore). Default: 200.
   */
  getMemoryMaxFacts(): number {
    const value = this.config.memoryMaxFacts;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 10) {
      return Math.floor(value);
    }
    return 200;
  }

  /**
   * Maximum rounds in a /team workflow. Default: 3.
   */
  getTeamMaxRounds(): number {
    const value = (this.config as any).teamMaxRounds;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }
    return 3;
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
    return 600;
  }

  /**
   * Final fallback reasoning effort level from configuration.
   */
  getDefaultReasoningEffort(): 'none' | 'low' | 'medium' | 'xhigh' | undefined {
    const value = this.config.reasoningEffort;
    return value === 'none' || value === 'low' || value === 'medium' || value === 'xhigh' ? value : undefined;
  }

  /**
   * Wall-clock LLM generation timeout in milliseconds (T8.16). Default: 120000.
   */
  getLlmTimeoutMs(): number {
    const value = this.config.llmTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return 120000;
  }

  /**
   * Shell command execution timeout in milliseconds for execute_command. Default: 120000.
   */
  getCommandTimeoutMs(): number {
    const value = this.config.commandTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return 120000;
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
    return 100;
  }

  /**
   * Maximum command history lines retained in REPL history file. Default: 100.
   */
  getCliMaxHistory(): number {
    const value = this.config.cliMaxHistory;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 10) {
      return Math.floor(value);
    }
    return 100;
  }

  /**
   * Character threshold above which agent turn outputs in /goal are condensed. Default: 1500.
   */
  getGoalCondensedHistoryCharLimit(): number {
    const value = this.config.goalCondensedHistoryCharLimit;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 100) {
      return Math.floor(value);
    }
    return 1500;
  }

  /**
   * Initial streaming token timeout in ms. Default: 120000.
   */
  getFirstTokenTimeoutMs(): number {
    const value = this.config.firstTokenTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return 120000;
  }

  /**
   * Maximum retry attempts on network failures or malformed tool call JSON. Default: 3.
   */
  getLlmMaxRetries(): number {
    const value = this.config.llmMaxRetries;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }
    return 3;
  }

  /**
   * Maximum completion tokens ceiling requested in LLM calls. Default: 8192.
   */
  getLlmMaxTokensCeiling(): number {
    const value = this.config.llmMaxTokensCeiling;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 256) {
      return Math.floor(value);
    }
    return 8192;
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
    return 30000;
  }

  /**
   * HTTP request timeout in ms for download_file tool. Default: 60000.
   */
  getDownloadFetchTimeoutMs(): number {
    const value = this.config.downloadFetchTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return 60000;
  }
}
