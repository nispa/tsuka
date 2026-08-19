# System Architecture — TSUKA 🏛️

<div align="right">
  <p>Leggi in <a href="architecture-it.md">🇮🇹 Italiano</a></p>
</div>

> This document describes the technical architecture, design principles, and modular structure of the **TSUKA** framework (v0.5.1). For codebase contribution guidelines, see [`AGENTS.md`](../AGENTS.md); for completed and upcoming task backlogs, see [`TASKS.md`](../TASKS.md).
>
> 📊 **System Metrics**: 30 tools · 20 REPL commands · 24 core modules · 21 roles · 9 traits · 24 characters (agents) · 10 preconfigured teams · 72 automated test suites · Dual CLI & TUI interfaces.

---

## 1. Conceptual Model & Deterministic ReAct Loop

TSUKA is built on the **ReAct** (*Reason + Act*) paradigm, governed by a deterministic code infrastructure that tightly controls context, tools, and resource budgets allocated to the Large Language Model.

```
                      ┌────────────────────────────┐
                      │    User Input / Objective  │
                      └─────────────┬──────────────┘
                                    │
                                    ▼
                      ┌────────────────────────────┐
                      │  Dynamic Prompt Assembly   │
                      │   (Identity + Memory +     │
                      │    Allowed Tier Tools)     │
                      └─────────────┬──────────────┘
                                    │
            ┌───────────────────────▼────────────────────────┐
            │          LLM Invocation (HTTP Stream)          │◄─────────────┐
            └───────────────────────┬────────────────────────┘              │
                                    │                                       │
                             [ Model Output ]                               │
                                    │                                       │
                      Contains      │                                       │
                      tool calls?   ├────────── No ──────────┐              │
                                    │                        │              │
                                   Yes                       ▼              │
                                    │                  ┌───────────┐        │
                                    ▼                  │   Final   │        │
                         ┌──────────────────────┐      │ Response  │        │
                         │  Argument Validation │      └─────┬─────┘        │
                         │  & Permission Check  │            │              │
                         └──────────┬───────────┘            │              │
                                    │                        │              │
                                    ▼                        │              │
                         ┌──────────────────────┐            │              │
                         │ Tool Execution &     │            │              │
                         │ Context Truncation   │            │              │
                         └──────────┬───────────┘            │              │
                                    │                        │              │
                                    ▼                        │              │
                         ┌──────────────────────┐            │              │
                         │ Inject Result into   │            │              │
                         │    Chat History      │────────────┘              │
                         └──────────┬───────────┘                           │
                                    └───────────────────────────────────────┘
```

### Deterministic Control Principle
With local LLMs (especially under 30B parameters), reliability increases the more control logic is owned by code rather than delegated to the model:
* **The model decides content**: synthesizing text, reasoning on tasks, formulating structured tool arguments.
* **The harness governs workflow**: selecting visible tools by capability tier, capping excessive outputs, enforcing permissions, and breaking infinite loops with hard limits (`Agent.DEFAULT_MAX_TOOL_ROUNDS = 15`).

---

## 2. Layered Architecture & Decoupling

The codebase is organized into four independent layers with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       1. CLI & UI (src/cli/)                            │
│      REPL · Slash Commands · Live ANSI Rendering · Interactive Menus    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ User Input / Events
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        2. CORE ENGINE (src/core/)                       │
│    ReAct Loop (Agent) · LLM Provider · Persistent Memory · Context      │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │ Tool Invocations                │ Permission Queries
                    ▼                                 ▼
