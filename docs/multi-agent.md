# Multi-Agent & Collaboration Workflows 👥

TSUKA supports advanced multi-agent interactions, allowing you to orchestrate group debates or launch collaborative teams that actively use tools on your workspace in sequential shifts.

---

## 🎭 Persona Orthogonality (Roles vs. Traits)

Instead of hardcoding a character prompt, TSUKA splits the agent personality into two orthogonal vectors:

* **Role (What they do)**: Defined in `roles/*.json` (e.g., `developer`, `sysadmin`). Determines the set of allowed tools.
* **Trait (How they speak)**: Defined in `traits/*.json` (e.g., `grumpy`, `sensual`, `devils_advocate`). Determines the tone and stylistic directives.

A **Character Preset** (`characters/*.json`) simply binds these two together under a custom name (`aiName`), such as:
- **Falco**: `sysadmin` (Role) + `grumpy` (Trait) + `Falco` (Name).
- **Pippo**: `developer` (Role) + `devils_advocate` (Trait) + `Pippo` (Name).

---

## 📞 Group Debate Conferences (`/call`)

The `/call` command starts a discussion round between multiple characters in the same chat history:

1. **Invocation**:
   - **Interactive Multiselect**: Type `/call` with no arguments to trigger a visual checkbox checklist. Use `Space` to select/deselect characters, and `Enter` to confirm.
   - **Menzions**: Mention names directly using the `@` symbol (e.g., `/call @falco, @lola e @pippo`).
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
   - Type `/team` to select from preconfigured teams (e.g., `cyber_audit` consisting of `["falco", "piccione"]`).
2. **Task Assignment**:
   - The user inputs a goal (e.g., *"Audit current ports and write a security report"*).
3. **Sequential Shifts (Tool Handover)**:
   - **Shift 1 (e.g., Falco)**: Falco runs first. He gets his role instructions, allowed tools, and the task. He executes system commands or diagnostics. Any file writes or command outputs are executed. When he finishes, he writes a final summary.
   - **Shift 2 (e.g., Piccione)**: Piccione runs next. He inherits the **exact tool execution history and message log** of Falco. He sees which files Falco modified, reads the workspace, finds weaknesses, runs his own tools, and provides the final solution.
4. **Shared Workspace & State**:
   - Because all agents operate in the same physical directory, file modifications made during previous shifts are immediately visible to the subsequent agents.
   - **Auditing**: All tool calls made by the team members (such as editing code or executing PowerShell scripts) are subject to the user's interactive permission checks (`[y/N]`) in real-time, giving you full control over the team's operations.
