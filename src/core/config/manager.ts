import * as fs from 'fs';
import { declareCredentialEnvName } from '../credentials';
import * as path from 'path';
import { homePath, localWorkspacePath } from '../apphome';
import { AGENT_DEFAULTS, CLI_DEFAULTS, CONFIG_DEFAULTS, CONTEXT_SCHEDULER_DEFAULTS, LLM_DEFAULTS, MEMORY_DEFAULTS, TOOLS_DEFAULTS } from '../constants';
import { logSink } from '../logSink';
import { normalizeProviderClass } from '../cloudProvider';
import { loadProviderCatalog, type ProviderDefinition } from '../providerCatalog';
import { matchesModelId, sanitizeSamplingParams } from './sampling';
import { type ContextSchedulerConfig, validateContextSchedulerConfig } from '../contextScheduler';
import {
  AppConfig,
  ProviderConfig,
  SamplingProfileConfig,
  SamplingProfileParams,
  McpServerConfigEntry,
  defaultAppConfig,
} from './types';

/** Selects the workspace config when initialized, with the global config as fallback. */
export function resolveConfigPath(): string {
  const local = localWorkspacePath('config.json');
  return local && fs.existsSync(local) ? local : homePath('tsuka.config.json');
}

/** Backward-compatible snapshot for callers that need the selected config path. */
export const CONFIG_PATH = resolveConfigPath();

/** Validates the structural boundary while keeping optional legacy fields compatible. */
function validateConfigShape(value: unknown): AppConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Configuration root must be a JSON object.');
  }

  const candidate = value as Record<string, unknown>;
  const stringFields = ['activeProvider', 'activeRole', 'activeTrait', 'activeCharacter', 'workspaceRoot', 'reasoningEffort', 'creativity'];
  for (const field of stringFields) {
    if (field in candidate && candidate[field] !== undefined && typeof candidate[field] !== 'string') {
      throw new Error(`Configuration field '${field}' must be a string.`);
    }
  }

  const booleanFields = ['deferredToolsEnabled', 'parallelExecutionEnabled', 'selfAuthoringEnabled', 'inferenceLogprobs'];
  for (const field of booleanFields) {
    if (field in candidate && candidate[field] !== undefined && typeof candidate[field] !== 'boolean') {
      throw new Error(`Configuration field '${field}' must be a boolean.`);
    }
  }

  const objectFields = ['providerOverrides', 'providers', 'samplingProfiles', 'mcpServers'];
  for (const field of objectFields) {
    if (field in candidate && candidate[field] !== undefined &&
      (!candidate[field] || typeof candidate[field] !== 'object' || Array.isArray(candidate[field]))) {
      throw new Error(`Configuration field '${field}' must be an object.`);
    }
  }

  if (candidate.commandEnvPassthrough !== undefined &&
    (!Array.isArray(candidate.commandEnvPassthrough) ||
      candidate.commandEnvPassthrough.some((name) => typeof name !== 'string' || !name.trim()))) {
    throw new Error("Configuration field 'commandEnvPassthrough' must be an array of variable names.");
  }

  if (candidate.webSearch !== undefined) {
    if (!candidate.webSearch || typeof candidate.webSearch !== 'object' || Array.isArray(candidate.webSearch)) {
      throw new Error("Configuration field 'webSearch' must be an object.");
    }
    const webSearch = candidate.webSearch as Record<string, unknown>;
    for (const field of ['backend', 'provider']) {
      if (webSearch[field] !== undefined && (typeof webSearch[field] !== 'string' || !webSearch[field].trim())) {
        throw new Error(`Configuration field 'webSearch.${field}' must be a non-empty string.`);
      }
    }
  }

  return candidate as unknown as AppConfig;
}

/**
 * Loads, heals and serves tsuka.config.json. Getters follow one pattern: accept a
 * valid user override, fall back to the central defaults in `src/core/constants.ts`
 * (AGENTS.md directive 9) when the value is missing or out of range.
 */
export class ConfigManager {
  /**
   * Provider used for this process when the configured one did not answer at startup.
   * Never saved: failing over used to rewrite activeProvider, so one slow start of a local
   * server (Unsloth Studio still booting) moved TSUKA to a cloud provider for good. Static
   * because many ConfigManager instances coexist and must agree on the session's provider;
   * an explicit choice (setActiveProvider) clears it.
   */
  private static sessionProvider: string | null = null;

  static useProviderForSession(name: string | null): void {
    ConfigManager.sessionProvider = name;
  }

  private static revision = 0;
  private config!: AppConfig;
  private readonly providerCatalog: Record<string, ProviderDefinition>;
  private readonly configPath: string;
  private runtimeContextTokens: number | null = null;
  /** Prevents a later setter from overwriting a file whose recovery was incomplete. */
  private persistenceBlocked = false;

  constructor() {
    this.configPath = resolveConfigPath();
    this.providerCatalog = loadProviderCatalog();
    this.load();
  }

