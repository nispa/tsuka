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

The `Agent` facade coordinates the loop without owning every invariant itself:
conversation history, tool rounds, token calibration, ReAct state, and reasoning-trace
persistence live in focused modules (`conversationHistory.ts`, `toolRound.ts`,
`tokenCalibration.ts`, `reactState.ts`, `reasoningTrace.ts`). The public contract stays
stable while each responsibility remains independently testable.

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

### Milestone 4 — Permissions and Confinement

*Code references: `src/safety/permissions.ts`, `src/tools/impl/utils.ts` (`resolveSafePath`), `src/core/network.ts`, `src/core/subagentRunner.ts`, `src/tools/customToolRunner.ts`*

An agent acts on the world through tools, so safety asks two questions that are worth keeping apart: **who decides whether an action may start** (permissions) and **how far an action can reach once it runs** (confinement).

#### 4.1 Permissions: the user in the loop

Every tool declares a risk level:

| Level | Operational Behavior | Examples |
|---|---|---|
| `SAFE` | Executed immediately without interruption. | `read_file`, `list_dir`, `web_search` |
| `RESTRICTED` | Prompts user for approval (`[y/N/always]`). `delete_file` always prompts; `write_file`/`edit_file` can also be authorized via `/sudo on`. | `write_file`, `delete_file`, `edit_file` |
| `DANGEROUS` | Prompts per action by default. `execute_command` can be explicitly authorized for the current session with user-operated `/sudo on`. | `execute_command` |

The level can depend on the arguments: `execute_command` classifies the requested command (a harmless read weighs less than a composition of commands). Tools generated by the model cannot lower their own level: they are always `DANGEROUS`.

`/sudo` is deliberately a session control rather than an agent tool: it cannot be enabled by a model. It exposes `execute_command`, `write_file`, and `edit_file` across role and capability-tier filters and bypasses their prompts within the workspace jail; it does not elevate OS privileges, grant access to other tools, or bypass `delete_file` prompts. `/sudo off`, `/reset`, and a new runtime revoke the control.

#### 4.2 Confinement: a map of the boundaries

A confirmation says *whether* an action starts, not *where* it lands. TSUKA therefore pairs permissions with a set of boundaries, each aimed at one specific risk. The most useful thing to learn is to read them together, column by column: what each one protects and **where it stops protecting**.

| Boundary | Protects against | How | Where it does not reach |
|---|---|---|---|
| **Workspace jail** | File tools leaving the project | `resolveSafePath` resolves the real path (`realpath`, so symlinks too) and rejects anything outside `workspaceRoot` | Applies to native file tools, not to a shell command or an MCP server |
| **Network policy** (`safeFetch`) | Requests into the internal network (SSRF), including via redirects or DNS rebinding | HTTP(S) on standard ports only; every resolved address must be public, checked on the same DNS answer the socket uses, at every redirect | Applies to `browse_url`, `download_file`, `web_search`, not to the shell |
| **Sub-agent perimeter** | A child gaining tools its parent does not have | Both automatic delegation and `spawn_agent` hand the child the parent's tool perimeter: the child may pick another role but gains no tool | Memory and blackboard tools, which the runner gives every child, always stay available |
| **Separate process for generated tools** | Model-written code running inside TSUKA | Node child under the permission model: workspace-only files, no network or child processes, empty environment, time/memory/output limits (see Milestone 9.1) | Node's permission model is not designed against deliberately malicious code |
| **Parallel block staging** | Two agents writing the same file at once | Each branch writes to its own folder; the merge reports conflicts instead of overwriting | Data consistency, not security |
| **I/O bounds** | Flooding TSUKA's memory or the model's context | Caps on reads, command output and downloads; truncation with pagination | They limit how much is read, not what |
| **Credential-free environment** | A command or MCP server reading TSUKA's API keys | Child processes start without credential-named variables (`childEnv.ts`); exceptions must be declared (`commandEnvPassthrough`, an MCP server's `env`); generated tools get an empty environment | It cleans the environment, not the disk: a command can still read a `.env` in the workspace, and tool results are not filtered (T24.2) |

The same actors keep returning in the right-hand column: **the shell and MCP servers**. That is not an accident. A shell command or an external server is a program with the permissions of the process that starts it; no check on the command's text turns it into a sandbox. You can take away what it does not need (credentials from its environment), not limit what it does with what remains. That is why `execute_command` stays `DANGEROUS`, MCP servers start as `RESTRICTED` unless configured otherwise, and `/sudo` is an explicit user choice.

#### 4.3 A check is not a boundary

The whole milestone comes down to one distinction that holds for any harness:

