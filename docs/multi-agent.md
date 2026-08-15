# Multi-Agent & Collaboration Workflows 👥

TSUKA supports advanced multi-agent interactions, allowing you to orchestrate group debates, launch collaborative teams that actively use tools on your workspace in sequential shifts, or let a dynamic orchestrator assemble the perfect team on the fly from all available characters.

---

## 🎭 Persona Orthogonality (Roles vs. Traits)

Instead of hardcoding a character prompt, TSUKA splits the agent personality into two orthogonal vectors:

* **Role (What they do)**: Defined in `roles/*.json` (e.g., `developer`, `sysadmin`). Determines the set of allowed tools.
* **Trait (How they speak)**: Defined in `traits/*.json` (e.g., `grumpy`, `sensual`, `devils_advocate`). Determines the tone and stylistic directives.

A **Character Preset** (`characters/*.json`) simply binds these two together under a custom name (`aiName`), such as:
- **La'an** (`laan.json`): `sysadmin` (Role) + `grumpy` (Trait) + `Laan` (Name).
- **Geordi** (`geordi.json`): `developer` (Role) + `professional` (Trait) + `Geordi` (Name).

A character may also unlock several roles (`"roles": [...]`, multi-skill): it then owns the
tools of all of them, so a task spanning two crafts needs no handover.

---

## 📞 Group Debate Conferences (`/call`)

The `/call` command starts a discussion round between multiple characters in the same chat history:

1. **Invocation**:
   - **Interactive Multiselect**: Type `/call` with no arguments to trigger a visual checkbox checklist. Use `Space` to select/deselect characters, and `Enter` to confirm.
   - **Menzions**: Mention names directly using the `@` symbol (e.g., `/call @laan, @deanna_troi and @geordi`).
2. **Execution**:
   - The user inputs a discussion topic.
   - The CLI enters a loop of $N$ rounds. In each round, it swaps the system prompt to match the current speaker and prompts the LLM.
   - To make the active agent aware of previous speakers, the debate history is formatted as a sequence of `user` messages, prepended with the name of the speaker: `[SpeakerName]: "Message content..."`.
3. **Transcript Memory**:
   - After the call, the entire debate transcript is formatted and injected into the main chat history. The active main character will remember what was discussed during the call.

---

## 🚀 Collaborative Team Workflows (`/team`)

The `/team` command launches an active multi-agent team workflow where characters use their tools on the workspace in sequential shifts:

1. **Selecting a Team**:
   - Type `/team` to select from preconfigured teams (e.g., `cyber_audit`, a `security_auditor` → `sysadmin` → `supervisor` chain).
2. **Task Assignment**:
   - The user inputs a goal (e.g., *"Audit current ports and write a security report"*).
3. **Sequential Shifts (Tool Handover)**:
   - **Shift 1 (the auditor)**: the first member runs with its role instructions, allowed tools and the task. It executes system commands or diagnostics; file writes and command outputs happen for real. When it finishes, it writes a final summary.
   - **Shift 2 (the sysadmin)**: the next member inherits the **exact tool execution history and message log** of the previous shift. It sees which files were modified, reads the workspace, finds weaknesses, runs its own tools, and provides the final solution.
4. **Shared Workspace & State**:
   - Because all agents operate in the same physical directory, file modifications made during previous shifts are immediately visible to the subsequent agents.
   - **Auditing**: All tool calls made by the team members (such as editing code or executing PowerShell scripts) are subject to the user's interactive permission checks (`[y/N]`) in real-time, giving you full control over the team's operations.

---

## 🎯 Dynamic Goal Orchestrator (`/goal`)

The `/goal` command dynamically assembles a team from **all available characters** — no preconfigured team file needed. The orchestrator LLM plans the workflow, assigns tasks, and coordinates execution autonomously.

```powershell
/goal Crea una sceneggiatura di Cappuccetto Rosso e per ogni scena genera il prompt Krea2
```

### Orchestrator Planning Phase

1. The orchestrator receives the goal and the full list of available characters with their roles/descriptions.
2. It produces a plan in a structured format:
   ```
   AGENTE: @doctor — Scrivi la sceneggiatura
   PARALLELO:
   AGENTE: @moriarty — Genera prompt Krea2 per ogni scena
   AGENTE: @quark — Prepara i testi promozionali
   FINE PARALLELO
   AGENTE: @pike — Revisiona il lavoro finale
   FINE
   ```
3. `PARALLELO` blocks execute independent subtasks concurrently via `Promise.all`.
4. If the goal is trivial (a simple question), the orchestrator responds with just `FINE` and no team is spawned.

### Execution & Context Management

Each agent turn:
1. **Context bar** (dual):
   - **Before** the agent: shows estimated context based on history + 2000 tok overhead for system prompt/tools. Uses real `promptTokens` from the previous agent if available.
     ```
     Contesto prima di Doctor: ████░░░░░░░░░░░░░░░░ 17% (~11.2k / 65.536 tok)
     ```
   - **After** the agent: shows real peak prompt tokens measured from the LLM's last round:
     ```
     Contesto reale (peak Doctor): ██████████████░░░░░░ 59% (~38.4k / 65.536 tok)
     ```
2. The agent runs with full tool access, streaming output live. **Each agent is instructed to inspect workspace files created by previous agents** (`list_dir`, `read_file`).
3. **Reasoning** from `<think>` tags or native `reasoning_content` is displayed in dimmed gray.
4. **No early stop on `STATO: COMPLETATO`**: the orchestrator's plan is executed fully — all steps run, including the final supervisor. Early completion flags are tracked but do not abort the plan.
5. After completion, the agent's output is **condensed** only if longer than 1500 characters:
   - A meaningful summary (not a one-liner) is kept in the shared history
   - A fact is saved to persistent memory (`recall_memory` for full details)
   - Estimated token savings are displayed

### Stats Summary

At the end, per-agent and cumulative statistics with output/context/total tok breakdown:
```
📊 RIEPILOGO STATS AGENTI
  Agente             Out tok    Ctx tok   Tot tok    Tempo    Velocità
  Doctor             1234      15032     16266     12.3s   100.3 tok/s
  Krea Master            892      16780     17672      8.1s   110.1 tok/s
  Pike                   456      17500     17956      4.2s   108.6 tok/s
  TOTALE                2582      17500     51894     24.6s
```

- **Out tok**: cumulative output (completion) tokens — sum of all LLM rounds in the agent's turn
- **Ctx tok**: peak prompt tokens — the context window size for the last (largest) LLM call
- **Tot tok**: estimated total = ctx + out

The stream panel at the end of each agent turn also shows the real-time summary:
```
[Out: 1234 tok | Ctx: 15032 tok | Tot: 16266 tok | 100.3 tok/s | 12.34s]
```
