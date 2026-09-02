/**
 * Central registry of built-in default values (AGENTS.md directive 9 — No Hardcoded
 * Tunables). Every tunable constant lives here exactly once, namespaced by subsystem;
 * modules import from this file instead of declaring local literals, so a default can
 * be audited and changed in one place. Values that users may override at runtime go
 * through ConfigManager with one of these constants as the fallback.
 *
 * NOT here: data tables that are content rather than tuning (model sampling profiles,
 * stop-word lists), and wire-protocol literals owned by a single protocol module.
 */

/** LLM call defaults (provider/timeouts.ts, ConfigManager fallbacks). */
export const LLM_DEFAULTS = {
  /** Wall-clock wait for the first streamed token before an attempt is retried. */
  firstTokenTimeoutMs: 120_000,
  /** Attempts before raising a non-responsive error. */
  maxRetries: 3,
  /** Generous completion-token ceiling sent with every request. */
  maxTokensCeiling: 8192,
  /** Wall-clock timeout for the whole generation (llmTimeoutMs). */
  generationTimeoutMs: 120_000,
};

/** Provider discovery and local model loading defaults. */
export const DISCOVERY_DEFAULTS = {
  /** Maximum wait for a provider or context metadata probe. */
  probeTimeoutMs: 2_500,
  /** Short follow-up probe used after a provider has already responded. */
  metadataTimeoutMs: 1_500,
  /** Model swaps can legitimately take several minutes on local hardware. */
  warmUpTimeoutMs: 300_000,
};

/** Persistent-memory defaults (memory package + ConfigManager fallbacks). */
export const MEMORY_DEFAULTS = {
  /** Facts retained before score-based eviction (memoryMaxFacts). */
  maxFacts: 200,
  /** Character cap for memory sections injected into prompts (memoryMaxChars). */
  promptMaxChars: 600,
  /** Width of the short human-readable summary label (T14.20), git-subject convention. */
  summaryMaxLen: 72,
  /** Auto-derived tags per fact when the caller passes none (T15.4). */
  autoTagsMax: 5,
  /** BM25 term-frequency saturation parameter (T17.1). */
  bm25K1: 1.2,
  /** BM25 document-length normalization parameter (T17.1). */
  bm25B: 0.75,
  /** Minimum token length for prefix matching to apply (T15.1). */
  minPrefixTokenLen: 3,
  /** Fraction of capacity transient 'run' notes may fill during overflow eviction (T15.5). */
  runQuotaRatio: 0.3,
  /** Half-life in hours per kind (T15.2): how long a fact stays "fresh". */
  halfLifeHours: { run: 2, fatto: 48, decisione: 168, lezione: 720 } as Record<string, number>,
};

/** ReAct loop / context budgeting defaults. */
export const AGENT_DEFAULTS = {
  /** Maximum consecutive tool execution rounds per user turn (maxToolRounds). */
  maxToolRounds: 15,
  /**
   * Seed ratio of the runtime-calibrated characters-per-token estimate; the Agent
   * refines it from real usage.prompt_tokens (T5.1).
   */
  seedCharsPerToken: 3.5,
  /** Exponential smoothing weight for observed prompt character/token ratios. */
  tokenRatioSmoothing: 0.2,
  /**
   * Fixed ratio used for estimates outside a live Agent (contextBudget.ts): no usage
   * feedback is available there, so the calibrated value cannot apply.
   */
  staticCharsPerToken: 3.5,
  /** Single tool-result context cap in estimated tokens (maxToolResultTokens). */
  maxToolResultTokens: 4000,
  /** Character threshold above which /goal turn outputs are condensed to memory. */
  goalCondensedHistoryCharLimit: 1500,
  /** Minimum reasoning trace length worth persisting to disk and memory. */
  reasoningTraceMinChars: 300,
  /** Maximum incomplete reasoning-tag candidate retained between stream chunks. */
  thinkTagCandidateMaxChars: 32,
  /**
   * Guard limit on retained session messages; primary compaction is token-driven
   * via historyTokens below (maxHistoryMessages).
   */
  maxHistoryMessages: 500,
  /** Fallback context window when no runtime detection is available (maxHistoryTokens). */
  defaultHistoryTokens: 65536,
  /** Maximum rounds in a /team workflow (teamMaxRounds). */
  teamMaxRounds: 3,
};