* a **check** inspects an action before it runs (a forbidden pattern, a validated path, a DNS answer resolved in advance) and can be bypassed by whatever it did not foresee: a path spelled differently, a DNS server changing its answer between the check and the connection, `fs['read' + 'FileSync']` instead of `readFileSync`;
* a **boundary** removes the capability itself: a process without network permission cannot open a socket, however the code is written.

Several TSUKA changes are exactly the move from the first to the second: the jail went from comparing strings to the real path, the network policy from DNS resolved in advance to the DNS the socket uses, generated tools from `node:vm` and a blocklist to a separate process. When not even a boundary is enough, as with the shell, the honest answer is to say so and leave the decision to the user.

---

### Milestone 5 — Context Window Management

*Code references: `src/core/agent.ts`, `src/core/thinkParser.ts`, `src/core/memory.ts`*

The context window is your scarcest computational resource. TSUKA manages it via four mechanisms:

1. **Token-Driven Pruning (`pruneHistory`)**: cuts history based on actual token limits (`maxHistoryTokens`) rather than message counts, with dynamic runtime calibration against `usage.prompt_tokens`.
2. **Reasoning Isolation**: extracts `<think>` reasoning chunks for live display but strips them from persistent history to save context.
3. **Persistent Shared Memory**: structured storage (`memory/memory.json`) storing facts, conventions, and lessons across sessions with weighted OR keyword search and score-based eviction.
4. **Resumable Traces (`/continue`)**: long reasoning paths are persisted to `memory/thinking/*.md`, allowing explicit resumption of interrupted tasks.

---

### Milestone 6 — UI Decoupling: An Interface-Agnostic Core (CLI, TUI, Web)

*Code references: `src/core/logSink.ts`, `src/core/agent.ts` (`AgentEvents`), `src/tui/`, `src/cli/stream.ts`, `src/cli/interrupt.ts`*

#### 1. The Trap of Hardcoded `console.log`
When starting an agent harness, it is tempting to scatter `console.log` calls everywhere to monitor tools, memory, or the ReAct loop. This works for a basic terminal, but quickly becomes a dead end as the user interface evolves:
* If a tool prints directly to stdout during a turn, it breaks live text streaming.
* If you build a **full-screen interactive terminal dashboard (TUI)**, a single stray `console.log` corrupts the screen buffer.
* If you later expose the agent via a Web UI or headless background server, those logs stay trapped on the server stdout instead of reaching the user.

#### 2. The Solution: Separate the Engine from Output
A truly modular harness core (Core, Memory, Tools) **never prints directly to the terminal**. All output is routed through two decoupled channels:

1. **Conversation Channel (`AgentEvents`)**: during streaming generations, the agent emits typed events to any listening frontend (`onChunk` for incoming text chunks, `onStats` for speed and tokens, `onEvent` for tool lifecycle states).
2. **Diagnostic Channel (`logSink`)**: all internal utility modules send warnings, errors, and operational notices to an injectable sink (`logSink.log()`, `logSink.warn()`, `logSink.error()`).

```
┌────────────────────────────────────────────────────────┐
│                  CORE AGENTIC ENGINE                   │
│        (Zero console.log — pure reusable logic)        │
└──────────────┬───────────────────────────┬─────────────┘
               │ Streaming events          │ Logs & warnings
               ▼ (AgentEvents)             ▼ (logSink)
       ┌────────────────────────┐  ┌─────────────────────┐
       │      TUI Dashboard     │  │       CLI REPL      │
       │    Full-screen app     │  │   Classic terminal  │
       │    (npm run tui)       │  │   interface         │
       └────────────────────────┘  └─────────────────────┘
```

The same boundary applies to authorization requests: `PermissionManager` decides
whether a request is allowed and serializes concurrent prompts, but it knows nothing
about menus or terminals. CLI and TUI inject a `PermissionPromptHandler`; in a
headless context without a renderer, non-`SAFE` operations are denied by default.
Workflow escalation tools similarly request execution through the
`WorkflowDispatcher` contract instead of importing command handlers from a specific UI.

#### 3. Practical Payoff: CLI to TUI with Zero Core Rewrites
Thanks to this decoupling, TSUKA powers two completely different interfaces using the exact same underlying engine:
* **Full-Screen TUI (`src/tui/`)**: subscribes to `AgentEvents` to update the chat feed, `<think>` reasoning containers, file explorer, and live telemetry, while routing `logSink` diagnostics into pop-up notification modals.
* **Classic CLI (`src/cli/`)**: receives the same events to display continuous token streams and repaints syntax-highlighted Markdown on completion.

