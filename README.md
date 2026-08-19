[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-native-black?logo=ollama&logoColor=white)](https://ollama.com/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-ready-FF6B35?logo=openai&logoColor=white)](https://openrouter.ai/)
[![Tests](https://img.shields.io/badge/Tests-73%20passed-brightgreen?logo=vitest&logoColor=white)](tests/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/nispa/tsuka/pulls)

<br />

<div align="center">

![TSUKA logo](assets/logo.png)

### **TypeScript Unified Kit for Agents**
*Deterministic, ultra-lightweight multi-agent CLI & full-screen TUI harness in TypeScript.*

[🇬🇧 English](README.md) · [🇮🇹 Leggi in Italiano](README-it.md) · [📚 Wiki](https://github.com/nispa/tsuka/wiki/Home)

</div>

---

**TSUKA** is a deterministic, lightweight multi-agent harness and interactive CLI/TUI written in TypeScript. It connects to local LLM engines (**Ollama**, **llama.cpp**, **Unsloth Studio**, **LM Studio**) via OpenAI-compatible endpoints (`/v1/chat/completions`) and to cloud gateways (**OpenRouter**).

> 🗡️ **The name**: 柄 (*tsuka*) is the katana's hilt — the grip where every blade mounts. Your models are the blades; TSUKA is the harness that lets you wield them.
>
> 💡 **Why TSUKA?** Most multi-agent systems are heavy, opaque, Python/Linux-centric frameworks. TSUKA brings deterministic, inspectable orchestration to **Windows (PowerShell)**, **Linux**, and **macOS** with zero boilerplate, hot-pluggable tools, persistent memory, and a rich terminal interface.

---

## ✨ Highlights

| Feature | Description |
|---|---|
| 🖥️ **Full-Screen TUI** | Dual-mode dashboard (`tsuka --tui`): differential rendering, SGR 1006 mouse support, live tool filtering. |
| 📡 **Real-Time Telemetry** | Live `PREFILL`, `DECODE` (tok/s), **TTFT**, and candidate logits — no blind waiting. |
| 👥 **Multi-Agent Orchestration** | Autonomous goal planning (`/goal`), teams (`/team`), and conference debates (`/call`). |
| 🔁 **Verify → Correct Loop** | Objective acceptance gates drive automated retries with anti-stall detection. |
| 🧩 **Hot-Plug Auto-Discovery** | Drop a `.ts` file into `src/tools/impl/` to auto-register native tools at boot. |
| 🛠️ **Self-Authoring Tools** | Agents can author, sandbox-test (`node:vm`), and hot-register new JavaScript tools. |
| 📊 **Capability Fingerprinting** | `/benchmark` measures real tool-calling precision across 5 JSON test suites. |
| 🧠 **Persistent Shared Memory** | Keyword-scored associative memory (`memory.json`) shared across agents and sessions. |
| 🛡️ **3-Tier Permission Model** | `SAFE` / `RESTRICTED` / `DANGEROUS` classification, workspace jail, static code audit. |

---

## ⚡ Quickstart

```bash
git clone https://github.com/nispa/tsuka.git
cd tsuka
npm install
npm run build
npm link                 # Exposes the global `tsuka` command

tsuka init --preset core # Initialize workspace with the core agent roster
npm run tui              # Full-screen TUI (or: tsuka --tui)
# Or standard CLI REPL:
tsuka
```

> [!TIP]
> Ensure a local backend is running (`ollama serve`, `llama-server`, Unsloth Studio) or set `OPENROUTER_API_KEY` in `.env`.

---

## 🚀 Install & Setup

```powershell
# Option A: Ollama
ollama serve && ollama pull qwen2.5-coder:7b
# Option B: llama.cpp
llama-server -m models/qwen2.5-coder-7b.gguf --port 8080
# Option C: OpenRouter
echo "OPENROUTER_API_KEY=your_key_here" >> .env
```

```powershell
npm run build
npm link               # Registers `tsuka` globally
tsuka --tui            # Launch full-screen TUI anywhere
```

Initialize isolated workspaces with tailored rosters:

```powershell
tsuka init                         # Interactive wizard
tsuka init --preset core           # Core roster (14 characters, 4 teams)
tsuka init --preset full           # Full roster (24 characters, 21 roles, 10 teams)
tsuka init --pack osint,devops     # Add domain packs
```

---

## 👥 Multi-Agent Workflows

- **`/goal`** — Dynamically plans, decomposes, and orchestrates a multi-agent pipeline from all characters, with `PARALLELO` blocks and supervisor verification.
- **`/team`** — Pre-configured teams (`teams/*.json`) in `round-robin`, `pipeline`, `orchestrated`, or `hybrid` modes.
- **`/call`** — Structured round-table debates across multiple agents.

Coordination uses deterministic protocol tools (`report_status`, `route_next`, `cast_vote`) with a regex text fallback and a per-run ephemeral blackboard (`AsyncLocalStorage`).

> 📚 Full specs: [Multi-Agent Guide](https://github.com/nispa/tsuka/wiki/Multi-Agent-Workflows)

---

## 🧰 Tools, Security & Benchmarks

TSUKA ships **30 native tools** (`src/tools/impl/*.ts`) with OpenAI-compatible JSON schemas. Tools fall into Filesystem, System, Web/Network, Memory, Coordination, Agent Extension, Escalation, and SAST (`audit_code`) categories.

- **Security**: 3-tier permission model, workspace jail via `resolveSafePath()`, serialized prompt queue, credential masking.
- **Benchmarks**: `/benchmark` runs 5 suites measuring instruction-following, JSON compliance, and tool precision, driving dynamic tier gating (`SMALL` / `MEDIUM` / `LARGE`).

> 📚 Details: [Security Specification](https://github.com/nispa/tsuka/wiki/Security) · [Architecture Deep Dive](https://github.com/nispa/tsuka/wiki/Architecture)

---

## 🛠️ REPL Slash Commands

| Command | Description |
|---|---|
| `/goal <objective>` | Autonomous goal orchestrator. |
| `/team [name] ["task"]` | Collaborative multi-agent pipeline. |
| `/call [@a, @b] ["topic"]` | Multi-agent conference debate. |
| `/models [id]` `/provider [p]` `/effort [e]` | Switch model, provider, or reasoning budget. |
| `/benchmark [model\|all]` | Capability fingerprinting. |
| `/agent [name]` `/tools [filter]` | Inspect or switch persona / tools. |
| `/export [path]` | Export conversation & tool traces to Markdown. |
| `/memory [clear\|id]` `/blackboard` `/runs` | Persistent memory & workflow reports. |
| `/stop` `/continue` `/reset` `/help` `/exit` | Session control. |

---

## 🏗️ Architecture

```text
CLI REPL (src/cli/)  ◄──►  TUI (src/tui/)
            └───────────┬───────────┘
                        ▼
            Agent ReAct Loop (src/core/agent.ts)
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
  LLM Provider    Tool Registry   Permission Manager
  (OpenAI API)   (Hot Auto-Scan)  (3-Tier Safety)
```

Personas are orthogonal: **Character = Role × Trait**. See [Architecture Deep Dive](https://github.com/nispa/tsuka/wiki/Architecture).

---

## 🧪 Testing

73 automated test suites with 1,300+ assertions, run hermetically via `MockLLMProvider` and isolated temp stores:

```powershell
npm test
npx tsx tests/test_goal_orchestrator.ts   # single suite
```

---

## 📚 Documentation & Wiki

| Guide | Description |
|---|---|
| [Documentation Portal](https://github.com/nispa/tsuka/wiki/Home) | Central overview. |
| [Architecture Deep Dive](https://github.com/nispa/tsuka/wiki/Architecture) | Prompt assembly, ReAct loops, token budgeting. |
| [Multi-Agent Guide](https://github.com/nispa/tsuka/wiki/Multi-Agent-Workflows) | `/goal`, `/team`, `/call` specs. |
| [Security Specification](https://github.com/nispa/tsuka/wiki/Security) | Permission tiers, jail, AST auditing. |
| [Use Cases & Recipes](https://github.com/nispa/tsuka/wiki/Use-Cases) | Practical recipes. |
| [Educational Guide](https://github.com/nispa/tsuka/wiki/Educational-Guide) | Build an agent harness from scratch. |

> The [GitHub Wiki](https://github.com/nispa/tsuka/wiki) is compiled from these files via `npm run wiki:build`.

---

## 🗺️ Roadmap & Contributing

- [x] Full-screen zero-flicker TUI (v0.5.1)
- [x] Live prefill/decode telemetry
- [x] Empirical capability fingerprinting
- [ ] Streaming for sandboxed custom tools
- [ ] Web-based trace graph inspector
- [ ] Extended LSP tool integration

**Contributing**: add a tool (`src/tools/impl/*.ts` + `tools_schemas/*.json`) or a persona JSON (`characters/`, `roles/`, `traits/`, `teams/`). Ensure all 73 test suites pass (`npm test`).

---

## 📄 License

MIT — free for educational, personal, and commercial use.
