import * as fs from 'fs';
import * as path from 'path';
import { homePath } from './apphome';
import { logSink } from './logSink';

export interface ProviderConfig {
  baseUrl: string;
  model: string;
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
}