In both interfaces, pressing `Esc` or `Ctrl+X` aborts generation immediately via an `AbortController` signal, preserving the conversation state without killing the process.

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
Dynamically plans, recruits agents from all 24 characters, and executes objectives with concurrent `PARALLEL` blocks isolated via `AsyncLocalStorage` and conflict-aware filesystem merges.

---

### Milestone 8 — Model Tiering & Capability Fingerprinting

*Code references: `src/core/modelProfile.ts`, `src/tools/registry.ts`*

Local models range from 1B to 70B parameters. Instead of guessing capabilities from model filenames, TSUKA runs objective benchmarks (`/benchmark`):
* Tests instruction following, JSON generation, and function calling.
* Assigns an empirical tier (`SMALL`, `MEDIUM`, `LARGE`).
* Filters tools by combining **Active Role $\times$ Measured Model Tier**.

---

### Milestone 9 — Extensibility: Out-of-Process Dynamic Tools & MCP Ecosystem

*Code references: `src/tools/impl/createTool.ts`, `src/tools/customToolRunner.ts`, `src/core/mcp/` (`types.ts`, `stdioTransport.ts`, `client.ts`, `adapter.ts`, `connectMcpServers.ts`)*

A mature agent harness cannot remain confined to its initial static tool set. TSUKA supports two complementary extension pathways:

#### 9.1 Internal Extensibility: Dynamic Runtime Tool Creation (`create_tool`)
With `selfAuthoringEnabled: true`, an agent holding `create_tool` can write a new JavaScript tool, describe its arguments with JSON Schema and use it in the same session. The capability is disabled by default, and it is the clearest example in the project of a question every agent harness eventually faces: **where does code written by the model run?**

**The problem.** A generated tool is code nobody has reviewed yet, written by a model that may have read a hostile web page a few turns earlier. Loaded with `require()`, it would run *inside* TSUKA, with everything TSUKA has: the whole disk, the network, the API keys in the environment, the ability to launch processes. An earlier version validated modules with `node:vm` and a blocklist of forbidden patterns; an external audit pointed out that neither is a security boundary. `node:vm` separates global variables, not privileges (`({}).constructor.constructor('return process')()` walks out of it), and a blocklist only sees the text it was written for (`fs['read' + 'FileSync']` does not contain `readFileSync`).

**The design: another process, fewer permissions** (`customToolRunner.ts`). Validation and every call start a fresh Node child:

```
TSUKA ──spawn──► node --permission --allow-fs-read=<workspace> --allow-fs-write=<workspace>
  │                   --disallow-code-generation-from-strings --max-old-space-size=256 -e <runner>
  │  stdin:  { source, name, args }            env: {}      cwd: <workspace>
  └◄ stdout: { ok, result }  (one JSON line; console.* goes to stderr)
```

Each choice answers a specific attack:

| Choice | What it stops |
|---|---|
| Separate process | A crash, an infinite loop or a memory blow-up ends the child, never TSUKA; a timeout kills it |
| `--permission` + `--allow-fs-*` on the workspace only | Reading or writing files elsewhere, however the path is spelled |
| No `--allow-net`, `--allow-child-process`, `--allow-worker` | Network, new processes, workers — even through `process.getBuiltinModule` |
| `--disallow-code-generation-from-strings` | `eval`, `Function` and the constructor-chain trick above |
| Empty `env` | API keys and tokens never reach generated code |
| Output cap and JSON protocol | A tool cannot flood TSUKA or inject anything but a string result |
| Refuse on Node < 25 | Older runtimes lack `--allow-net`: better not to run than to run unconfined (**fail closed**) |

The module receives `fs` and `path` as injected parameters, and a local `require` serves nothing else. Startup only *registers* modules found on disk; their code runs, confined, when called.

**The honest limit.** Node's documentation calls its permission model a *seat belt* for trusted code, not a sandbox against malicious code. Real containment would need an operating-system sandbox or a container, which differ on Windows, Linux and macOS. The project compared three options — confined process, OS sandbox, permanent disable — and chose the confined process as defense in depth, keeping the other two keys in place:
* **Opt-in**: nothing loads unless the project configuration says so;
* **Always DANGEROUS**: creation and every call need an explicit confirmation, whatever the module declares about itself;
* **Core Protection**: native tools cannot be overwritten, and the previous version of a replaced tool is backed up.

The lesson carries beyond this feature: *a check is not a boundary*. Validation and pattern matching describe code; only the operating system, through a separate process, can actually take a privilege away. And when even that is not enough, say so plainly.

#### 9.2 External Extensibility: Native MCP Client (Model Context Protocol)
To connect the agent with complex external services (GitHub repositories, SQLite databases, web browsers, external filesystems) without writing bespoke TypeScript libraries, TSUKA implements the open **Model Context Protocol (MCP)**.

