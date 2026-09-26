/**
 * Shape of tsuka.config.json: pure type definitions and validation tables.
 * No I/O and no state — the loader/manager lives in `manager.ts`.
 */

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  class: 'LOCAL' | 'CLOUD';
  displayName: string;
  apiKeyEnv?: string;
  capabilities: import('../providerCatalog').ProviderCapabilities;
}

export interface ProviderOverride {
  baseUrl?: string;
  model?: string;
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
  /** Backend family registered by the web search registry; built-in default: http. */
  backend?: string;
  /** Provider selected inside the backend family; HTTP providers come from web_search_providers.json. */
  provider: string;
}

/**
 * One MCP (Model Context Protocol) stdio server: a child process exposing
 * tools that TSUKA registers as its own with the `mcp__<server>__<tool>`
 * naming convention. Full shape in src/core/mcp/types.ts.
 */
export interface McpServerConfigEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  riskLevel?: 'SAFE' | 'RESTRICTED' | 'DANGEROUS';
  timeoutMs?: number;
}

export interface AppConfig {
  activeProvider: string;
  /** Per-install endpoint/model overrides; provider definitions live in providers.json. */
  providerOverrides?: Record<string, ProviderOverride>;
  /** Legacy inline definitions are read for migration compatibility only. */
  providers?: Record<string, Partial<ProviderConfig>>;
  webSearch: WebSearchConfig;
  activeRole: string;
  activeTrait: string;
  activeCharacter: string;
  maxHistoryMessages?: number;
  maxHistoryTokens?: number;
  maxToolResultTokens?: number;
  /** Bounded lifetime of hot-path config snapshots. */
  hotPathConfigCacheTtlMs?: number;
  /** Whether roles with `coreTools` defer the rest behind `load_tools` (T14.14). Default: true. */
  deferredToolsEnabled?: boolean;
  /** Maximum consecutive tool execution rounds per user turn. Default: 15. */
  maxToolRounds?: number;
  /** Maximum facts retained in persistent memory before score-based eviction. Default: 200. */
  memoryMaxFacts?: number;
  /**
   * Active long-term memory backend selected from the registry (`src/core/memory/registry.ts`).
   * Built-in: 'json'. Overridable per-run with the TSUKA_MEMORY_BACKEND environment variable.
   */
  memoryBackend?: string;
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
  /** Enables parallel /goal blocks for local providers; trusted cloud gateways enable them automatically. */
  parallelExecutionEnabled?: boolean;
  /** Enables loading and creating executable custom tools. Default: false. */
  selfAuthoringEnabled?: boolean;
  /**
   * Credential-like environment variables execute_command may still see (T24.1), e.g.
   * ["GITHUB_TOKEN"] for `gh`. Every other name matching the sensitive pattern is removed
   * from the shell's environment. Default: none.
   */
  commandEnvPassthrough?: string[];
  /** Maximum number of activity records kept in the in-memory ContextTracker ring buffer. Default: 100. */
  contextTrackerMaxEntries?: number;
  /** Enables autonomous subagent delegation when context pressure crosses configured thresholds (T22.8). Default: false. */
  contextSchedulerEnabled?: boolean;
  /** Context pressure ratio at which turn data is prepared into a TaskPacket (T22.8). Default: 0.60. */
  contextPrepareAt?: number;
  /** Context pressure ratio at which automatic delegation triggers (T22.8). Default: 0.70. */
  contextDelegateAt?: number;
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
  /** Maximum bytes persisted by one download_file call. Default: 52428800. */
  downloadMaxBytes?: number;
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
  /**
   * MCP stdio servers launched at startup; their tools join the ToolRegistry as
   * `mcp__<server>__<tool>` (T20.1). A failing server degrades with a warning,
   * it never blocks startup.
   */
  mcpServers?: Record<string, McpServerConfigEntry>;
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
 * Clean default configuration written when tsuka.config.json is missing entirely.
 */
export function defaultAppConfig(): AppConfig {
  return {
    activeProvider: '',
    providerOverrides: {},
    webSearch: {
      provider: 'duckduckgo'
    },
    activeRole: 'developer',
    activeTrait: 'professional',
    activeCharacter: 'custom'
  };
}
