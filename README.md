[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Ollama](https://img.shields.io/badge/Ollama-native-8A2BE2?logo=ollama)](https://ollama.com/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-ready-FF6B35?logo=openai)](https://openrouter.ai/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/your-username/tsuka/pulls)

<br />
<div align="center">
  <h1>⚡ TSUKA</h1>
  <p><strong>TypeScript Unified Kit for Agents</strong></p>
  <p>Multi-Agent CLI Framework for Windows, Linux & macOS</p>
  <p>Read in <a href="README-it.md">🇮🇹 Italiano</a></p>
</div>

**TSUKA** is an ultra-lightweight, educational multi-agent framework and agentic CLI written entirely in TypeScript. Connect to local models via **Ollama** or cloud providers via **OpenRouter**. Born for **Windows + PowerShell**, it also supports **Linux** and **macOS** experimentally.

> **The name**: 柄 (*tsuka*) is the katana's hilt — the grip every blade attaches to. Your models are the blades; TSUKA is what lets you wield them.
>
> **Why?** Most agent frameworks are Python/Linux-only. TSUKA brings agentic power to the Windows command line without sacrificing portability.

## ✨ Highlights

| Feature | Description |
|---------|-------------|
| 🧩 **Hot-plug tools** | Drop a `.ts` file into `src/tools/impl/` — auto-discovered at startup |
| 📡 **Server auto-discovery** | Startup scans local LLM servers (Ollama, Unsloth, …) and hooks onto the live one — preferring the model already loaded in RAM |
| 🎭 **Character system** | Roles (skills) × Traits (personality) × Presets (named agents) in JSON |
| 📊 **Capability Fingerprinting** | `/benchmark` objectively measures model skills — tier is *measured, not guessed* |
| 🛠️ **Self-authoring tools** | Agents write their own JavaScript tools via `create_tool` — sandboxed & hot-registered |
| 🧠 **Persistent shared memory** | Facts survive restarts, shared across all agents and sessions |
| 🛡️ **3-tier permissions** | SAFE / RESTRICTED / DANGEROUS — user always in control |
| 🖥️ **Cross-platform** | Windows (PowerShell) primary; Linux/macOS (`/bin/sh`) experimental |
| 🤝 **Multi-agent workflows** | Conference debates (`/call`), collaborative teams (`/team`), and dynamic goal orchestrator (`/goal`) |
| 🧠 **Context-aware execution** | Live reasoning display, per-agent token/timing stats (output/context/total), dual context bar (estimated + real peak from LLM), automatic history condensation between turns |

## 📋 Table of Contents

- [Architecture](#-architecture)
- [Key Features](#-key-features)
- [Multi-Agent Workflows](#-multi-agent-workflows)
- [Security](#-security)
- [Commands](#-repl-slash-commands)
- [Getting Started](#-getting-started)
- [Tests](#-autonomous-validation--tests)
- [Documentation](#-documentation)
- [License](#license)

## 🏗 Architecture

```
                     ┌──────────────────────┐
                     │   characters/*.json   │
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
                     ┌──────────────────────┐
                     │  Ollama / OpenRouter │
                     └──────────┬───────────┘
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
| [`characters/`](characters/) | Named presets linking a role + a trait |
| [`teams/`](teams/) | Multi-agent sequential collaboration configs |
| [`tools_schemas/`](tools_schemas/) | JSON Schema for every tool (Function Calling) |
| [`src/tools/impl/`](src/tools/impl/) | Pure TypeScript tool execution logic |

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

The tier profile is saved to `models_profile.json`. `getModelTier()` uses the measured profile first, falls back to heuristic.

| Tier | Available Tools | Excluded |
|------|----------------|----------|
| **SMALL** | 20 tools (read, write, diagnostics, web, memory, protocol) | `execute_command`, `create_tool`, `spawn_agent` |
| **MEDIUM** | 23 tools | — |
| **LARGE** | 23 tools | — |

### 4. Objective Web Source Tracking

Every `web_search` / `browse_url` call deterministically extracts and prints URLs to the console. The model cannot hallucinate sources — they're displayed *by the framework*.

### 5. Live Reasoning Display 🧠

When a model emits `<think>` tags or native `reasoning_content` (e.g., DeepSeek R1), TSUKA displays the reasoning live in **dimmed gray** — just like opencode. Reasoning streams in real time alongside the status token counter, then content continues in white.

### 6. Persistent Shared Memory 🧠

All agents share `memory/memory.json`, **persisting across sessions**:

```
Agents → save_memory(content)  → memory/memory.json
Agents ← recall_memory(query?) ← memory/memory.json
Prompt  ← formatForPrompt()    ← memory/memory.json  (auto-injected)
```

```powershell
/memory                      # List recent memories
/forget <id|all>             # Remove specific memory or wipe all
```

Chat history is also configuratively pruned (`maxHistoryMessages` in `tsuka.config.json`, default 40) without breaking tool_call/tool pairs.

### 7. Tool Self-Authoring (`create_tool`) 🛠️

Agents can write **brand-new tools** in JavaScript at runtime:

1. Agent calls `create_tool` with the `executeBody` JavaScript code
2. Code is validated in a **`vm` sandbox** against a blocklist (`child_process`, `eval`, `process.env`, arbitrary `require`...)
3. Written to disk as `src/tools/impl/<name>.js` + `tools_schemas/<name>.json`
4. **Hot-registered** → immediately usable in the current session
5. On next startup, becomes part of standard auto-discovery
6. Automatic **backup** in `tools_backup/` before any overwrite (rollback)

```js
// Example tool created by the agent itself:
create_tool({
  name: "count_lines",
  description: "Counts lines in a file",
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

## 👥 Multi-Agent Workflows

### Dynamic Goal Orchestrator (`/goal`)

The `/goal` command dynamically assembles a team from **all available characters** to accomplish an objective:

```powershell
/goal Crea una sceneggiatura e per ogni scena genera il prompt Krea2. Salva in cr.txt
```

1. **Planning phase**: the orchestrator LLM analyses the goal, selects the best-suited agents and assigns tasks — optionally with `PARALLELO` blocks for independent subtasks.
2. **Execution phase**: all planned steps execute in order — including the supervisor (no early stop on `STATO: COMPLETATO`). Each agent's task instructions explicitly tell them to **inspect workspace files** created by previous agents.
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

The orchestrator also supports `PARALLELO` blocks for independent subtasks executed concurrently via `Promise.all`.

### Conference Debate (`/call`)

Start a multi-voice discussion on any topic:

```powershell
/call @laan, @deanna_troi and @geordi   # Mention participants directly
/call                                    # Interactive multiselect checklist
```

Participants take turns reading previous responses. The full transcript is injected into the main chat history.

### Collaborative Teams (`/team`)

Lets an organized group of agents actively collaborate on a task, executing write and run tools:

```powershell
/team cyber_audit                        # Select a team
# Then: "Harden port 22 on this server"
```

- **Iterative rounds**: the team works in rounds (default max 3, configurable via `teamMaxRounds` in `tsuka.config.json`) until the task is actually solved — not just one turn per member.
- **Completion protocol**: each member must end their turn with `STATO: COMPLETATO` (task verified as solved) or `STATO: DA_CONTINUARE` (work continues). The harness detects completion deterministically and stops early.
- **Turn-based Shifts**: each member takes their work turn, inheriting the full history of messages and tools executed by colleagues.
- **Shared Physical Workspace**: members operate on the same physical folder, letting the programmer write source code and the security expert inspect and modify it on the next turn.

## 🛡 Security

### Permission Tiers

| Level | Tools | Behavior |
|-------|-------|----------|
| **SAFE** | `list_dir`, `read_file`, `grep_search`, `get_ps_info`, `web_search`, `browse_url`, `save_memory`, `recall_memory` | Executed instantly |
| **RESTRICTED** | `write_file`, `edit_file`, `delete_file`, `create_role`, `create_tool` | `[y/N/always]` prompt per action |
| **DANGEROUS** | `execute_command` | **Always** requires manual `[y/N]` — never bypassable |

### Additional Safety Measures

- **Workspace jail**: optional `workspaceRoot` in `tsuka.config.json` restricts all file operations to a specific directory
- **I/O limits**: `read_file` refuses files >5MB; `grep_search` skips files >5MB; `execute_command` output truncated to 50KB
- **Argument validation**: every tool call is validated against its JSON Schema before execution
- **Create_tool sandbox**: generated JavaScript runs through `vm` sandbox + pattern blocklist
- **Loop guard**: max 15 consecutive tool call rounds per request (`Agent.MAX_TOOL_ROUNDS`)

## 🛠 REPL Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show command guide |
| `/models` | List & select available models |
| `/use <model>` | Quickly select a model by name |
| `/benchmark [model\|all]` | Measure model capabilities → save profile |
| `/provider` | Switch between Ollama and OpenRouter |
| `/character` | Load a character preset |
| `/rename-char <name>` | Rename the active character's `aiName` |
| `/role` | Change agent role (skills/tools) |
| `/skill [name]` | Switch active skill for multi-skilled characters |
| `/trait` | Change agent personality trait |
| `/effort [level]` | Manage reasoning effort (`none`\|`low`\|`medium`\|`xhigh`\|`auto`\|`ask`) |
| `/goal <objective>` | Dynamic goal orchestrator — selects agents, assigns tasks, coordinates execution autonomously |
| `/team` | Start a collaborative team workflow |
| `/call [names]` | Start a multi-agent conference debate |
| `/search-engine` | Change search provider (DuckDuckGo / Google / Tavily) |
| `/memory` | List persistent memories |
| `/forget <id\|all>` | Delete specific memories or wipe all |
| `/context` | Show history token usage against the context budget |
| `/reset` | Reset history + security approvals |
| `/info` | Show session info (provider, model, role, trait) |
| `/clear` | Clear terminal |
| `/exit` | Quit |

## 🚀 Getting Started

### Prerequisites

```powershell
# 1. Install Ollama
#    https://ollama.com/
ollama serve

# 2. Pull a model
ollama pull qwen2.5-coder:7b
```

### Quick Start

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
/call @laan, @deanna_troi
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

**App home vs workspace** (`src/core/apphome.ts`): the app's assets — `roles/`, `traits/`,
`characters/`, `teams/`, `tools_schemas/`, `tsuka.config.json`, `.env`, shared memory and
model profiles — always live in the *installation folder* (or in `TSUKA_HOME`, if that
environment variable is set). The *workspace* is the folder you launch `tsuka` from: it's
where the agents' file tools (read/write/edit/grep) operate with relative paths. So you can
`cd` into any project and let the agents work on it, while personas, memory and config follow
the installation. After changing the source, refresh the global command with `npm run build`.
To uninstall: `npm unlink -g tsuka`.

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

Current status: **43 test suites, 200+ assertions — all green**.

## 📚 Documentation

| Resource | Description |
|----------|-------------|
| [Technical docs](docs/README.md) | Architecture, multi-agent workflows, security |
| [HISTORY.md](archive/HISTORY.md) | Full chronological changelog of all codebase interventions (archived) |
| [OPTIMIZATION_PLAN.md](archive/OPTIMIZATION_PLAN.md) | The 5-phase optimization plan (completed) |

## 🤝 Contributing

PRs are welcome! The architecture is deliberately kept simple:
- Tools live in `src/tools/impl/` — add one, add its schema, done.
- Roles, traits, characters, teams are plain JSON — extend without touching TypeScript.
- Tests go into `tests/` — see existing ones for patterns.

## 📄 License

[MIT](LICENSE) — free for educational, personal, and commercial use.