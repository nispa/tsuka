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
  /** Initial delay for HTTP 429 retries; subsequent attempts use exponential backoff. */
  rateLimitRetryBaseMs: 1_000,
  /** Upper bound for Retry-After and computed HTTP 429 delays. */
  rateLimitRetryMaxMs: 10_000,
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

/** Configuration cache defaults for hot paths that only need a stable snapshot. */
export const CONFIG_DEFAULTS = {
  /** Maximum collision retries when backing up an invalid configuration. */
  maxCorruptBackupAttempts: 100,
  /** Maximum age of a hot-path configuration snapshot before it is reloaded. */
  hotPathCacheTtlMs: 5_000,
  /** Lowest accepted user override, preventing a cache from degenerating into polling. */
  hotPathCacheMinTtlMs: 100,
  /** Highest accepted user override, keeping external edits visible in bounded time. */
  hotPathCacheMaxTtlMs: 60_000,
};

/** Persistent-memory defaults (memory package + ConfigManager fallbacks). */
export const MEMORY_DEFAULTS = {
  /** Facts retained before score-based eviction (memoryMaxFacts). */
  maxFacts: 200,
  /** Character cap for memory sections injected into prompts (memoryMaxChars). */
  promptMaxChars: 600,
  /** Facts considered for the system-prompt memory section before the character cap. */
  promptMaxFacts: 10,
  /** Longest content save_memory accepts: a fact, not a document. */
  factMaxChars: 500,
  /** recall_memory results when the caller gives no limit, and the highest limit honoured. */
  recallDefaultLimit: 10,
  recallMaxLimit: 50,
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

/** Context scheduler threshold defaults (T22.4, T22.8). */
export const CONTEXT_SCHEDULER_DEFAULTS = {
  /** Default enablement of context-driven autonomous subagent delegation. */
  enabled: false,
  /** Pressure ratio at or above which an agent begins preparation for handoff. */
  prepareAt: 0.60,
  /** Pressure ratio at or above which an agent must delegate to avoid overflow. */
  delegateAt: 0.70,
};

/** Task packet handoff briefing defaults (T22.5). */
export const TASK_PACKET_DEFAULTS = {
  /** Maximum character length for task objective. */
  maxObjectiveChars: 4_000,
  /** Maximum number of constraint items. */
  maxConstraints: 20,
  /** Maximum character length for a single constraint. */
  maxConstraintChars: 1_000,
  /** Maximum number of acceptance criteria items. */
  maxAcceptanceCriteria: 20,
  /** Maximum character length for a single acceptance criterion. */
  maxCriterionChars: 1_000,
};

/** Compact agent result contract defaults (T22.6). */
export const AGENT_RESULT_DEFAULTS = {
  /** Maximum character length for child result summary. */
  maxSummaryChars: 4_000,
  /** Maximum number of items in list fields (changes, decisions, unresolved, evidence). */
  maxListItems: 50,
  /** Maximum character length for an individual list item. */
  maxItemChars: 1_000,
  /** Maximum character length for raw failure snippet in fallback result. */
  maxFailureSnippetChars: 500,
};

/** Subagent execution defaults (T22.7, subagentRunner, spawn_agent). */
export const SUBAGENT_DEFAULTS = {
  /** Maximum character length for inline task description in spawn_agent. */
  maxTaskLength: 2_000,
  /** Maximum character length for briefing file in spawn_agent. */
  maxBriefingFileLength: 12_000,
  /** Default role assigned when none is specified. */
  defaultRole: 'developer',
  /** Default trait assigned when none is specified. */
  defaultTrait: 'professional',
};

/** Defaults for the read-only multi-agent consultation command (`/call`). */
export const CALL_DEFAULTS = {
  /** Each invited participant speaks once in every consultation round. */
  rounds: 3,
};

/** Tool-side defaults (execute_command, browse_url, download_file, ContextTracker). */
export const TOOLS_DEFAULTS = {
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
  /** Shape-validation timeout for generated tool modules (child process start-up included). */
  createToolValidationTimeoutMs: 10_000,
  /** Wall-clock limit of one isolated custom tool call before the child is killed. */
  customToolTimeoutMs: 30_000,
  /** V8 heap ceiling of the isolated custom tool child process. */
  customToolMaxMemoryMb: 256,
  /** Result bytes accepted from an isolated custom tool call. */
  customToolMaxOutputBytes: 1024 * 1024,
  /** Shortest secret value redacted from tool results; shorter ones would blank ordinary text. */
  redactionMinSecretChars: 8,
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
  /** Maximum bytes persisted by one download_file call (downloadMaxBytes). */
  downloadMaxBytes: 50 * 1024 * 1024,
  /** Maximum redirects followed by the shared HTTP safety boundary. */
  httpMaxRedirects: 5,
  /** Maximum results returned by the built-in web search providers. */
  webSearchMaxResults: 5,
  /** Character ceiling for each untrusted result title after normalization. */
  webSearchTitleMaxChars: 300,
  /** Character ceiling for each untrusted result snippet after normalization. */
  webSearchSnippetMaxChars: 1_200,
  /** Character ceiling for each untrusted result URL after normalization. */
  webSearchUrlMaxChars: 2_048,
  /** Maximum activity records in the ContextTracker ring buffer (contextTrackerMaxEntries). */
  contextTrackerMaxEntries: 100,
  /** Age after which an uncommitted resumable write staging file is discarded. */
  resumableWriteStaleMs: 60 * 60 * 1000,
  /** Maximum staging entries inspected during one resumable-write cleanup pass. */
  resumableWriteCleanupMaxEntries: 100,
  /** Upper bound on live in-process resumable write sessions. */
  resumableWriteMaxActiveSessions: 100,
  /** Random-name collision attempts when a resumable write starts a staging file. */
  resumableWriteStageNameAttempts: 3,
  /** Random bytes used in an individual resumable-write staging filename. */
  resumableWriteStageNameRandomBytes: 12,
  /** Maximum consecutive validation errors for a single tool within an agent turn before aborting (T23.14). */
  maxConsecutiveValidationErrors: 3,
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
  /** Header columns kept free for the brand and version after the tab row. */
  headerBrandReserve: 16,
  /** Modal geometry shared by full-screen text and file viewers. */
  viewerMaxWidth: 105,
  viewerMinWidth: 40,
  viewerHorizontalMargin: 6,
  viewerMaxHeight: 26,
  viewerMinHeight: 10,
  viewerVerticalMargin: 4,
};
