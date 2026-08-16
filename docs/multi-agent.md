# Multi-Agent & Collaboration Workflows 👥

<div align="right">
  <p>Leggi in <a href="multi-agent-it.md">🇮🇹 Italiano</a></p>
</div>

TSUKA supports advanced multi-agent interactions: orchestrating group debate conferences (`/call`), launching collaborative teams operating directly on workspace files with native tools (`/team`), or using a dynamic goal orchestrator (`/goal`) that plans workflows and dynamically recruits agents from all available characters.

---

## 🎭 1. Declarative Persona System (Character = Agent)

Instead of hardcoding monolithic prompts, TSUKA separates agent definitions into two orthogonal dimensions:

* **Role (`roles/*.json`)**: defines technical skills, default reasoning effort, and allowed tools (e.g. `developer`, `sysadmin`, `security_auditor`, `supervisor`).
* **Trait (`traits/*.json`)**: defines communication tone and behavioral guidelines (e.g. `professional`, `creative`, `grumpy`, `uncompromising`, `devils_advocate`).

A **Character (`characters/*.json`)** binds an identifier (`aiName`) with a role (or multiple roles with multi-skill support and runtime swapping via `switch_skill`) and a trait:
* **Geordi** (`geordi.json`): `developer` + `professional`
* **Worf** (`worf.json`): `security_auditor` + `reliable`
* **Pike** (`pike.json`): `supervisor` + `reliable`

---

## 📞 2. Multi-Agent Debate Conferences (`/call`)

The `/call` command launches a turn-based group discussion on any topic without tool execution:

1. **Invocation**:
   * **Interactive Multiselect**: run `/call` without arguments to open an interactive checkbox picker.
   * **Direct Mentions**: specify names with `@` (e.g. `/call @spock, @kirk, @doctor`).
2. **Execution**:
   * The user inputs a discussion topic.
   * The CLI runs $N$ rounds: in each round it mounts the current speaker's system prompt and provides the formatted conversation history prefixed with `[SpeakerName]: "..."`.
3. **Transcript Memory**:
   * The full debate transcript is injected into the main chat history upon call completion.

---

## 🚀 3. Collaborative Teams on Shared Workspace (`/team`)

The `/team` command starts a multi-agent workflow where characters cooperate on tasks using tools on the physical filesystem:

```powershell
/team dev_security
> "Implement a secure logging module and verify that no hardcoded credentials exist."
```

### The 4 Collaboration Strategies (`mode`):
1. **`orchestrated` (recommended)**: a dedicated supervisor (`orchestrator`, e.g. `pike`) receives a progress digest after each turn and dynamically routes the next step via `route_next(agent, reason)` (or calls `FINE`).
2. **`round-robin`**: fixed cyclical rotation among team members up to configured rounds (`teamMaxRounds`, default 3).
3. **`pipeline`**: single-pass assembly line where each station refines previous outputs. Supports objective acceptance loops via `RunController` ([`src/core/loop.ts`](../src/core/loop.ts)).
4. **`hybrid`**: when `discussionRounds > 0`, adds a formal debate and voting round (`cast_vote`) after each working cycle.

### Coordination Protocol Tools:
* `report_status(status, summary, next_hint)`: marks turn completion (`COMPLETATO`, `DA_CONTINUARE`, `FALLITO`).
* `route_next(agent, reason)`: used by the orchestrator to route the next turn.
* `cast_vote(vote, reason)`: cast vote during hybrid team discussions (`APPROVO`, `MODIFICARE`, `RIFIUTO`).
* *Resolution Hierarchy*: **Tool Call → Legacy Regex Marker (`STATO:`) → Safety Default** (with visible degradation warnings).

### Run Blackboard (`post_note` / `read_notes`):
A temporary shared scratchpad scoped to a specific run via `AsyncLocalStorage` for exchanging intermediate decisions, notes, and artifacts without polluting persistent long-term memory.

---

## 🎯 4. Dynamic Goal Orchestrator (`/goal`)

The `/goal` command dynamically plans, recruits agents from all 24 characters, and executes end-to-end objectives:

```powershell
/goal Build a TypeScript CLI application with automated unit tests and a security audit
```

### 1. Planning Phase (Orchestrator Planner)
The orchestrator inspects available character capabilities and emits a structured plan:
```
AGENTE: @una — Design module architecture and TypeScript interfaces
PARALLELO:
AGENTE: @geordi — Implement core logic
AGENTE: @data — Author technical documentation
FINE PARALLELO
AGENTE: @worf — Run static security audit
AGENTE: @pike — Review and validate final deliverables
FINE
```

### 2. Execution & Concurrency in `PARALLELO` Blocks
* Independent subtasks inside `PARALLELO` blocks execute concurrently using `Promise.all`.
* **Isolated Staging Workspaces**: each parallel branch writes to a temporary sandbox (`parallelWorkspace.ts`). On block completion, changes are merged with conflict detection.
* **Serialized Permission Queue**: interactive permission prompts (`[y/N]`) are queued cleanly without overlapping.

### 3. Context Monitoring & Run Statistics
* **Dual Context Bar**: displays pre-turn estimate and real peak prompt tokens measured by the LLM.
* **History Condensation**: outputs exceeding 1,500 characters are summarized while persisting full details to memory.
* **Supervisor Rework Loop**: if the final supervisor finds deficiencies, the failed step is re-queued for targeted rework.
* **Final Stats Summary**: per-agent token breakdown (output, context peak, total, timing, and generation speed).