Rather than taking on heavy third-party SDKs, TSUKA features a **native, zero-dependency** implementation (~400 lines in `src/core/mcp/`):
1. **Standard I/O Transport (`stdioTransport.ts`)**: launches configured servers from `tsuka.config.json` as child processes communicating over `stdin`/`stdout`.
2. **JSON-RPC 2.0 Handshake (`client.ts`)**: performs the `initialize` handshake and queries available tools via `tools/list`.
3. **Adapter Registration (`adapter.ts`)**: registers remote tools into `ToolRegistry` with the `mcp__<server>__<tool>` prefix, using remote JSON schemas directly for validation.
4. **Safety & Fault Isolation**: MCP tools inherit full `PermissionManager` gating (`RESTRICTED` by default with interactive approval). Crashed or unresponsive MCP servers emit diagnostics via `logSink` without blocking the harness. Each runtime awaits cleanup of its own child processes; a synchronous exit hook handles abrupt termination.

---

### Milestone 10 — Packaging & Configuration Hierarchy

*Code references: `src/core/apphome.ts`*

TSUKA resolves configurations hierarchically:
1. **Local Project (`.tsuka/`)**: configurations initialized via `tsuka init` override global defaults.
2. **Global App Home (`appHome`)**: fallback to system-wide characters, teams, and settings.

---

### Milestone 11 — Core Invariants, Composition Root & Pluggable Contracts (Phase 8)

*Code references: `src/core/runtime.ts`, `src/core/agent.ts`, `src/core/provider/`, `src/tools/`, `src/core/memory/`*

As an agent harness scales beyond 80 test suites, maintainability becomes paramount (Directives 8, 9, and 10 in `AGENTS.md`):

1. **Unified Composition Root (`createHarnessRuntime`)**: Initializing configuration, providers, registries, and permissions ad-hoc across CLI and TUI leads to behavioral drift. A single factory in `runtime.ts` wires the entire system and provides an idempotent `close()` method for deterministic shutdown (terminating MCP processes and flushing memory).
2. **Isolating Agent Invariants**: `Agent` is no longer a sprawling monolith. Token calibration (`tokenCalibration.ts`), conversation pruning (`conversationHistory.ts`), tool invocation lifecycles (`toolRound.ts`), state machine transitions (`reactState.ts`), and reasoning trace persistence (`reasoningTrace.ts`) are decomposed into sharp, testable units.
3. **Strict Layer Contracts**: The ReAct engine never inspects provider wire payloads or file schema paths directly. By coding against `IToolRegistry` and encapsulating OpenAI payloads in `provider/wireFormat.ts` and `provider/streamAccumulator.ts`, providers and tools can be swapped out cleanly without touching agent logic.
4. **Decoupled Memory Codec & Storage**: In `src/core/memory/`, fact serialization, normalization, summary derivation, and deduplication live in `codec.ts`, while atomic file writes (via `.tmp` + `renameSync`) and corruption recovery backups (`.corrupt-<timestamp>`) live in `storage.ts`. `JsonMemoryBackend` is purely responsible for RAM state orchestration.

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
5. **Unambiguous File Mutations**: `write_file` accepts `append` only as a boolean and rejects strings, numbers, and `null`; `edit_file` rejects empty targets while preserving empty replacements for intentional deletion.
6. **Configuration Recovery**: invalid `tsuka.config.json` bytes are preserved in a collision-safe backup before defaults are restored atomically; failed recovery blocks later persistence instead of overwriting evidence.
7. **Canonical, Not Lexical, Jails**: normalized-prefix checks do not stop symlinks or junctions. TSUKA resolves the root, target, or nearest existing ancestor with `realpath`, permits internal links only, and deduplicates real directories during bounded recursive scans.
5. **HTML Entities in Terminal Rendering**: Markdown parsers convert quotes into HTML entities (`&#39;`); decode them before ANSI terminal output.
6. **Accidental Credential Leaks**: system diagnostic tools can inadvertently leak environment variables; apply proactive redaction masks.
7. **Hidden Local Server Queues**: a local model that appears frozen is often waiting in a single-slot inference queue. Always provide visual status and timeouts.
8. **Oversized Tool Arguments**: passing entire files inline breaks small model JSON generation. Design tools to support chunking or file paths.
9. **History Poisoning from Malformed JSON**: never save raw invalid JSON tool calls to history; sanitize and repair them before persisting.
10. **Test Suite Memory Isolation**: automated tests must never write to the real user `memory.json`. Always redirect test stores to temporary test environments.

---

*For detailed architectural specifications, consult the [System Architecture](architecture.md) and [Multi-Agent Workflows](multi-agent.md).*
