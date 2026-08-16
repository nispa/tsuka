# Educational Guide — How to Build an Agentic Harness 🎓

<div align="right">
  <p>Leggi in <a href="guida-didattica.md">🇮🇹 Italiano</a></p>
</div>

> This guide explains the architectural principles and implementation details needed to build a modern multi-agent harness like **TSUKA**. It covers both **universal components** (found in tools like Claude Code, OpenCode, or Aider) and **specific design choices** made in this project, highlighting practical traps encountered during development.
>
> 💡 **How to read this guide**: The 10 milestones in [§2](#2-the-10-step-construction-path) are ordered by increasing complexity: each module is self-contained and serves as the foundation for the next. If you are building your own harness, follow them in sequence; if you want to understand TSUKA's architecture, jump directly to the topic of interest.

---

## 1. What is an Agentic Harness?

A Large Language Model (LLM) on its own is a pure function: text in $\to$ text out. It cannot directly read files, run terminal commands, or preserve persistent state across restarts.

An **agentic harness** is the application that wraps the model, providing it with observation capabilities, execution powers, and persistent memory:

```
┌─────────────────────────── HARNESS ───────────────────────────┐
│                                                               │
│   REPL ──► Agentic Loop ──► LLM Provider (HTTP Streaming)     │
│    ▲             │                                            │
│    │             ▼                                            │
│   UI  ◄── Tool Registry ──► Permissions ──► Execution (fs, sh)│
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

The fundamental insight behind every harness:

> **The language model never executes actions directly.**  
> The model *declares its intent* to call tools (*tool calling*). The harness intercepts and validates the request, executes the action in a controlled environment, gathers the output, and injects it back into history as a new message.

Intelligence belongs to the model; execution authority and safety belong entirely to the harness. This is why permission governance (Milestone 4) lives inside the harness: it is the only place capable of intercepting and validating actions before execution on the OS.

### Core Concepts

| Term | Definition |
|---|---|
| **Tool** | A native utility or system function the model can request to execute (e.g. file reading, web search, shell execution). |
| **Tool Call** | A structured payload (typically JSON) emitted by the model specifying the tool name and argument dictionary. |
| **History** | The ordered sequence of conversation messages (user, assistant, tool) sent to the LLM on each request to maintain operational context. |
| **Context Window** | The maximum token limit the model can process in a single request. The most critical and constrained resource. |
| **Character / Agent** | In TSUKA **every Character is an Agent**: a declarative JSON configuration combining operational capabilities (*Role*) and communication style (*Trait*). |

---

## 2. The 10-Step Construction Path

```
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │  1. REPL &   │ ──►  │ 2. Agentic   │ ──►  │ 3. Tool      │
  │   Streaming  │      │    Loop      │      │   Registry   │
  └──────────────┘      └──────────────┘      └──────────────┘
                                                     │
  ┌──────────────┐      ┌──────────────┐             │
  │ 6. Live ANSI │ ◄──  │ 5. Context   │ ◄──  ┌──────▼───────┐
  │  & Repaint   │      │   Budgeting  │      │ 4. Permission│
  └──────────────┘      └──────────────┘      │    System    │
         │                                    └──────────────┘
         ▼
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │ 7. Multi-    │ ──►  │ 8. Model     │ ──►  │ 9. Tool Self-│ ──► 10. Packaging &
  │    Agent     │      │   Tiers      │      │   Authoring  │     Distribution
  └──────────────┘      └──────────────┘      └──────────────┘
```

---

### Milestone 1 — REPL Chat & Real-Time Streaming

*Code references: `src/core/provider.ts`, `src/cli/index.ts`, `src/cli/input.ts`*

Start with a clean interactive read-eval-print loop that captures user input and forwards it to an **OpenAI-compatible** endpoint (`/v1/chat/completions`).

Standardizing on OpenAI API compatibility is a massive architectural win: local inference engines like Ollama, llama-server (`llama.cpp`), Unsloth Studio, vLLM, and cloud gateways like OpenRouter all speak this exact protocol. A single `LLMProvider` class covers all backends.

Streaming responses via Server-Sent Events (SSE) is crucial for usability: without it, users stare at a frozen cursor for tens of seconds during long generation cycles.

---

### Milestone 2 — The Agentic Loop (Function Calling)

*Code references: `src/core/agent.ts`*

The execution core follows the **ReAct** (*Reason + Act*) pattern across four sequential steps:

1. **Context Dispatch**: send conversation history and available tool definitions to the LLM.
2. **Output Evaluation**: if the response contains `tool_calls`, suspend text output and execute the requested tools.
3. **Result Injection**: append tool outputs to the conversation history as messages with `role: "tool"`.
4. **Recursive Turn**: re-invoke the model with the enriched history until it returns a plain text response.

```
                  ┌──────────────────────┐
                  │ User Input / Prompt  │
                  └──────────┬───────────┘
                             │
            ┌────────────────▼────────────────┐
            │   Send History + Tool Schemas   │◄─────────────┐
            └────────────────┬────────────────┘              │
                             │                               │
                             ▼                               │
                   [ Model Evaluation ]                      │
                             │                               │
              Emitted        │                               │
              tool calls?    ├───────── No ──────────┐       │
                             │                       │       │
                            Yes                      ▼       │
                             │                 ┌───────────┐ │
                             ▼                 │   Final   │ │
                    ┌─────────────────┐        │ Response  │ │
                    │  Execute Tools  │        └─────┬─────┘ │
                    │ (Sandbox & FS)  │              │       │
                    └────────┬────────┘              │       │
                             │                       │       │
                             ▼                       │       │
                    ┌─────────────────┐              │       │
                    │ Append results  │              │       │
                    │ with role: tool │──────────────┘       │
                    └────────┬────────┘                      │
                             └───────────────────────────────┘
```

#### Critical Safeguards from Day One:
* **Round Ceiling (`MAX_TOOL_ROUNDS`)**: compact models can fall into infinite tool-calling loops. Enforce a strict safeguard (TSUKA defaults to 15 rounds in `Agent.DEFAULT_MAX_TOOL_ROUNDS`, configurable via `maxToolRounds`).
* **History Integrity**: providers reject payloads where `tool_call` entries lack matching `tool` response messages. Any history pruning must strictly preserve these pairs.

---

### Milestone 3 — Tool Registry & Declarative Schemas

*Code references: `src/tools/registry.ts`, `src/tools/index.ts`, `tools_schemas/*.json`*

Tools expand faster than any other subsystem. Treat them as **modular plugins**:
* **TypeScript Implementation**: each file in `src/tools/impl/` exports the execution logic and is dynamically imported at launch.
* **JSON Schema Specifications**: tool descriptions and parameter validations live in standalone JSON files under `tools_schemas/`.

```
src/tools/impl/read_file.ts  ──► Execution Logic (TypeScript)
tools_schemas/read_file.json ──► Description & Parameters (JSON Schema)
```

Separating code from schemas enables rapid prompt engineering: refining tool descriptions to guide model routing does not require recompiling application code.

---

### Milestone 4 — Permission Manager: User-in-the-Loop

*Code references: `src/safety/permissions.ts`*

To protect the host system, every tool declares an explicit risk level:

| Level | Operational Behavior | Examples |
|---|---|---|
| `SAFE` | Executed immediately without interruption. | `read_file`, `list_dir`, `web_search` |
| `RESTRICTED` | Prompts user for approval (`[y/N/always]`). | `write_file`, `delete_file`, `edit_file` |
| `DANGEROUS` | **Always prompts** per action; bypass disabled. | `execute_command` |

Three complementary defense layers:
1. **Workspace Sandboxing**: restricts filesystem operations to `workspaceRoot`.
2. **I/O Bounds**: caps file reading to 5 MB and command outputs to 50 KB.
3. **Credential Redaction**: filters sensitive environment variables (`KEY|SECRET|TOKEN|PASSWORD`) before prompt injection.

---

### Milestone 5 — Context Window Management

*Code references: `src/core/agent.ts`, `src/core/thinkParser.ts`, `src/core/memory.ts`*

The context window is your scarcest computational resource. TSUKA manages it via four mechanisms:

1. **Token-Driven Pruning (`pruneHistory`)**: cuts history based on actual token limits (`maxHistoryTokens`) rather than message counts, with dynamic runtime calibration against `usage.prompt_tokens`.
2. **Reasoning Isolation**: extracts `<think>` reasoning chunks for live display but strips them from persistent history to save context.
3. **Persistent Shared Memory**: structured storage (`memory/memory.json`) storing facts, conventions, and lessons across sessions with weighted OR keyword search and score-based eviction.
4. **Resumable Traces (`/continue`)**: long reasoning paths are persisted to `memory/thinking/*.md`, allowing explicit resumption of interrupted tasks.

---

### Milestone 6 — UI: Live Streaming & ANSI Repaint

*Code references: `src/cli/stream.ts`, `src/cli/markdown.ts`, `src/cli/interrupt.ts`*

To maintain high performance without bulky TUI frameworks:
1. Stream raw chunks directly to the terminal as they arrive.
2. On completion, erase the stream region via ANSI sequences (`\x1b[nF\x1b[0J`).
3. Repaint the final output as beautifully formatted Markdown with syntax highlighting.
4. Raw keyboard mode captures `Esc` or `Ctrl+X` to abort turns instantly via `AbortController`.

---

### Milestone 7 — Multi-Agent Collaboration

*Code references: `roles/`, `traits/`, `characters/`, `teams/`, `src/cli/commands/`*

#### 7.1 The Fundamental Equation: Character = Agent
In TSUKA, agents are entirely declarative:
```
ROLE (roles/)  ×  TRAIT (traits/)  =  CHARACTER / AGENT (e.g. @geordi, @worf, @pike)
```
* **Role**: technical skills and allowed tools.
* **Trait**: tone and communication style.
* **Character**: named agent preset linking role and trait.

#### 7.2 Collaboration Strategies (`/team`)
* **`orchestrated` (recommended)**: a supervisor dynamically assigns each turn via `route_next`.
* **`round-robin`**: cyclical turn-taking across team members.
* **`pipeline`**: assembly line with objective acceptance loops (`src/core/loop.ts`).
* **`hybrid`**: periodic discussion and voting rounds (`cast_vote`).

#### 7.3 Goal Orchestrator (`/goal`)
Dynamically plans, recruits agents from all 24 characters, and executes objectives with concurrent `PARALLELO` blocks isolated via `AsyncLocalStorage` and conflict-aware filesystem merges.

---

### Milestone 8 — Model Tiering & Capability Fingerprinting

*Code references: `src/core/modelProfile.ts`, `src/tools/registry.ts`*

Local models range from 1B to 70B parameters. Instead of guessing capabilities from model filenames, TSUKA runs objective benchmarks (`/benchmark`):
* Tests instruction following, JSON generation, and function calling.
* Assigns an empirical tier (`SMALL`, `MEDIUM`, `LARGE`).
* Filters tools by combining **Active Role $\times$ Measured Model Tier**.

---

### Milestone 9 — Tool Self-Authoring (`create_tool`)

*Code references: `src/tools/impl/createTool.ts`*

Agents can dynamically author new JavaScript/TypeScript tools at runtime:
* Validated inside a `node:vm` sandbox with pattern blocklists.
* Restricted to `SAFE` or `RESTRICTED` risk levels (never `DANGEROUS`).
* Hot-registered for immediate session use with automatic backups.

---

### Milestone 10 — Packaging & Configuration Hierarchy

*Code references: `src/core/apphome.ts`*

TSUKA resolves configurations hierarchically:
1. **Local Project (`.tsuka/`)**: configurations initialized via `tsuka init` override global defaults.
2. **Global App Home (`appHome`)**: fallback to system-wide characters, teams, and settings.

---

## 3. Architecture Summary: Universal vs. TSUKA-Specific

| Feature | Universal Pattern | TSUKA Distinctive Implementation |
|---|---|---|
| **Agentic Loop** | ReAct function calling | Token-budgeted pruning with dynamic server window discovery |
| **Tool System** | JSON Schema definitions | Adaptive Tier Pruning based on `/benchmark` capability fingerprinting |
| **Multi-Agent** | Fixed prompt chaining | Dynamic Goal Orchestrator + 4 Team Strategies + Run Blackboard |
| **Verification** | Self-reported completion | Objective acceptance criteria (`loop.ts`) with anti-stall signatures |
| **Safety** | User prompts | 3-tier risk system + serialized async permission queues + workspace jail |

---

## 4. Ten Real-World Engineering Traps

1. **String Replacement Metacharacters**: `String.prototype.replace` interprets `$&` in replacement strings; always use `() => replacement` functions in file-editing tools.
2. **CJS / ESM Dynamic Imports**: transpiled dynamic `import()` behaves differently between `tsx` dev mode and compiled dist builds. Test both!
3. **Token Streaming Measurement**: counting raw stream chunks produces erratic metrics; enable `stream_options: { include_usage: true }`.
4. **Index Shifts During Pruning**: slicing history by numerical indices breaks when pruning occurs mid-run; always track message object identities.
5. **HTML Entities in Terminal Rendering**: Markdown parsers convert quotes into HTML entities (`&#39;`); decode them before ANSI terminal output.
6. **Accidental Credential Leaks**: system diagnostic tools can inadvertently leak environment variables; apply proactive redaction masks.
7. **Hidden Local Server Queues**: a local model that appears frozen is often waiting in a single-slot inference queue. Always provide visual status and timeouts.
8. **Oversized Tool Arguments**: passing entire files inline breaks small model JSON generation. Design tools to support chunking or file paths.
9. **History Poisoning from Malformed JSON**: never save raw invalid JSON tool calls to history; sanitize and repair them before persisting.
10. **Test Suite Memory Isolation**: automated tests must never write to the real user `memory.json`. Always redirect test stores to temporary test environments.

---

*For detailed architectural specifications, consult the [System Architecture](architecture.md) and [Multi-Agent Workflows](multi-agent.md).*