/** Tool-side defaults (execute_command, browse_url, download_file, ContextTracker). */
export const TOOLS_DEFAULTS = {
  /** Maximum characters accepted by one write_file call. */
  writeFileMaxContentChars: 16_000,
  /** Maximum recursion depth for workspace scans. */
  workspaceScanMaxDepth: 32,
  /** Maximum files visited by one workspace scan. */
  workspaceScanMaxFiles: 10_000,
  /** Maximum aggregate file bytes considered by one workspace scan. */
  workspaceScanMaxBytes: 100 * 1024 * 1024,
  /** Per-file size ceiling for grep_search. */
  grepMaxFileBytes: 5 * 1024 * 1024,
  /** Match count ceiling for grep_search. */
  grepMaxMatches: 50,
  /** Per-file size ceiling for audit_code. */
  auditMaxFileBytes: 2 * 1024 * 1024,
  /** Finding count used when audit_code receives no explicit maximum. */
  auditDefaultMaxIssues: 50,
  /** Maximum JavaScript body accepted by create_tool when self-authoring is enabled. */
  createToolMaxBodyChars: 4_000,
  /** Shape-validation timeout for generated tool modules. */
  createToolValidationTimeoutMs: 1_000,
  /** Shell command execution timeout for execute_command (commandTimeoutMs). */
  commandTimeoutMs: 120_000,
  /** Lowest accepted per-call command timeout override. */
  commandMinTimeoutMs: 1_000,
  /** Highest accepted per-call command timeout override. */
  commandMaxTimeoutMs: 600_000,
  /** Raw command output retained before context-aware truncation. */
  commandMaxOutputBytes: 50 * 1024,
  /** Grace period between cooperative and forced process-tree termination. */
  commandTerminationGraceMs: 750,
  /** HTTP request timeout for browse_url (browseFetchTimeoutMs). */
  browseFetchTimeoutMs: 30_000,
  /** HTTP request timeout for download_file (downloadFetchTimeoutMs). */
  downloadFetchTimeoutMs: 60_000,
  /** Maximum redirects followed by the shared HTTP safety boundary. */
  httpMaxRedirects: 5,
  /** Maximum activity records in the ContextTracker ring buffer (contextTrackerMaxEntries). */
  contextTrackerMaxEntries: 100,
};

/** MCP client defaults (src/core/mcp/, ConfigManager-independent). */
export const MCP_DEFAULTS = {
  /** Wall-clock wait for the initialize handshake before a server is deemed broken. */
  initializeTimeoutMs: 30_000,
  /** Default per-request timeout for tools/list and tools/call. */
  requestTimeoutMs: 60_000,
  /** Permission tier for MCP tools when the server config does not override it. */
  defaultRiskLevel: 'RESTRICTED' as const,
};

/** CLI REPL defaults. */
export const CLI_DEFAULTS = {
  /** Command history lines retained in the REPL history file (cliMaxHistory). */
  maxHistoryLines: 100,
};

/** Terminal UI layout defaults (tui/interaction/geometry.ts, tui/layoutComposer.ts). */
export const TUI_DEFAULTS = {
  /** Yield before starting the next queued prompt so the completed frame can render. */
  promptQueueDelayMs: 50,
  /** Minimum usable terminal width before clamping (effectiveWidth floor). */
  minEffectiveWidth: 20,
  /** Sidebar width bounds in columns, whatever percentage the layout asks for. */
  sidebarMinWidth: 22,
  sidebarMaxWidth: 42,
  /** Fallback percentages when the layout config omits them. */
  sidebarWidthPercent: 26,
  filesHeightPercent: 55,
  /** Minimum heights keeping every pane usable on short terminals. */
  minMainHeight: 5,
  minFilesHeight: 5,
  minProfileHeight: 6,
  /** Input box: line range and padding around the raw newline count. */
  inputMinLines: 3,
  inputMaxLines: 6,
  inputPaddingLines: 2,
  /** Modal geometry shared by full-screen text and file viewers. */
  viewerMaxWidth: 105,
  viewerMinWidth: 40,
  viewerHorizontalMargin: 6,
  viewerMaxHeight: 26,
  viewerMinHeight: 10,
  viewerVerticalMargin: 4,
};