  /**
   * Monotonic in-process revision used by short-lived consumer caches. Saving through any
   * manager invalidates them without a filesystem poll; external edits still expire by TTL.
   */
  static getRevision(): number {
    return ConfigManager.revision;
  }

  load(): void {
    this.persistenceBlocked = false;
    if (!fs.existsSync(this.configPath)) {
      // A missing file is safe to initialize because there are no user bytes to preserve.
      this.config = defaultAppConfig();
      this.save();
    }
    if (fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        this.config = validateConfigShape(JSON.parse(raw));
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
        if (dirty) this.save();
      } catch (error: any) {
        this.recoverInvalidConfig(error);
      }
    }
    if (!this.config.activeProvider || !this.getProviderConfig(this.config.activeProvider)) {
      this.config.activeProvider = this.getProviderNames()[0] ?? '';
      if (!this.persistenceBlocked) this.save();
    }
  }

  /** Backs up invalid bytes before writing a clean default; returns null on any unsafe step. */
  private backupInvalidConfig(): string | null {
    const stamp = Date.now();
    for (let attempt = 0; attempt < CONFIG_DEFAULTS.maxCorruptBackupAttempts; attempt++) {
      const suffix = attempt === 0 ? '' : `-${attempt}`;
      const backup = `${this.configPath}.corrupt-${stamp}${suffix}`;
      try {
        // COPYFILE_EXCL makes the collision check safe even when two processes recover together.
        fs.copyFileSync(this.configPath, backup, fs.constants.COPYFILE_EXCL);
      } catch (error: any) {
        if (error?.code === 'EEXIST') continue;
        logSink.error(`Could not back up invalid configuration '${this.configPath}': ${error.message}`);
        return null;
      }
      try {
        fs.unlinkSync(this.configPath);
      } catch (error: any) {
        logSink.error(`Could not remove invalid configuration '${this.configPath}' after backup '${backup}': ${error.message}`);
        return null;
      }
      return backup;
    }
    logSink.error(`Could not choose a collision-safe backup name for invalid configuration '${this.configPath}'.`);
    return null;
  }

  /** Recovers invalid configuration without allowing a later setter to overwrite lost bytes. */
  private recoverInvalidConfig(error: Error): void {
    const backup = this.backupInvalidConfig();
    this.config = defaultAppConfig();
    if (!backup) {
      this.persistenceBlocked = true;
      logSink.error(`Invalid tsuka.config.json was kept untouched; using defaults in memory (${error.message}).`);
      return;
    }
    logSink.warn(`Invalid tsuka.config.json backed up to '${backup}' (${error.message}). Replacing it with defaults.`);
    if (!this.persistConfig()) {
      this.persistenceBlocked = true;
      logSink.error(`Default configuration could not be persisted after backing up '${backup}'; future saves are blocked.`);
    }
  }

  /** Atomically persists the current config through a sibling temporary file. */
  private persistConfig(): boolean {
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      const tempPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2), 'utf-8');
        fs.renameSync(tempPath, this.configPath);
      } catch (error) {
        try { fs.unlinkSync(tempPath); } catch {}
        throw error;
      }
      ConfigManager.revision++;
      return true;
    } catch (error: any) {
      logSink.error(`Error saving configuration: ${error.message}`);
      return false;
    }
  }

  save(): void {
    if (this.persistenceBlocked) {
      logSink.warn('Configuration persistence is blocked because the previous recovery was incomplete.');
      return;
    }
    if (!this.persistConfig()) this.persistenceBlocked = true;
  }

  /** Provider in use: the session failover if any, else the configured choice. */
  getActiveProviderName(): string {
    return ConfigManager.sessionProvider ?? this.config.activeProvider;
  }

  /** The user's saved choice, whatever the session is using. */
  getConfiguredProviderName(): string {
    return this.config.activeProvider;
  }

  setActiveProvider(provider: string): void {
    ConfigManager.sessionProvider = null;
    this.config.activeProvider = provider;
    this.save();
  }

  getActiveProviderConfig(): ProviderConfig {
    const config = this.getProviderConfig(this.getActiveProviderName());
    if (!config) throw new Error(`Provider '${this.getActiveProviderName()}' is not defined in providers.json.`);
    return config;
  }

  getApiKey(): string {
    return this.getApiKeyFor(this.getActiveProviderName());
  }

  getApiKeyFor(provider: string): string {
    const keyEnv = this.getProviderConfig(provider)?.apiKeyEnv;
    if (keyEnv && /^[A-Z][A-Z0-9_]*$/.test(keyEnv)) {
      // Covers a legacy apiKeyEnv from tsuka.config.json too; the catalog declares its own (T24.2).
      declareCredentialEnvName(keyEnv);
      return process.env[keyEnv] || '';
    }
    return 'local';
  }

  getProviderNames(): string[] {
    return Array.from(new Set([...Object.keys(this.providerCatalog), ...Object.keys(this.config.providers ?? {})]));
  }

  getProviderConfig(name: string): ProviderConfig | undefined {
    const definition = this.providerCatalog[name];
    const legacy = this.config.providers?.[name];
    if (!definition && (!legacy?.baseUrl || !legacy?.model)) return undefined;
    const override = this.config.providerOverrides?.[name];
    const baseUrl = override?.baseUrl ?? legacy?.baseUrl ?? definition?.baseUrl;
    const model = override?.model ?? legacy?.model ?? definition?.defaultModel;
    if (!baseUrl || !model) return undefined;
    return {
      baseUrl,
      model,
      class: normalizeProviderClass(definition?.class ?? legacy?.class),
      displayName: definition?.displayName ?? legacy?.displayName ?? name,
      apiKeyEnv: definition?.apiKeyEnv ?? legacy?.apiKeyEnv,
      capabilities: definition?.capabilities ?? legacy?.capabilities ?? {},
    };
  }

  updateActiveModel(modelName: string): void {
    const provider = this.getActiveProviderName();
    if (!this.getProviderConfig(provider)) return;
    this.config.providerOverrides ??= {};
    this.config.providerOverrides[provider] = { ...this.config.providerOverrides[provider], model: modelName };
    this.save();
  }

  /** MCP stdio servers configured by the user (T20.1); empty when none are set. */
  getMcpServers(): Record<string, McpServerConfigEntry> {
    return this.config.mcpServers ?? {};
  }

  getWebSearchProvider(): string {
    return this.config.webSearch?.provider || 'duckduckgo';
  }

  getWebSearchBackend(): string {
    return this.config.webSearch?.backend || 'http';
  }

  setWebSearchProvider(provider: string): void {
    const normalized = provider.trim().toLowerCase();
    if (!normalized) throw new Error('Web search provider must be a non-empty string.');
    if (!this.config.webSearch) {
      this.config.webSearch = { provider: normalized };
    } else {
      this.config.webSearch.provider = normalized;
    }
    this.save();
  }

  setWebSearchBackend(backend: string): void {
    const normalized = backend.trim().toLowerCase();
    if (!normalized) throw new Error('Web search backend must be a non-empty string.');
    this.config.webSearch ??= { provider: 'duckduckgo' };
    this.config.webSearch.backend = normalized;
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
   * Bounded lifetime for cache snapshots used in tool hot paths. The lower bound avoids
   * reverting to per-call filesystem polling, while the upper bound exposes external edits.
   */
  getHotPathConfigCacheTtlMs(): number {
    const value = this.config.hotPathConfigCacheTtlMs;
    if (typeof value === 'number' && Number.isFinite(value) &&
      value >= CONFIG_DEFAULTS.hotPathCacheMinTtlMs && value <= CONFIG_DEFAULTS.hotPathCacheMaxTtlMs) {
      return Math.floor(value);
    }
    return CONFIG_DEFAULTS.hotPathCacheTtlMs;
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
   * Trusted cloud gateways can serve independent requests concurrently, so their PARALLEL goal
   * blocks run concurrently without requiring a separate user toggle. Local
   * providers remain serialized unless the explicit opt-in is enabled.
   */
  isParallelExecutionEnabled(): boolean {
    return normalizeProviderClass(this.getActiveProviderConfig()?.class) === 'CLOUD' || this.config.parallelExecutionEnabled === true;
  }

  /** Executable custom tools are opt-in: their out-of-process confinement is defense in depth, not a sandbox. */
  isSelfAuthoringEnabled(): boolean {
    return this.config.selfAuthoringEnabled === true;
  }

  /** Credential-like variables explicitly allowed into execute_command's environment (T24.1). */
  getCommandEnvPassthrough(): string[] {
    return (this.config.commandEnvPassthrough ?? []).map((name) => name.trim());
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
   * Whether context-driven autonomous subagent delegation is enabled (T22.8). Default: false.
   */
  isContextSchedulerEnabled(): boolean {
    return this.config.contextSchedulerEnabled === true;
  }

  /**
   * Resolves and strictly validates context scheduler thresholds (T22.8).
   * Validates at loading time: throws immediately if thresholds are invalid or not strictly ordered.
   */
  getContextSchedulerConfig(): ContextSchedulerConfig {
    const prepareAt =
      typeof this.config.contextPrepareAt === 'number'
        ? this.config.contextPrepareAt
        : CONTEXT_SCHEDULER_DEFAULTS.prepareAt;
    const delegateAt =
      typeof this.config.contextDelegateAt === 'number'
        ? this.config.contextDelegateAt
        : CONTEXT_SCHEDULER_DEFAULTS.delegateAt;

    const resolved: ContextSchedulerConfig = { prepareAt, delegateAt };
    validateContextSchedulerConfig(resolved);
    return resolved;
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

  /**
   * Maximum bytes persisted by download_file. Default: 52428800.
   */
  getDownloadMaxBytes(): number {
    const value = this.config.downloadMaxBytes;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }
    return TOOLS_DEFAULTS.downloadMaxBytes;
  }
}
