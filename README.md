[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-native-black?logo=ollama&logoColor=white)](https://ollama.com/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-ready-FF6B35?logo=openai&logoColor=white)](https://openrouter.ai/)
[![Tests](https://img.shields.io/badge/Tests-74%20passed-brightgreen?logo=vitest&logoColor=white)](tests/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/nispa/tsuka/pulls)

<br />

<div align="center">

![TSUKA logo](assets/logo.png)

### **TypeScript Unified Kit for Agents**
*Deterministic, transparent multi-agent CLI & full-screen TUI harness in TypeScript.*

[🇬🇧 English](README.md) · [🇮🇹 Leggi in Italiano](README-it.md) · [📚 Educational Wiki](docs/README.md)

</div>

---

**TSUKA** is a deterministic, educational, and ultra-lightweight multi-agent harness written in pure TypeScript. It orchestrates local LLM backends (**Ollama**, **llama.cpp**, **Unsloth Studio**, **LM Studio**) and cloud gateways (**OpenRouter**) via an OpenAI-compatible interface (`/v1/chat/completions`).

> 🗡️ **The name**: 柄 (*tsuka*) is the katana's hilt — the solid grip where every blade mounts. Your models are the interchangeable blades; TSUKA is the harness that gives you deterministic control over their execution.
>
> 🎓 **Why TSUKA?** Most multi-agent frameworks are heavy, opaque, Python-dependent "black boxes". TSUKA is designed as a **transparent, pedagogical laboratory**: zero magic, zero external vector DB dependencies, 100% deterministic control code, and first-class native execution across **Windows (PowerShell)**, **Linux**, and **macOS**.

---

## ✨ Core Architectural Highlights

| Pillar | Architectural Design & Value |
|---|---|
| 🎯 **Pure Determinism & Zero Magic** | The LLM only reasons and proposes tool calls; the harness strictly owns state, execution, loop ceilings (max 15 rounds), and permissions. |
| 🪟 **True Cross-Platform Native** | First-class Windows support (PowerShell without WSL or Python required), macOS, and Linux out of the box. |
| 🖥️ **Full-Screen Interactive TUI** | Double-buffered zero-flicker terminal dashboard (`tsuka --tui`) with SGR 1006 mouse support, tabs, and workspace file explorer. |
| 🧠 **Zero-Dependency Persistent Memory** | BM25 keyword search, morphological stemming, write-time deduplication, and exponential half-life decay in pure TypeScript (`memory.json`). |
| 🧩 **Dynamic Tool Auto-Discovery** | Drop any `.ts` tool into `src/tools/impl/` to hot-register it at boot with automatic JSON Schema validation. |
| 🛠️ **Sandboxed Self-Authoring Tools** | Agents can write, sandbox-test (`node:vm`), and hot-load new tools during runtime to solve unanticipated problems. |
| 👥 **Multi-Agent Orchestration** | Dynamic goal planning (`/goal`), parallel staging sandboxes (`PARALLELO`), preconfigured teams (`/team`), and conference debates (`/call`). |
| 📊 **Capability Fingerprinting** | Empirical test runner (`/benchmark`) measures small-model tool-calling accuracy to dynamically tailor active tool sets. |
| 🛡️ **3-Tier Permission Safety** | Strict workspace jail (`resolveSafePath`), serialized interactive prompts, credential masking, and defensive static code analysis. |

---

## ⚡ Quickstart

```bash
git clone https://github.com/nispa/tsuka.git
cd tsuka
npm install
npm run build
npm link                 # Exposes the global `tsuka` command

tsuka init --preset core # Initialize workspace with the core agent roster
npm run tui              # Launch full-screen TUI (or: tsuka --tui)
# Or standard CLI REPL:
tsuka
```

> [!TIP]
> Ensure a local backend is running (`ollama serve`, `llama-server`, Unsloth Studio) or set `OPENROUTER_API_KEY` in `.env`.

---

## 🚀 Install & Setup

```powershell
# Option A: Ollama (Recommended for local 7B–14B models)
ollama serve && ollama pull qwen2.5-coder:7b

# Option B: llama.cpp
llama-server -m models/qwen2.5-coder-7b.gguf --port 8080

# Option C: OpenRouter (Cloud)
echo "OPENROUTER_API_KEY=your_key_here" >> .env
```

```powershell
npm run build
npm link               # Registers `tsuka` globally
tsuka --tui            # Launch full-screen TUI anywhere
```

Initialize isolated workspaces with tailored rosters:

```powershell
tsuka init                         # Interactive setup wizard
tsuka init --preset core           # Core roster (14 characters, 4 teams)
tsuka init --preset full           # Full roster (24 characters, 21 roles, 10 teams)
tsuka init --pack osint,devops     # Add domain packs
```

---

## 👥 Multi-Agent Workflows

- **`/goal <objective>`** — Dynamically decomposes complex objectives into multi-agent pipelines with isolated parallel execution blocks and supervisor verification.
- **`/team [name] ["task"]`** — Pre-configured teams (`teams/*.json`) across 4 execution modes (`round-robin`, `pipeline`, `orchestrated`, `hybrid`).
- **`/call [@a, @b] ["topic"]`** — Structured round-table conference debate between multiple specialized personas.

Coordination relies on deterministic protocol tools (`report_status`, `route_next`, `cast_vote`) backed by an isolated session scratchpad (`AsyncLocalStorage`).

> 📚 Full documentation: [Multi-Agent Guide](docs/multi-agent.md)

---

## 🧰 Native Tools & Security

TSUKA ships with **30 native tools** (`src/tools/impl/*.ts`) categorized into:
* **Filesystem**: `read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `grep_search` (strictly confined to workspace jail).
* **System**: `execute_command` (cross-platform shell execution with interactive approval).
* **Memory**: `save_memory`, `recall_memory`, `update_memory`, `forget_memory` (BM25 + half-life retention).
* **Coordination**: `post_note`, `read_notes`, `report_status`, `route_next`, `cast_vote`.
* **Extension & SAST**: `create_tool` (sandboxed in `node:vm`), `audit_code` (static security analyzer for CWEs).

> 📚 Full documentation: [Security Specification](docs/security.md) · [Architecture Guide](docs/architecture.md)

---

## 🛠️ REPL Slash Commands

| Command | Description |
|---|---|
| `/goal <objective>` | Autonomous multi-agent goal orchestrator. |
| `/team [name] ["task"]` | Collaborative multi-agent team pipeline. |
| `/call [@a, @b] ["topic"]` | Multi-agent round-table conference debate. |
| `/models [id]` `/provider [p]` | Switch active model or backend provider. |
| `/benchmark [model|all]` | Capability fingerprinting for tool calling. |
| `/agent [name]` `/tools [filter]` | Inspect or switch persona / active tools. |
| `/export [path]` | Export conversation & tool execution trace to Markdown. |
| `/memory [clear|id]` `/blackboard` | Persistent memory & workflow scratchpad inspector. |
| `/stop` `/continue` `/reset` `/help` `/exit` | Session and execution lifecycle control. |

---

## 📚 Educational Wiki & Architecture

TSUKA was built as an open, educational instrument to learn how agentic harnesses work by confronting real-world engineering challenges:

* 🧠 [**Persistent Memory System**](docs/memory.md) — The 3 state tiers, the memory ladder, BM25 scoring, and half-life eviction.
* 🏛️ [**System Architecture**](docs/architecture.md) — ReAct loop, context budgeting, and event-driven decoupling.
* 🎓 [**Educational Guide: Build an Harness**](docs/educational-guide.md) — 10 milestones to build an agent harness from scratch and the 10 real-world traps.
* 👥 [**Multi-Agent Workflows**](docs/multi-agent.md) — Team coordination, protocol tools, and parallel staging.
* 📊 [**Capability Fingerprinting**](docs/benchmark.md) — Measuring small model reliability on function calling.
* 🛡️ [**Security & Permissions**](docs/security.md) — Workspace jailing, risk tiers, and sandboxing.

---

## 📜 License

MIT © [TSUKA Contributors](LICENSE)
