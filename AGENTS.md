# TSUKA — Agent & Developer Guide (AGENTS.md)

## 📌 Project Overview & Tech Stack

**TSUKA** (TypeScript Unified Kit for Agents) is a lightweight, deterministic multi-agent CLI harness in TypeScript. It orchestrates local LLM backends (Ollama, llama.cpp, Unsloth, LM Studio) and cloud gateways (OpenRouter) using an OpenAI-compatible interface (`/v1/chat/completions`).

* **Runtime**: Node.js (v20+ recommended), TypeScript (strict mode, ES2022 target, CommonJS module output), `tsx` for live execution.
* **Core Design**: Deterministic ReAct loop, hot-plug dynamic tool auto-discovery, orthogonal persona system (*Role* × *Trait* = *Character/Agent*), session-scoped run blackboard via `AsyncLocalStorage`, token-budgeted memory with semantic keyword scoring, and empirical capability fingerprinting (`/benchmark`).
* **Metrics**: 27 native tools · 24 characters/agents · 21 roles · 9 traits · 10 preconfigured teams · 20 REPL slash commands · 65 automated test suites · Dual CLI & TUI Interactive Interfaces.

---

## 🚨 Non-Negotiable Directives for Coding Agents

1. **English Only Across Codebase**: Code, TypeScript types, interfaces, functions, variables, comments, and docstrings **must always be written in English**. User-facing CLI prompts and docs may be bilingual, but source code is strictly English.
2. **I/O Decoupling — Always Use `logSink`**: **NEVER** use direct `console.log`, `console.error`, `console.warn`, or raw TTY stream writes inside `src/core/`, `src/tools/`, `src/tui/`, or `src/safety/`. All logging and diagnostic output **must** go through the injectable `logSink` (`src/core/logSink.ts`) or the `AgentEvents` event contracts (`onChunk`, `onStats`, `onEvent`). The only directory permitted to use direct `console.*` is `src/cli/` (which owns the raw terminal). The TUI layer (`src/tui/app.ts`) installs a custom `setLogSink()` on startup that silences `log` and routes `warn`/`error` to `store.notify()`, so any stray `console.log` in core/tools would corrupt the double-buffered screen. When adding new code anywhere under `src/`, always `import { logSink } from '../core/logSink'` and call `logSink.log()`, `logSink.warn()`, `logSink.error()` instead of `console.*`.
3. **Strict Workspace Jail**: All filesystem operations (`read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `grep_search`, `audit_code`) must be strictly confined within `workspaceRoot` via `resolveSafePath()`. Escaping via `..` is blocked.
4. **Environment & Credential Masking**: Automatically mask sensitive environment variables (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `AUTH`) before logging or sending prompts.
5. **Deterministic Multi-Agent Coordination**: Inter-agent communication in `/team` and `/goal` must use dedicated protocol tools (`report_status`, `route_next`, `cast_vote`) with automated fallback to text markers and visible degradation warnings.
6. **No Test Regressions**: All 65 test suites (`npm test`) must pass cleanly before completing any task. Automated tests must use mock stores and temporary test directories—never mutate the active user's `memory.json`.

---

## 🏛️ System Architecture

```
CLI REPL (src/cli/) ──► Agent.run() ──► LLMProvider.chatWithTools() (OpenAI API)
         ▲                  │
         │                  ▼
TUI App (src/tui/)   ToolRegistry.executeTool() ◄── Auto-Discovery (src/tools/impl/)
                            │
                            ▼
                     PermissionManager (SAFE / RESTRICTED / DANGEROUS)
```

### Five Decoupled Layers

| Layer | Directory | Responsibility |
|---|---|---|
| **CLI & REPL** | `src/cli/` | REPL loop, slash command router, interactive menus (`prompts`), animated statusline, live ANSI streaming, and Markdown repainting. |
| **Interactive TUI** | `src/tui/` | Zero-flicker full-screen terminal dashboard: double-buffered differential rendering, SGR 1006 mouse tracking, scrollbars, workspace file explorer, modal dialogues, and tabbed view routing. |
| **Core Engine** | `src/core/` | Deterministic ReAct loop (`Agent`), HTTP LLM provider (`LLMProvider`), token context budgeter, blackboard (`AsyncLocalStorage`), persistent memory (`MemoryStore`), server discovery, and loop controller. |
| **Tools** | `src/tools/` | Auto-discovery dynamic registry (`ToolRegistry`), tier gating, JSON Schema definitions (`tools_schemas/`), and 27 native TypeScript tool implementations (`src/tools/impl/`). |
| **Safety** | `src/safety/` | 3-tier risk system (`SAFE`, `RESTRICTED`, `DANGEROUS`), serialized interactive permission queue (`enqueuePrompt`), workspace jail, and `node:vm` sandbox for runtime tools (`create_tool`). |

---

## 📂 Source Code & File Index

```
harness/
├── src/
│   ├── cli/
│   │   ├── index.ts                 # CLI REPL entry point & turn lifecycle
│   │   ├── shared.ts                # Dynamic loader for roles, traits, characters, teams
│   │   ├── stream.ts                # StreamRenderer: live chunk output & ANSI Markdown repaint
│   │   ├── input.ts                 # Tab completion, history navigation, and readline loop
│   │   ├── interrupt.ts             # Raw mode keyboard hook (Esc / Ctrl+X turn interrupt)
│   │   ├── statusline.ts            # Animated spinner & status updates
│   │   ├── ui.ts                    # Theme definitions, chalk helpers, and InteractiveMenu
│   │   └── commands/                # Slash command implementations shared with the TUI
│   ├── tui/
│   │   ├── index.ts                 # TUI entry point (npm run tui / tsuka --tui)
│   │   ├── app.ts                   # TuiApp main orchestrator, layout composer, key/mouse router
│   │   ├── screen.ts                # TuiScreen: differential buffer renderer, ANSI-safe box drawing
│   │   ├── store.ts                 # TuiStore: reactive state management (Flux/Observable pattern)
│   │   ├── bridge.ts                # TuiBridge: decouples Core AgentEvents into TUI actions
│   │   ├── types.ts                 # TUI state interfaces, modals, keypress & mouse events
│   │   ├── ansi.d.ts                # TypeScript type declarations for slice-ansi & wrap-ansi
│   │   ├── inputParser.ts           # Raw TTY decoder: key events, SGR 1006 mouse, help shortcut
│   │   ├── boxDrawing.ts            # ANSI-safe widths, padding, boxes and scrollbars
│   │   ├── navigation.ts            # TUI_TABS table: function keys, labels, click zones, modals
│   │   ├── layoutConfig.ts          # Layout presets, themes and widget order (tui.layout.json)
│   │   ├── commands/                # Slash command table (registry + handlers) & menu.json
│   │   ├── controllers/             # Command dispatcher and turn runner
│   │   ├── modals/                  # Modal builders and modal key handling
│   │   ├── widgets/                 # Sidebar micro-widgets (persona, metrics, telemetry, LEDs)
│   │   └── views/                   # Reusable pure UI view components:
│   │       ├── Header.ts            # Top tabs (F1 Chat, F2 Tools) & context window meter
│   │       ├── Sidebar.ts           # Agent Profile, role instructions, active tool tags
│   │       ├── Files.ts             # Workspace files explorer with file-type icons & scrollbar
│   │       ├── Chat.ts              # Markdown chat feed, <think> reasoning styling, tool output
│   │       ├── Tools.ts             # Native tool inspection & execution history
│   │       ├── Input.ts             # Bottom prompt buffer with cursor & working spinner
│   │       └── Modal.ts             # Universal modal overlay (permission prompt, menus, help)
│   ├── core/
│   │   ├── agent.ts                 # Agent class: ReAct cycle, token pruning, smart compression
│   │   ├── provider.ts              # LLMProvider: OpenAI SDK client, SSE parser, timeouts
│   │   ├── types.ts                 # Core protocol interfaces & shared types
│   │   ├── contextBudget.ts         # Token estimations, runtime calibration, capForContext
│   │   ├── memory.ts                # MemoryStore: persistent facts, keyword scoring, eviction
│   │   ├── blackboard.ts            # Ephemeral session blackboard isolated via AsyncLocalStorage
│   │   ├── modelProfile.ts          # Capability fingerprinting profiles & tier assigner
│   │   ├── benchmarkTests.ts        # Test runner for instruction, JSON, and tool benchmarks
│   │   ├── discovery.ts             # Server discovery, VRAM loaded-model detector, context probe
│   │   ├── parallelWorkspace.ts     # Isolated filesystem staging & conflict-aware merge
│   │   ├── logBuffer.ts             # Console output buffer for concurrent parallel branches
│   │   ├── loop.ts                  # RunController: iterative execution with acceptance criteria
│   │   ├── logSink.ts               # Injectable logging abstraction decoupling core from TTY
│   │   ├── thinkParser.ts           # Streaming parser separating <think> reasoning from content
│   │   ├── messageQueue.ts          # Inter-agent message queue (send_message)
│   │   ├── apphome.ts               # Hierarchical path resolver (.tsuka/ vs global app home)
│   │   ├── platform.ts              # Cross-platform shell executor (PowerShell / sh)
│   │   └── config.ts                # ConfigManager: tsuka.config.json manager
│   ├── tools/
│   │   ├── index.ts                 # Dynamic auto-discovery scanner
│   │   ├── registry.ts              # ToolRegistry, tier gating, parameter validation
│   │   └── impl/                    # 27 native tool implementations
│   └── safety/
│       └── permissions.ts           # PermissionManager: async FIFO prompt queue & bypass state
├── characters/                      # 24 Character JSON definitions (aiName + roles + trait)
├── roles/                           # 21 Role JSON definitions (systemPrompt + allowedTools)
├── traits/                          # 9 Trait JSON definitions (tone + stylistic guidelines)
├── teams/                           # 10 Team JSON definitions (members + mode + orchestrator)
├── presets/                         # Manifests: core.json & domain packs for tsuka init
├── tools_schemas/                   # 27 JSON Schema files for function calling validation
├── benchmarks/                      # 5 JSON capability benchmark fixtures
├── tests/                           # 65 automated test suites
└── tsuka.config.json                # Runtime configuration file
```

---

## ⚙️ Core Technical Contracts

### 1. Deterministic ReAct Loop (`Agent.run()`)
* **Dynamic Assembly**: Mounts active character identity, role instructions, trait tone, relevant persistent memories, and tier-authorized tools.
* **Token Pruning (`pruneHistory`)**: Enforces token budget (`maxHistoryTokens`, calibrated from server headers). Removes oldest messages while preserving matching pairs of `tool_call` and `tool` response messages.
* **Anti-Loop Ceiling**: Hard limit of 15 consecutive tool rounds (`Agent.DEFAULT_MAX_TOOL_ROUNDS = 15`), configurable via `maxToolRounds`.
* **Output Truncation (`capForContext`)**: Tool responses exceeding `maxToolResultTokens` (default 4,000) are truncated with head/tail preservation and pagination advice.

### 2. Coordination Protocol Tools (T2.1)
In collaborative multi-agent workflows (`/team`, `/goal`), coordination uses structured tools:
* `report_status(status, summary, next_hint)` — `COMPLETATO`, `DA_CONTINUARE`, `FALLITO` (`FALLITO` halts execution chain).
* `route_next(agent, reason)` — Dynamic orchestrator routing (`@agent_name` or `FINE`).
* `cast_vote(vote, reason)` — Formal voting during hybrid discussion rounds (`APPROVO`, `MODIFICARE`, `RIFIUTO`).
* **Resolution Order**: `Tool Call` $\to$ `Regex Text Marker (Fallback)` $\to$ `Safety Default` (with visual degradation warnings and logging to `workflow_logs/`).

### 3. State Management: Three Strict Levels
1. **Turn History (RAM)**: Ephemeral exchange messages and raw tool outputs within the active turn. Subject to pruning.
2. **Run Blackboard (`blackboard.ts`)**: Shared scratchpad across members of a **single workflow run** (`/team` or `/goal`), isolated via `AsyncLocalStorage`. Read/written via `post_note` and `read_notes`. Exported into the run's JSON log report and destroyed on completion.
3. **Long-Term Persistent Memory (`memory/memory.json`)**: Cross-session knowledge store shared by all agents. Eviction prioritizes transient execution logs while protecting lessons and permanently preserving `pinned` facts.

### 4. Parallel Execution in `/goal` (`PARALLELO` blocks)
* Independent branches execute concurrently via `Promise.all`.
* **Staging Sandbox**: Each branch writes to an isolated folder via `AsyncLocalStorage` (`parallelWorkspace.ts`). On block exit, changes are merged into the real workspace with conflict detection (no silent overwrites).
* **Serialized UI Prompts**: `PermissionManager` queues interactive prompts sequentially (`enqueuePrompt`) so parallel branches never collide on the terminal.

### 5. Defensive SAST Tool (`audit_code`)
Comprehensive static analysis engine inspecting code for:
* `CWE-798` (Hardcoded secrets, OpenAI/AWS/GitHub tokens, JWT, PEM keys)
* `CWE-78` / `CWE-95` (Command injection and unsafe dynamic code evaluation `eval`)
* `CWE-89` (SQL injection via concatenated queries)
* `CWE-22` (Path traversal with un-sanitized dynamic paths)
* `CWE-79` (DOM XSS via `innerHTML`, `dangerouslySetInnerHTML`)
* `CWE-327` / `CWE-295` (Broken crypto MD5/SHA1 and disabled TLS verification)
* `CWE-532` / `CWE-732` (Log credential leaks and permissive permissions `chmod 777`)
* Supports `severityThreshold` (`HIGH`, `MEDIUM`, `LOW`), `fileExtensions`, and `maxIssues` filtering.

---

## 🛠️ Developer & Testing Cheatsheet

### Standard Commands

```powershell
# Development execution with hot TypeScript runner (tsx)
npm run dev

# Compile TypeScript to dist/ (tsc)
npm run build

# Run compiled build
npm start

# Execute full automated test suite (57 test suites)
npm test

# Link globally for CLI usage
npm link
```

### Running Individual Tests
To run or debug a specific test suite directly:

```powershell
npx tsx tests/test_security_agent.ts
npx tsx tests/test_goal_orchestrator.ts
npx tsx tests/test_parallel_workspace.ts
npx tsx tests/test_blackboard.ts
npx tsx tests/test_team_modes.ts
```

---

## 🎭 Persona System Guidelines

* **Every Character is an Agent**: Characters in `characters/*.json` combine an operational craft (`role`, with multi-skill support via `roles: [...]`) and an expressive style (`trait`).
* **Roles are the Contract, Names are Data**: Code must never hardcode character names. Always query roles via `resolveCharacter` or `characterWithRole` (e.g. `@security_auditor` resolves to whichever character exercises that role).
* **Total Role Coverage**: Every role in `roles/*.json` must be exercised by at least one character in `characters/*.json` (validated by `tests/test_presets.ts`).
