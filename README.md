[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Ollama](https://img.shields.io/badge/Ollama-native-8A2BE2?logo=ollama)](https://ollama.com/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-ready-FF6B35?logo=openai)](https://openrouter.ai/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/your-username/tsuka/pulls)

<br />
<div align="center">

```
████████  ██████  ██    ██  ██    ██    ████
   ██    ██       ██    ██  ██   ██    ██  ██
   ██     ██████  ██    ██  ██████    ████████
   ██          ██ ██    ██  ██   ██   ██    ██
   ██    ██████    ██████   ██    ██  ██    ██
```

  <p><strong>TypeScript Unified Kit for Agents</strong></p>
  <p>Multi-Agent CLI Framework for Windows, Linux & macOS</p>
  <p>Read in <a href="README-it.md">🇮🇹 Italiano</a></p>
</div>

**TSUKA** is an ultra-lightweight, educational multi-agent framework and agentic CLI written entirely in TypeScript. Connect to local models via **Ollama**, **llama.cpp/llama-server** or **Unsloth Studio** (any OpenAI-compatible endpoint), or to cloud providers via **OpenRouter**. Born for **Windows + PowerShell**, it also supports **Linux** and **macOS** experimentally.

> **The name**: 柄 (*tsuka*) is the katana's hilt — the grip every blade attaches to. Your models are the blades; TSUKA is what lets you wield them.
>
> **Why?** Most agent frameworks are Python/Linux-only. TSUKA brings agentic power to the Windows command line without sacrificing portability.

## ✨ Highlights

| Feature | Description |
|---------|-------------|
| 🖥️ **Interactive TUI v0.5.1** | Full-screen dashboard (`tsuka --tui`), zero-flicker double-buffering, SGR 1006 mouse tracking, file viewer modal, multiline input, live tools search, and real-time inference telemetry |
| 📡 **Real-Time Inference Telemetry** | Sidebar widget monitoring prefill (KV Cache context ingestion), TTFT (Time To First Token), decode tok/s, model confidence, and latent candidate logits |
| 💾 **Markdown Session Export** | `/export [file]` & `/save` commands in both CLI & TUI saving clean session archives with collapsible CoT traces and tool outputs |
| 🧩 **Hot-plug tools** | Drop a `.ts` file into `src/tools/impl/` — auto-discovered at startup |
| 📡 **Server auto-discovery** | Startup scans local LLM servers (Ollama, Unsloth, …) and hooks onto the live one — preferring the model already loaded in RAM |
| 🎭 **Character system** | Roles (skills) × Traits (personality) × Presets (named agents) in JSON |
| 📊 **Capability Fingerprinting** | `/benchmark` objectively measures model skills — tier is *measured, not guessed* |
| 🛠️ **Self-authoring tools** | Agents write their own JavaScript tools via `create_tool` — sandboxed & hot-registered |
| 🧠 **Persistent shared memory** | Facts survive restarts, shared across all agents and sessions |
| 🛡️ **3-tier permissions** | SAFE / RESTRICTED / DANGEROUS — user always in control |
| 🖥️ **Cross-platform** | Windows (PowerShell) primary; Linux/macOS (`/bin/sh`) experimental |
| 🤝 **Multi-agent workflows** | Conference debates (`/call`), collaborative teams (`/team`) with 4 strategies, and a dynamic goal orchestrator (`/goal`) |
| 🔁 **Verify → correct loop** | Objective acceptance criteria (shell exit code, file, valid JSON) drive retries — the executor is not the only judge |
| ⏸️ **Interruptible generation** | `Esc` (or `Ctrl+X`) aborts a running generation; the partial reasoning is persisted, not lost |
| 🧠 **Context-aware execution** | Live reasoning display, per-agent token/timing stats (output/context/total), dual context bar (estimated + real peak from LLM), automatic history condensation between turns |

## 📋 Table of Contents

- [Highlights](#-highlights)
- [Quickstart (60 seconds)](#-quickstart-60-seconds)
- [Installation & Setup](#-installation--setup)
- [Interactive Terminal UI (TUI)](#-interactive-terminal-ui-tui-dashboard)
- [Slash Commands](#-repl-slash-commands)
- [Multi-Agent Workflows](#-multi-agent-workflows)
- [Tool Catalog (27 tools)](#-tool-catalog-27-tools)
- [Security](#-security)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tests](#-autonomous-validation--tests)
- [Documentation](#-documentation)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

## ⚡ Quickstart (60 seconds)

```bash
# 1. Clone, install and build (not published on npm yet)
git clone https://github.com/nispa/tsuka.git
cd tsuka
npm install
npm run build
npm link        # creates the global `tsuka` command

# 2. Initialize your workspace with the core agent preset
tsuka init --preset core

# 3. Launch in CLI REPL mode
tsuka

# 4. Or launch in Interactive Full-Screen Dashboard (TUI) mode
npm run tui
# or: tsuka --tui
```
*Make sure Unsloth Studio, llama-server or Ollama is running, or set your `OPENROUTER_API_KEY` in `.env`.*

## 🚀 Installation & Setup

### Prerequisites

```powershell
# 1. Install Ollama
#    https://ollama.com/
ollama serve

# 2. Pull a model
ollama pull qwen2.5-coder:7b
```

### Development Mode

```powershell
# 1. Clone & install
git clone https://github.com/your-username/tsuka.git
cd tsuka
npm install

# 2. Run development mode
npm run dev

# 3. (Optional) Benchmark your model for the best tool selection
/benchmark

# 4. Start chatting or:
/call @tuvok, @deanna_troi
```

### Production Build

```powershell
npm run build
npm start
```

### Install as a Global Command (`tsuka`)

Run TSUKA from any PowerShell window without `npm run dev`:

```powershell
npm run build
npm link        # creates the global `tsuka` command (shim on your PATH)
tsuka           # launch from anywhere
```

After changing the source, refresh the global command with `npm run build`. To uninstall: `npm unlink -g tsuka`.

### Initializing a Workspace (`tsuka init`)

```powershell
tsuka init                          # interactive: asks which preset
tsuka init --preset core            # essential roster (14 characters, 4 teams)
tsuka init --preset full            # every role, trait, character and team
tsuka init --pack osint,devops      # extra packs on top of the preset
tsuka init --force                  # overwrite an existing .tsuka/
```

Packs available in [`presets/packs/`](presets/packs/): `osint`, `content`, `devops`, `security`, `demo` — the last one collects deliberately extreme communication styles as a teaching example (a compliant voter makes a unanimity vote meaningless).

`tsuka init` creates a `.tsuka/` folder in the current directory with `memory/`, `workflow_logs/`, `output/` and copies of the chosen `roles/`, `traits/`, `characters/` and `teams/`, then probes the local LLM servers to write a starting configuration.

**App home vs workspace** ([`src/core/apphome.ts`](src/core/apphome.ts)): resources are resolved hierarchically.

1. If `.tsuka/<resource>` exists in the folder you launched `tsuka` from, that one wins — so a project initialized with `tsuka init` gets its own roster and its own memory.
2. Otherwise it falls back to the **app home**: the installation folder, or `TSUKA_HOME` when that environment variable is set.

The *workspace* is always the folder you launch `tsuka` from: it's where the agents' file tools (read/write/edit/grep) operate with relative paths. So you can `cd` into any project and let the agents work on it — with a shared roster and memory by default, or a project-local one after `tsuka init`.

## 🖥️ Interactive Terminal UI (TUI Dashboard)

In addition to standard CLI REPL mode, TSUKA provides a rich, full-screen interactive terminal dashboard:

```bash
npm run tui
# or with global binary:
tsuka --tui
```

### ✨ Key Dashboard Capabilities:
* **Zero-Flicker Double-Buffering**: Differential line rendering with 0ms visual latency, ANSI-safe box drawing, and terminal boundary wrapping protection.
* **Real-Time Inference Telemetry (`InferenceTelemetryWidget`)**: Eliminates "blind waiting" during local inference by tracking:
  * `⚡ PREFILL`: KV Cache prompt ingestion; the token count is marked as an estimate (`~N tok est.`) until the backend reports the exact prompt size.
  * `🌊 DECODE`: generation speed measured over the decode window only (prefill excluded) and **TTFT** (*Time to First Token*) in milliseconds.
  * `📊 Latent State & Logits`: confidence meter `[████████░░] 94%` and top candidates — shown **only** when the backend actually returns logprobs.
* **Workspace File Explorer & Code Preview Modal**:
  * Real-time file tree with file-type icons (`📁`, `🟦 TS`, `🟨 JS`, `⚙️ JSON`, `📝 MD`, `🧪 Test`, `🔒 Secrets`).
  * Browse the tree with **`→`** to enter a folder and **`←`** (or the `.. (up)` row) to come back out; the panel title shows the current path and the walk can never leave the workspace jail.
  * Press **`Enter`** (or double-click) to open a folder, or to open the **Workspace File Viewer Modal** on a file, with line numbers, smooth scrolling, and clipboard copy.
  * Press **`i`** or **`Space`** to insert the selected path (folder-aware, e.g. `src/tui/app.ts`) directly into the prompt buffer.
* **Multi-line Input Prompt & Paste Preservation**:
  * **`Shift+Enter`** / **`Ctrl+J`** / **`Alt+Enter`** inserts a newline without prematurely sending.
  * Dynamic elastic input box expanding smoothly from 3 to 6 rows.
  * 2D cursor navigation across lines and seamless multi-line clipboard pasting.
* **Interactive Tools Search & History Filter**:
  * In the **`F2`** Tools tab, type to live-search across all 27 native tools, risk tiers (`SAFE`, `RESTRICTED`, `DANGEROUS`), and execution logs.
* **Markdown Session Exporter**:
  * Type `/export` or `/save` to save the active conversation, reasoning blocks, and tool executions to `exports/session-<timestamp>.md`.
* **Configurable Layout Engine (`F7` / `/layout`)**:
  * Switch between presets (*Default Quadrant*, *Wide Chat*, *Right Sidebar*, *Zen Focus Mode*) and 5 curated color themes (*Cyan*, *Neon*, *Amber*, *Matrix*, *Minimal*).
* **Full REPL Slash Command Parity in TUI**:
  * `/goal <objective>`: Runs dynamic multi-agent orchestrator workflows directly in chat.
  * `/team <team> "<task>"`: Runs multi-agent team collaborative pipelines.
  * `/call @agent1 @agent2 "<topic>"`: Multi-agent round-table debate conferences.
  * `/runs` & `/blackboard`: Inspects recent workflow logs, performance metrics, and session blackboard notes.
  * `/provider`, `/models`, `/benchmark`: Live LLM server switcher, model selector, and capability fingerprinting benchmark suite.
  * `/copy`: Copies last assistant response directly to system clipboard.
* **SGR 1006 Mouse Tracking**:
  * Scroll with mouse wheel across Chat, Files Explorer, and Tools.
  * Click on tabs (`Chat` / `Tools`), click on files to insert file names, click inside the prompt to focus.
* **Interactive Lifecycle Dialogue Modals**:
  * **Timeout Renewal**: When reasoning takes long (e.g. 2 min), prompts to extend (+2m, unlimited, abort).
  * **Tool Round Extension**: When maximum consecutive tool executions are reached, prompts to extend (+15 rounds, conclude, abort).
* **Dynamic Context Window Calibration**: Automatically detects backend context limits via `detectContextWindow` on startup and on model change (`F6` / `/models`).
* **Measured Inference Telemetry**: TTFT, decode speed (prefill excluded from the window) and prompt ingestion rate are measured inside the streaming loop — never synthesized. Token confidence and top candidates are shown only when the backend actually returns logprobs (`"inferenceLogprobs": true` in `tsuka.config.json`, off by default); a backend rejecting the parameter is logged and retried without it.
* **Function Keys & Help Cheatsheet**:
  * `F1`: Chat View · `F2`: Tools View · `F3`: Agent Picker · `F4`: Team Picker · `F5`: Memory Inspector · `F6`: Model Switcher · `F12`: REPL Help Cheatsheet.
  * `?` opens the cheatsheet only when the prompt is not focused, so a question mark stays typable in your message.

## 🛠 REPL Slash Commands

| Command | Description |
|---------|-------------|
| `/goal <objective>` | Dynamic goal orchestrator — selects agents, assigns tasks, coordinates execution |
| `/team [name]` | Start a collaborative team workflow or pipeline |
| `/call [@agents...]` | Start a multi-agent conference debate |
| `/models [model]` | List & select available models |
| `/provider [name]` | Switch between Ollama, Unsloth and OpenRouter |
| `/effort [level]` | Manage reasoning effort (`none`\|`low`\|`medium`\|`xhigh`\|`auto`\|`ask`) |
| `/benchmark [model\|all]` | Measure model capabilities (tier & tok/s) |
| `/agent [name]` | Show or select the active agent |
| `/tools [query]` | List & filter enabled tools for active role, tier, and effort |
| `/export [file]` | Export complete conversation session, reasoning & tool logs to Markdown (alias: `/save`) |
| `/stop` | Abort currently running generation, reasoning, or tool execution (alias: `Esc` / `Ctrl+X`) |
| `/context` | Show history token usage against the context budget (and where the limit came from) |
| `/memory [clear\|<id>]` | Inspect, manage, or wipe persistent memories |
| `/blackboard` | Show notes and state of the latest workflow/goal |
| `/runs` | Show history and reports of recent workflow executions |
| `/continue [trace]` | Force-resume an interrupted reasoning trace instead of starting over |
| `/info` | Show session info (provider, model, agent) |
| `/reset` | Reset history + security approvals |
| `/search-engine` | Change search provider (DuckDuckGo / Google / Tavily) |
| `/help` | Show the list of available commands |
| `/clear` · `/exit` | Clear terminal · Quit |

**Keys during generation**: `Esc` (or `Ctrl+X`) aborts the current turn; `Ctrl+C` quits.

## 👥 Multi-Agent Workflows

### Dynamic Goal Orchestrator (`/goal`)

The `/goal` command dynamically assembles a team from **all available characters** to accomplish an objective:

```powershell
/goal Write a screenplay and generate the Krea2 prompt for every scene. Save it to cr.txt
```

1. **Planning phase**: the orchestrator LLM analyses the goal, selects the best-suited agents and assigns tasks — optionally with `PARALLELO` blocks for independent subtasks. Agents are presented through compact auto-generated signatures, and can be picked by *craft* rather than by name, keeping the planning prompt small.
2. **Execution phase**: all planned steps execute in order — including the supervisor. Each agent's task instructions explicitly tell them to **inspect workspace files** created by previous agents. A negative verdict from the final overseer sends the failed step back for one rework cycle instead of just closing the run.
3. **Context management**: after each agent turn, long assistant messages are condensed (keeping a 1500-char meaningful summary, not a one-liner) and a fact is saved to persistent memory. A **dual context bar** shows estimated context before the agent runs and the **real peak prompt tokens** measured from the LLM response after it completes.
4. **Stats summary**: at the end, a per-agent breakdown with output tokens, context tokens, total tokens, time and speed:

```
📊 RIEPILOGO STATS AGENTI
  Agente             Out tok    Ctx tok   Tot tok    Tempo    Velocità
  Doctor             1234      15032     16266     12.3s   100.3 tok/s
  Krea Master            892      16780     17672      8.1s   110.1 tok/s
  Pike                   456      17500     17956      4.2s   108.6 tok/s
  TOTALE                2582      17500     51894     24.6s
```

- **Out tok**: cumulative output (completion) tokens across all LLM rounds in that agent's turn
- **Ctx tok**: peak prompt tokens (context window size) measured from the last LLM round
- **Tot tok**: estimated total (ctx + out) for that agent

The planner can also emit `PARALLELO` blocks for independent subtasks. They run concurrently via `Promise.all` only if `parallelExecutionEnabled` is turned on in `tsuka.config.json` — **default is `false`**, so on a single GPU everything executes sequentially even inside a `PARALLELO` block, avoiding VRAM contention between agents sharing the same local model. When parallelism *is* enabled, each branch works in an isolated staging workspace (`workspace/parallel-<n>/`) merged at the end of the block: two branches writing the same path with different content produce a reported conflict, never a silent overwrite.

### Collaborative Teams (`/team`)

Lets an organized group of agents actively collaborate on a task, executing write and run tools:

```powershell
/team cyber_audit                        # Select a team
# Then: "Harden port 22 on this server"
```

The `mode` field of the team JSON selects the strategy ([`src/cli/commands/strategies/`](src/cli/commands/strategies/)):

| Mode | Behavior |
|------|----------|
| `round-robin` | Every member works in turn, round after round, until the task is declared solved |
| `pipeline` | Single pass over the members as an assembly line: station 1 gets the task, each following one refines what it receives (see below) |
| `orchestrated` | A designated `orchestrator` decides who works next after each turn (falls back to round-robin if its answer can't be parsed) |
| *hybrid* | Not a mode of its own: setting `discussionRounds > 0` inserts a discussion + voting round after each round of the strategy above |

- **Iterative rounds**: in `round-robin` and `orchestrated` the team works in rounds (default max 3, configurable via `teamMaxRounds` in `tsuka.config.json`) until the task is actually solved — not just one turn per member. `pipeline` is the exception: one pass, one turn per station.
- **Turn-based shifts**: each member takes their work turn, inheriting the full history of messages and tools executed by colleagues.
- **Shared physical workspace**: members operate on the same physical folder, letting the programmer write source code and the security expert inspect and modify it on the next turn.

#### How `pipeline` actually behaves

Stations are the `members` array, in order. The first is told *"you are first in the pipeline, work on the initial task"*; every following one is told *"you receive work from the previous station: analyse it, refine it, pass it on"*. There is no second lap — when the last station is done, the run is over.

What ends the chain early, for a station with no `acceptance` (the default):

| Event at a station | Result |
|---|---|
| Declares `COMPLETATO` (`report_status` or `STATO:` marker) | The **whole pipeline** stops and is reported as completed — even at station 2 of 5 |
| Declares `FALLITO` | The pipeline stops, reported as failed |
| Declares `DA_CONTINUARE` | Hand off to the next station |
| Member name not found in `characters/` | Warning, station skipped, the chain carries on |
| Last station finishes without `COMPLETATO` | Run ends as *not completed* — the work is still on disk |

So `COMPLETATO` here means "the group task is solved", not "my part is done" — a station that misreads it cuts the remaining stations out. If you want every station to run, tell them in the team description to close with `DA_CONTINUARE` unless the whole objective is met.

Optionally a station can be given an objective check, and only then does it get retries:

```jsonc
{
  "name": "dev_security",
  "members": ["geordi", "worf", "pike"],
  "mode": "pipeline",
  "maxAttempts": 3,                                  // default budget for the retries
  "acceptance": { "command": "npm test" },           // applied to the LAST station only
  "stations": {                                      // or per station, which wins
    "geordi": { "acceptance": { "fileExists": "src/server.js" }, "maxAttempts": 2 }
  }
}
```

With `acceptance` the station goes through the [verify → correct loop](#verify--correct-loop): failing the check re-runs *that station* with the concrete issues injected, up to `maxAttempts`; exhausting the budget (or stalling on an identical attempt) fails the whole pipeline instead of quietly moving on. Note that the outcome is then decided by the check, not by the marker: a station under `acceptance` that declares `COMPLETATO` no longer cuts the chain short.

Without `acceptance` — the case for every team shipped in [`teams/`](teams/) today — a station gets exactly one turn and is believed on its word.

### Conference Debate (`/call`)

Start a multi-voice discussion on any topic:

```powershell
/call @tuvok, @deanna_troi and @geordi   # Mention participants directly
/call                                    # Interactive multiselect checklist
```

Participants take turns reading previous responses. The full transcript is injected into the main chat history.

### Coordination Protocol (tool call → regex → default)

Small models are unreliable at emitting exact marker strings, so coordination is structured as **tool calls** first: `report_status` (`COMPLETATO` / `DA_CONTINUARE` / `FALLITO`), `route_next` (who works next, or `FINE`), `cast_vote` (`APPROVO` / `MODIFICARE` / `RIFIUTO`).

The decision order is **tool call → legacy text marker (`STATO: COMPLETATO`) → default**. Every fall to a lower level is *visible*: a yellow line in the UI plus a `protocol` entry (`tool_call` | `regex` | `fallback`) recorded per turn in the JSON report under `workflow_logs/` — no silent degradation.

### Run Blackboard

History is what was *said*, memory is what survives *between sessions*, and the blackboard is the state of *this run*: decisions taken, artifacts produced, open questions.

- `post_note(key, value)` / `read_notes(prefix?)` are SAFE tools available only inside a `/team` or `/goal` run.
- Isolation is per-run (`AsyncLocalStorage`): concurrent runs never see each other's notes, while the branches of a single `PARALLELO` block share one board.
- The board dies with the run, but a `snapshot()` is embedded in the run report; `/blackboard` shows the notes of the latest workflows.

### Verify → Correct Loop

Without an objective exit criterion, a small model happily declares any output finished — the executor would be its own judge. [`src/core/loop.ts`](src/core/loop.ts) adds one, in order of reliability:

1. **Objective acceptance** — `acceptance.command` (shell exit code 0, run through the workspace jail *and* the permission manager), `acceptance.fileExists`, `acceptance.jsonValid`
2. **Verdict from a verifier other than the executor** (`cast_vote` / `report_status`)
3. **Self-declaration by the executor**
4. **Budget exhausted** — `maxAttempts` (default 3)

The verifier's `issues` become the prompt of the next attempt (concrete corrections, never a generic "try again"). An **anti-stall signature** (normalized answer + set of modified files) detects two identical attempts and ends with `no_progress` before burning the whole budget.

`acceptance` and `maxAttempts` are optional per member/station in the team JSON: **absent = exactly the previous behavior**.

### Agent-Initiated Escalation

A single agent that finds a task too big can propose to scale it up: `request_goal`, `request_team` and `request_call` are RESTRICTED tools, so the user authorizes the escalation before anything starts. A depth guard (`WorkflowScope`) withdraws these tools whenever a parent workflow is already running, so a `/goal` cannot recursively spawn other `/goal`s.

## 🧰 Tool Catalog (27 tools)

Every tool is one `src/tools/impl/*.ts` file plus one `tools_schemas/*.json` schema. A role only sees what its `allowedTools` list grants, further pruned by model tier.

| Group | Tools |
|-------|-------|
| **Files** | `list_dir`, `read_file`, `write_file` (supports chunked `append`), `edit_file`, `delete_file`, `grep_search` |
| **System** | `execute_command` (per-call `timeout_ms`), `get_ps_info` |
| **Web** | `web_search`, `browse_url`, `download_file` |
| **Memory** | `save_memory`, `recall_memory` |
| **Team coordination** | `report_status`, `route_next`, `cast_vote`, `post_note`, `read_notes`, `send_message` |
| **Agent extension** | `spawn_agent`, `switch_skill`, `create_role`, `create_tool` |
| **Escalation** | `request_goal`, `request_team`, `request_call` |
| **Security** | `audit_code` (static scan for hardcoded secrets and dangerous constructs) |

Coordination tools are offered **only** inside a `/team` or `/goal` turn — never in plain chat. `spawn_agent` writes the sub-agent's full report to `runs/<runId>/` and returns just a short summary plus the path, so a subordinate task can't flood the parent's context.

## 🛡 Security

### Permission Tiers

| Level | Tools | Behavior |
|-------|-------|----------|
| **SAFE** | `list_dir`, `read_file`, `grep_search`, `get_ps_info`, `web_search`, `browse_url`, `save_memory`, `recall_memory`, `audit_code`, `spawn_agent`, `switch_skill`, coordination tools | Executed instantly |
| **RESTRICTED** | `write_file`, `edit_file`, `delete_file`, `download_file`, `create_role`, `create_tool`, `request_goal`, `request_team`, `request_call` | `[y/N/always]` prompt per action |
| **DANGEROUS** | `execute_command` | **Always** requires manual `[y/N]` — never bypassable |

Prompts are **serialized through an internal queue**: two agents running in parallel can never overlap their requests on stdin, and each prompt names the agent that is asking.

### Additional Safety Measures

- **Workspace jail**: `workspaceRoot` in `tsuka.config.json` restricts all file operations to a specific directory (defaults to the process working directory)
- **I/O limits**: `read_file` refuses files >5MB; `grep_search` skips files >5MB; `execute_command` output truncated to 50KB
- **Argument validation**: every tool call is validated against its JSON Schema before execution, with automatic repair of the truncated JSON small models tend to emit
- **Create_tool sandbox**: generated JavaScript runs through `vm` sandbox + pattern blocklist
- **Loop guard**: maximum consecutive tool call rounds per request — `maxToolRounds` in `tsuka.config.json` (default 15)
- **Recursion guard**: escalation tools are blocked inside an already-running workflow (`WorkflowScope` depth)

## 🔌 Key Features

### 1. Tool Auto-Discovery (Hot Plugin System)

At startup, [registry.ts](src/tools/registry.ts) scans `src/tools/impl/` and dynamically imports every `.ts` file.

```ts
// Adding a tool = creating 2 files:
// src/tools/impl/new_tool.ts  → execution logic
// tools_schemas/new_tool.json → OpenAI-compatible schema
```

### 2. Dynamic Prompt Assembly

Each agent's system prompt is built at runtime from:
- Active role instructions (`roles/*.json`)
- Active trait behavioral guidelines (`traits/*.json`)
- Only the tools the role is allowed to use

→ **Minimal token overhead, zero noise.**

A character may declare **several roles** (`roles: [...]` plus `activeRole`): only the active skill's instructions and tools are mounted, and the agent can swap skill mid-task with the `switch_skill` tool without restarting the session.

### 3. Adaptive Tool Selection (Tier Pruning + Fingerprinting)

Two mechanisms decide which tools a model can access:

| Mechanism | Method | Example |
|-----------|--------|---------|
| **Name heuristic** (fallback) | Detects `9b`, `26b`, `70b` from model name | `qwen-9b` → SMALL |
| **Capability Fingerprinting** 📊 | `/benchmark` runs the test set in `benchmarks/` | A 4B acing trivial tests no longer gets LARGE |

**Benchmark tests are JSON files in [`benchmarks/`](benchmarks/)** — add, edit or remove them on the fly, no code changes. Each file declares a prompt (or multi-step tool chains with declared tool results), the tools offered to the model, and a list of weighted declarative checks (`word_count`, `regex`, `json_path_equals`, `tool_arg_equals`, ...). `/benchmark` enumerates the tests, runs them and reports the per-test scores; category scores (instruction / json / toolCalling) are weighted averages. Profiles store the **hash of the test set**: changing any test auto-invalidates previously measured profiles. The default set is deliberately hard: counted lexical constraints, computed values inside JSON, a 2-step tool chain with **near-identical distractor ids**, and a trap question that names a tool without needing it. LARGE requires a near-perfect tool chain *plus* ≥85% precision on format and JSON.

```powershell
/benchmark                     # Test current model only
/benchmark all                 # Test all available models
```

The tier profile is saved to `models_profile.json`, keyed per reasoning effort level. `getModelTier()` uses the measured profile first, falls back to heuristic.

| Tier | Available Tools | Excluded |
|------|----------------|----------|
| **SMALL** | 21 tools (read, write, diagnostics, web, memory, protocol) | `execute_command`, `create_tool`, `spawn_agent`, `request_goal`, `request_team`, `request_call` |
| **MEDIUM** | 27 tools | — |
| **LARGE** | 27 tools | — |

When a model has a *measured* native function-calling capability (`toolCalling ≥ 0.9`), the textual "Available tools" listing is dropped from the system prompt — the schemas alone are enough, and the prompt gets shorter.

### 4. Objective Web Source Tracking

Every `web_search` / `browse_url` call deterministically extracts and prints URLs to the console. The model cannot hallucinate sources — they're displayed *by the framework*. `browse_url` renders pages through a Reader-View extractor (nav, footers, cookie banners discarded; tables converted to GFM; image and video URLs made absolute for Vision models).

### 5. Live Reasoning Display & Interruptible Generation 🧠

When a model emits `<think>` tags or native `reasoning_content` (e.g., DeepSeek R1), TSUKA displays the reasoning live in **dimmed gray** — just like opencode. Reasoning streams in real time alongside the status token counter, then content continues in white.

Generation is never a black box you have to sit through: pressing **`Esc`** (or `Ctrl+X`) aborts the current turn via an `AbortController` ([`src/cli/interrupt.ts`](src/cli/interrupt.ts)), and the reasoning produced so far is persisted rather than discarded — so `/continue` can pick it back up.

### 6. Persistent Shared Memory & Context Budget 🧠

All agents share `memory/memory.json`, **persisting across sessions**:

```
Agents → save_memory(content)  → memory/memory.json
Agents ← recall_memory(query?) ← memory/memory.json
Prompt  ← formatRelevant(task) ← memory/memory.json  (auto-injected)
```

```powershell
/memory                      # List & manage memories (or /memory clear to wipe)
```

Facts carry a `scope` (derived from the workspace root), a `kind` (`fact` / `decision` / `lesson` / `run`), optional tags and a `pinned` flag. An agent reads its own scope plus global facts; eviction is score-based (run leftovers fall first, pinned facts never), and retrieval is OR-scored by keyword, so a 5-word query still returns the best matches instead of nothing. Cap: `memoryMaxFacts` (default 200).

**Context budget.** History is pruned by *tokens*, not by message count: `maxHistoryTokens` (default 65536) is the primary limit, and the real context window is auto-detected at startup from the server (llama-server `/props`, Ollama `/api/show`, OpenRouter, vLLM) — `/context` shows both the usage and where the limit came from. `maxHistoryMessages` (default 500) is only a guard ceiling. Neither ever breaks a tool_call/tool pair. Single tool results are capped at `maxToolResultTokens` (default 4000).

Long reasoning chains are persisted whole to `memory/thinking/*.md` (only a short pointer goes into `memory.json`, to avoid bloating every future prompt) — including partial reasoning captured right before a timeout or an `Esc` interruption. If a session gets killed mid-task, `/continue [trace]` force-feeds that trace back into the next turn with an explicit "don't start over, decide and act" instruction, instead of relying on the model to `recall_memory` it on its own initiative.

### 7. Tool Self-Authoring (`create_tool`) 🛠️

Agents can write **brand-new tools** in JavaScript at runtime, extending their own capabilities without modifying the core codebase:

#### 📌 Activation Prerequisites:
1. **Allowed Role**: the active character or role must include `create_tool` in its `allowedTools` (e.g. `developer` like **Geordi**, `sysadmin` like **Scotty**/**Laan**, `game_designer` like **Paris**).
2. **Model Capability Tier (`MEDIUM` or `LARGE`)**: in `tools_schemas/create_tool.json`, the tool requires tier `medium`. If using a 7B/8B/9B model (defaulted to `SMALL`), the tool is hidden for safety. To unlock it:
   - Run `/benchmark` to evaluate your model: passing the tests will promote it to `MEDIUM`/`LARGE` in `models_profile.json`.
   - Or inspect available tools anytime by typing `/tools` in the REPL.

#### 💬 How to Use:
Simply ask the agent in plain language to create the tool:
> *"Create a new tool named `count_lines` that takes a file path and returns the number of lines."*

#### ⚙️ Tool Lifecycle:
1. Agent calls `create_tool` specifying name, JSON Schema parameters, and JavaScript code (`executeBody`)
2. Code is validated in a **`vm` sandbox** against a blocklist (`child_process`, `eval`, `process.env`, arbitrary `require`...)
3. Written to disk as `<tool impl dir>/<name>.js` + `tools_schemas/<name>.json` (`src/tools/impl/` in dev and `dist/tools/impl/` in build)
4. **Hot-registered** → immediately usable in the current session
5. On next startup, loaded via standard auto-discovery
6. Automatic **backup** in `tools_backup/` before any overwrite

```js
// Example tool generated and executed by the agent:
create_tool({
  name: "count_lines",
  description: "Counts lines in a text file",
  riskLevel: "SAFE",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  executeBody: "const c = require('fs').readFileSync(args.path, 'utf-8'); return 'Lines: ' + c.split('\n').length;"
})
```

⚠️ Generated tools cannot be `DANGEROUS` and cannot overwrite core `.ts` tools.

### 8. Server Auto-Discovery at Startup 📡

At launch, TSUKA doesn't blindly trust the configured provider — it scans ([`src/core/discovery.ts`](src/core/discovery.ts)):

1. **Probe the active provider** (short 2.5s timeout, via `/v1/models` with native Ollama `/api/tags` fallback).
2. If it's down, **probe all other configured local servers in parallel** and hook onto the first one alive (config is updated automatically). Remote providers are never probed unless active, so startup doesn't depend on the network.
3. **Model priority**: model already loaded in RAM → configured model if present on the server → first available. Attaching to the loaded model avoids forcing the server to reload a different one from scratch — and keeps `/benchmark` profiles attributed to the model actually answering.

The loaded model is detected per server family: Unsloth Studio marks it with `"loaded": true` in `/v1/models`, LM Studio with `"state": "loaded"`, Ollama via the `/api/ps` endpoint.

If no server responds, the REPL still starts — switch manually with `/provider`.

### 9. Cross-Platform 🖥️

Abstracted by [`src/core/platform.ts`](src/core/platform.ts):

| Platform | Shell | Tool Examples |
|----------|-------|---------------|
| **Windows** 🪟 | `powershell.exe -NoProfile -Command` | `Get-Process`, `Get-Service`, `Get-Volume` |
| **Linux** 🐧 | `/bin/sh -c` | `ps`, `df -h`, `systemctl` |
| **macOS** 🍎 | `/bin/sh -c` | `ps aux -r`, `launchctl`, `df -h` |

Sensitive env vars (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`...) are filtered on all platforms.

## 🏗 Architecture

```
                     ┌──────────────────────┐
                     │   characters/*.json  │
                     └──────┬───────┬───────┘
                            │       │
                     ┌──────▼──┐ ┌──▼────────┐
                     │ roles/* │ │ traits/*  │
                     │ (tools) │ │ (style)   │
                     └──────┬──┘ └────┬──────┘
                            └────┬────┘
                                 ▼
                     ┌──────────────────────┐
                     │  Dynamic System      │
                     │  Prompt Assembly     │
                     └──────────┬───────────┘
                                ▼
                     ┌───────────────────────────────┐
                     │  Ollama / llama.cpp /         │
                     │  Unsloth Studio / OpenRouter  │
                     └──────────────┬────────────────┘
                                    ▼
                     ┌──────────────────────┐
                     │  src/tools/impl/*.ts │
                     └──────────────────────┘
```

### Component Breakdown

| Folder | Purpose |
|--------|---------|
| [`roles/`](roles/) | Skill definitions + allowed tool lists |
| [`traits/`](traits/) | Communication style & personality prompts |
| [`characters/`](characters/) | Named Character Presets / Agents (linking one or more roles + a trait) |
| [`teams/`](teams/) | Multi-agent team configs (mode, members, orchestrator, acceptance) |
| [`presets/`](presets/) | Install manifests used by `tsuka init` (`core.json` + `packs/`) |
| [`benchmarks/`](benchmarks/) | Declarative test set used by `/benchmark` |
| [`tools_schemas/`](tools_schemas/) | JSON Schema for every tool (Function Calling) |
| [`src/tools/impl/`](src/tools/impl/) | Pure TypeScript tool execution logic |

## 🧪 Autonomous Validation & Tests

```powershell
# Run all suites
npm test

# Individual suites
npx tsx tests/test_roles.ts
npx tsx tests/test_memory.ts
npx tsx tests/test_fingerprinting.ts
npx tsx tests/test_self_authoring.ts
npx tsx tests/test_platform.ts
```

Current status: **65 test suites, 1200+ assertions — all green**. Every suite runs without network access or a live LLM (`MockLLMProvider`) and against a temporary memory file, so `npm test` never touches your real memories.

## 📚 Documentation

| Resource | Description |
|----------|-------------|
| [Technical docs](docs/README.md) | Portal: index of every document below |
| [Architecture](docs/architecture.md) | Registry, tier pruning, dynamic prompt assembly |
| [Multi-agent workflows](docs/multi-agent.md) | `/call`, `/team` and `/goal` mechanics in detail |
| [Security](docs/security.md) | Permission manager, workspace jail, deterministic source logging |
| [Use cases](docs/use-cases.md) | Concrete recipes with characters, roles and teams |
| [Educational guide](docs/educational-guide.md) | Step by step: how to build an agentic harness from scratch |

The [GitHub wiki](https://github.com/nispa/tsuka/wiki) is **generated** from these files by `npm run wiki:build`
(`scripts/buildWiki.ts`) and republished by the `Wiki` workflow: pages are never edited there, so the wiki
cannot drift from the documentation in the repository. The slash commands page is built straight from the
command table, so it always matches the code.

## 🗺 Roadmap

The terminal UI is hand-rolled ANSI (no Ink, no React) — a deliberate constraint while building the core, not the destination. **TSUKA is heading to a proper TUI**: panels, independently refreshing regions, and a scrollback that isn't fighting the agents' output — which matters most exactly when several agents are talking at once. The groundwork is already underway: every print is being routed through a replaceable sink (`src/core/logSink.ts`) and a shared `StreamRenderer`, so the interface becomes one client among others instead of *being* the application. See [architecture §16](docs/architecture.md).

## 🤝 Contributing

PRs are welcome! The architecture is deliberately kept simple:
- Tools live in `src/tools/impl/` — add one, add its schema, done.
- Roles, traits, characters, teams are plain JSON — extend without touching TypeScript.
- Tests go into `tests/` — see existing ones for patterns.

## 📄 License

[MIT](LICENSE) — free for educational, personal, and commercial use.