┌─────────────────────────────────────┐   ┌───────────────────────────────┐
│      3. TOOL REGISTRY (src/tools/)  │   │     4. SAFETY (src/safety/)   │
│ Auto-discovery · JSON Schema · Impl │   │ Permission Manager · Sandbox  │
└─────────────────────────────────────┘   └───────────────────────────────┘
```

| Layer | Directory | Architectural Responsibility |
|---|---|---|
| **Core** | `src/core/` | Manages the ReAct cycle (`Agent`), LLM client (`LLMProvider`), persistent storage (`MemoryStore`), context budget, and run blackboard. Fully decoupled from Node TTY and the terminal. |
| **Tools** | `src/tools/` | Hosts the dynamic auto-discovery registry (`ToolRegistry`), JSON Schema contracts, and 27 native tool implementations. Zero UI dependencies. |
| **Safety** | `src/safety/` | Defines risk tiers (`SAFE`, `RESTRICTED`, `DANGEROUS`), manages async permission queues, and enforces workspace path sandboxing. |
| **CLI** | `src/cli/` | Implements the REPL loop, slash command router, animated statusline, and ANSI/Markdown stream renderer. Operates as *one* possible client to the core engine. |

### I/O Decoupling: `AgentEvents` and `logSink`
The core engine never writes directly to `console.log` or TTY streams:
* Agent runs broadcast life-cycle updates through event contracts (`onChunk`, `onStats`, `onEvent`, `AbortSignal` in `agentEvents.ts`).
* Internal service modules (`MemoryStore`, `ConfigManager`, `ToolRegistry`) emit diagnostics through an injectable log sink ([`src/core/logSink.ts`](../src/core/logSink.ts)), paving the way for headless servers or web UIs without core refactoring.

---

## 3. The Lifecycle of a Request

Every user iteration in the REPL or within a workflow follows six deterministic stages:

1. **Dynamic Prompt Assembly (`loadSystemPrompt`)**: Concatenates character identity, role system prompt, trait stylistic directives, semantically relevant memory facts, and the textual tool catalog (omitted if the model has verified native function calling).
2. **Adaptive Tool Filtering (`registry.listForLLM`)**: Applies a dual-filter: tools must belong to the active role's `allowedTools` list and satisfy the model's capability tier at the current reasoning effort level.
3. **Token-Driven History Pruning (`pruneHistory`)**: Verifies that total history tokens fit within `maxHistoryTokens`. Removes older messages while strictly maintaining integrity between `tool_call` and `tool` response pairs.
4. **Streaming LLM Invocation (`provider.chatWithTools`)**: Sends payload to the OpenAI-compatible backend, parsing `<think>` reasoning chunks separately from visible `content`.
5. **Tool Validation & Execution**: Tool calls are validated against their JSON Schema contracts. `PermissionManager` prompts the user if necessary. Tool outputs are safely truncated to context bounds (`capForContext`).
6. **Re-injection & Continuation**: Results are appended with role `tool`, re-triggering the loop until the model outputs text or exhausts rounds.

---

## 4. Declarative Character System: Roles, Traits, Characters, and Teams

All agent personalities and skills are purely configured in JSON files outside the application source:

```
┌─────────────────────────┐     ┌────────────────────────┐
│      ROLE (roles/)      │  ×  │     TRAIT (traits/)    │  ──►  CHARACTER / AGENT
│(Capabilities & Tool set)│     │(Tone & Communication)  │      (e.g. @geordi, @worf, @pike)
└─────────────────────────┘     └────────────────────────┘
```

| Component | Directory | Function & Purpose |
|---|---|---|
| **Role** | `roles/*.json` | Technical capability: system instructions (`systemPrompt`), authorized tools (`allowedTools`), and default `reasoningEffort`. |
| **Trait** | `traits/*.json` | Behavioral stance and style (e.g. `professional`, `creative`, `grumpy`, `uncompromising`). |
| **Character (Agent)** | `characters/*.json` | Named agent preset linking an identifier (`aiName`), functional description, one or more roles (`roles: [...]` with `activeRole`), and a trait. |
| **Team** | `teams/*.json` | Multi-agent collaboration config defining members, strategy (`mode`), orchestrator, and acceptance criteria (`acceptance`). |

### The Functional Role of Character `description`
In the goal orchestrator ([`/goal`](multi-agent.md)), the planning LLM selects agents primarily based on the `description` field in `characters/*.json`. Accurate descriptions allow the orchestrator to dynamically choose agents based on their craft rather than fixed names.

---

## 5. Tool System & Tier Pruning

The harness includes **27 integrated tools** built on schema-execution separation:
* **JSON Schema (`tools_schemas/<name>.json`)**: defines name, description, parameters, risk tier (`riskLevel`), and required model tier (`requiredTier`).
* **Implementation (`src/tools/impl/<name>.ts`)**: pure TypeScript execution logic adhering to the `Tool` interface.

```
                  ┌──────────────────────────────┐
                  │       27 Native Tools        │
                  └──────────────┬───────────────┘
                                 │
           Filter 1: Role        ▼
        ┌─────────────────────────────────────────────────┐
        │   Role allowedTools list (roles/*.json)         │
        └────────────────────────┬────────────────────────┘
                                 │
           Filter 2: Tier        ▼
        ┌─────────────────────────────────────────────────┐
        │   Model Tier (SMALL / MEDIUM / LARGE)           │
        │   from /benchmark Fingerprint or Name Heuristic │
        └────────────────────────┬────────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │  Tools presented to LLM in   │
                  │        current turn          │
                  └──────────────────────────────┘
```

### Tool Catalog Breakdown
1. **Filesystem**: `read_file`, `write_file` (with append support and 16k char ceiling per call to prevent JSON truncation), `edit_file`, `delete_file`, `list_dir`, `grep_search`.
2. **System**: `execute_command` (shell runner with timeout), `get_ps_info` (process & system metrics).
3. **Web & Network**: `web_search`, `browse_url` (with Reader View extraction), `download_file`.
4. **Memory**: `save_memory`, `recall_memory`.
5. **Coordination**: `report_status`, `route_next`, `cast_vote`, `post_note`, `read_notes`, `send_message`.
6. **Agent Extension**: `spawn_agent`, `switch_skill`, `create_role`, `create_tool`, `request_goal`, `request_team`, `request_call`.
7. **Security**: `audit_code` (OWASP vulnerability and secret scanner).

---

## 6. Memory Hierarchy & State Management

TSUKA implements three distinct state layers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. TURN HISTORY (RAM)                                                       │
│    Scope: single agent in active turn                                       │
│    Content: raw message exchanges & tool outputs                            │
│    Lifecycle: volatile (pruned upon turn completion or context limit)       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. RUN BLACKBOARD (AsyncLocalStorage / blackboard.ts)                       │
│    Scope: shared across all members of a single /team or /goal run          │
│    Content: intermediate decisions, notes, and session artifacts            │
│    Lifecycle: lives only for the run duration; embedded in JSON log report  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. LONG-TERM PERSISTENT MEMORY (memory/memory.json)                         │
│    Scope: persistent across all sessions and agents                         │
│    Content: project conventions, architectural decisions, learned lessons   │
│    Lifecycle: permanent on disk, managed via score-based eviction           │
└─────────────────────────────────────────────────────────────────────────────┘
```

* **Scoping**: facts are tagged by workspace root or marked `globale`.
* **Kind & Eviction**: facts have kinds (`fact`, `decision`, `lesson`, `run`). When capacity is reached (`memoryMaxFacts`, default 200), transient `run` entries are evicted first, while `pinned` facts are never removed.
* **Semantic Retrieval**: prompt injection uses weighted OR keyword scoring with morphological stemming.

---

## 7. Context Window Governance

TSUKA uses three progressive defenses against context saturation:

1. **Tool Result Capping (`capForContext`)**: Tool outputs exceeding `maxToolResultTokens` (default 4,000) are truncated with head/tail preservation and instructions on how to paginate (e.g. `offset`/`limit` in `read_file`).
2. **Token-Driven Pruning (`pruneHistory`)**: History truncation operates on estimated token count (`maxHistoryTokens`), auto-calibrated dynamically against real `usage.prompt_tokens`.
3. **Server Window Auto-Detection**: At startup, TSUKA detects real context limits from server endpoints (llama-server `/props`, Ollama `/api/show`, OpenRouter `context_length`).

---

## 8. Reasoning Effort & Timing Control

For reasoning models (e.g. DeepSeek R1), `reasoning_effort` (`none`, `low`, `medium`, `xhigh`) is resolved through a 5-tier cascade:

```
Global Pin (/effort) ──► Caller Override ──► Character ──► Role ──► Config Default
```

* **Tier-Effort Coupling**: `/benchmark` profiles models at all effort levels. Changing effort via `/effort` updates the active tier and adjusts visible tools accordingly.
* **Dual Timeout Protection**: `FIRST_TOKEN_TIMEOUT_MS` protects against stalled servers, while `MAX_GENERATION_MS` (`llmTimeoutMs`) sets an absolute generation ceiling.

---

## 9. Multi-Agent Execution Modes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXECUTION MODES                                │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│ 1. Single Chat  │ 2. Conference   │ 3. Team         │ 4. Goal Orchestrator  │
│    (/agent)     │    (/call)      │    (/team)      │    (/goal)            │
│                 │                 │                 │                       │
│ Interactive     │ Multi-agent     │ Fixed squad     │ Dynamic planning with │
│ turn with role  │ debate without  │ with 4 workflow │ all characters and    │
│ tools           │ tools           │ strategies      │ PARALLEL blocks       │
├─────────────────┴─────────────────┴─────────────────┴───────────────────────┤
│ 5. Autonomous Sub-Agent (spawn_agent): isolated subtask delegation          │
└─────────────────────────────────────────────────────────────────────────────┘
```

* **Team Strategies**: `orchestrated` (supervisor routes each turn via `route_next`), `round-robin` (fixed cycle), `pipeline` (assembly line with acceptance loop in `loop.ts`), `hybrid` (discussion and voting).
* **Parallel Workspace Isolation**: `PARALLELO` blocks execute concurrently via `Promise.all` in isolated staging folders (`AsyncLocalStorage`), followed by safe conflict-detecting file merges.

---

## 10. Provider Connectivity & Server Discovery

A unified client using the **OpenAI SDK** interfaces with local and remote endpoints:
* **Server auto-discovery (`discovery.ts`)**: probes configured endpoints on launch with a 2.5s timeout.
* **RAM/VRAM Priority**: automatically attaches to the model already loaded in memory (`/api/ps` in Ollama, `loaded` in Unsloth/LM Studio) to avoid redundant weights reloading.

---

## 11. Core Module Index

| Module | Source Path | Architectural Responsibility |
|---|---|---|
| **Agent** | `src/core/agent.ts` | ReAct loop, token pruning, compression, and event orchestration. |
| **Provider** | `src/core/provider.ts` | HTTP OpenAI client, streaming parser, tokens accounting, and timeouts. |
| **Memory Store** | `src/core/memory.ts` | Persistent JSON storage, keyword scoring, and eviction engine. |
| **Blackboard** | `src/core/blackboard.ts` | Session blackboard scoped per workflow via `AsyncLocalStorage`. |
| **Context Budget** | `src/core/contextBudget.ts` | Dynamic token estimation, runtime calibration, and `capForContext`. |
| **Model Profile** | `src/core/modelProfile.ts` | Capability fingerprinting profiles and model tier management. |
| **Discovery** | `src/core/discovery.ts` | Server discovery, loaded model detection, and context window probes. |
| **Parallel Workspace** | `src/core/parallelWorkspace.ts` | Staging directories and conflict-aware file merge engine. |
| **Loop Controller** | `src/core/loop.ts` | Iterative execution and objective acceptance verification (`acceptance`). |
| **Log Sink** | `src/core/logSink.ts` | Injectable logging abstraction decoupling core from terminal TTY. |
| **App Home** | `src/core/apphome.ts` | Hierarchical path resolution (global app home vs local workspace). |
| **Platform** | `src/core/platform.ts` | Cross-platform shell execution (PowerShell on Windows, `/bin/sh` on Unix). |

---

## 12. Interactive Terminal UI Architecture (`src/tui/`)

TSUKA features a zero-flicker, Component-Driven terminal user interface:

```
                  ┌──────────────────────────────┐
                  │    TuiScreen (Double-Buffer) │
                  └──────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │       TuiStore (Flux/State)   │
                 └───────┬───────────────▲───────┘
                         │               │
      ┌──────────────────┴──┐         ┌──┴──────────────────┐
      │  Pure View Layer    │         │  TuiBridge Adapter   │
      │  (Header, Sidebar,  │         │  (Subscribes to Core │
      │   Files, Chat, etc.)│         │   AgentEvents)       │
      └─────────────────────┘         └─────────────────────┘
```

* **`TuiScreen` (`screen.ts`)**: Low-level ANSI double-buffering line renderer with differential updates (0ms latency, zero flicker) and robust ANSI slicing via `slice-ansi` and `string-width`.
* **`TuiStore` (`store.ts`)**: Reactive state container managing active tabs, conversation feed, reasoning streaming chunks, files tree, token meters, and modal queues.
* **`TuiBridge` (`bridge.ts`)**: Decouples the Core Engine (`AgentEvents`, `PermissionManager`) from the UI.
* **View Hierarchy (`src/tui/views/`)**: Pure functional renderers receiving `(state, width, height) => string[]`:
  * `HeaderView`: Top navigation tabs & token budget progress meter.
  * `SidebarView`: Active persona, role, trait, and token analytics.
  * `FilesView`: Workspace directory scanner with file-type icons, scrollbar, and click-to-insert.
  * `ChatView`: Formatted markdown, syntax highlighting, and `<think>` reasoning containers.
  * `ToolsView`: Dynamic tool catalog & execution history.
  * `InputView`: Text buffer, multi-line cursor, and working status spinner.
  * `ModalView`: Universal overlay for safety permissions, model picker, and REPL cheatsheets. Each modal type contributes only its own box (`BOX_BUILDERS`); centering and compositing are shared.
* **Data-Driven Dispatch Tables**: behaviour lives in lists, not in conditional chains, so extending the TUI means adding a row.
  * `src/tui/commands/`: the slash command table (`registry.ts`) — name, aliases, description and handler per command, grouped in `sessionCommands` / `workflowCommands` / `configCommands`. `TuiCommandController` only parses the line and looks it up; `assertMenuCoverage()` keeps the table and the slash menu (`commands/menu.json`) from drifting apart.
  * `src/tui/navigation.ts`: the tab table — function key, per-width labels, and the modal each tab toggles. The header row, the mouse click zones and the help cheatsheet all derive from it, so a relabelled tab cannot lose its click target.
  * `src/tui/layoutConfig.ts`: layout presets, themes and widget order (`tui.layout.json`).
  * `src/tui/keybindings.json`: raw escape sequences mapped to key names.

---

## 13. Security & Permission Framework

* **3-tier risk system**: `SAFE` (instant), `RESTRICTED` (prompt with session bypass option), `DANGEROUS` (always interactive manual confirmation).
* **Workspace Jail**: file operations are restricted to `workspaceRoot`.
* **Credential Masking**: automatic redaction of sensitive environment keys.
* **Dynamic Sandbox**: user-created tools (`create_tool`) execute in sandboxed `node:vm` with pattern blocklists.

---

*For practical tutorials and examples, see the [Educational Guide](guida-didattica.md) and [Multi-Agent Workflows](multi-agent.md).*
