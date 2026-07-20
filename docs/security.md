# Security & Permissions Framework 🛡️

TSUKA is designed to automate Windows and PowerShell tasks. Because executing shell scripts or writing files on a host system carries risks, the framework implements a strict security model and a user-in-the-loop authorization engine.

---

## 🔒 Tool Risk Tiers

Every tool registered in the registry declares a `RiskLevel`. The `PermissionManager` enforces authorization boundaries based on this level:

| Risk Level | Description | Examples | Execution Behavior |
| :--- | :--- | :--- | :--- |
| **`SAFE`** | Read-only operations, internet queries, and basic system checks. | `read_file`, `list_dir`, `grep_search`, `web_search`, `browse_url`, `get_ps_info` | Executed instantly without interrupting the user. |
| **`RESTRICTED`** | Actions that modify the user's workspace files or agent configurations. | `write_file`, `edit_file`, `delete_file`, `create_role` | Prompts the user: `[y/N/sempre]`. Selecting `sempre` (always) grants authorization for all workspace file edits for the rest of the session. |
| **`DANGEROUS`** | Actions that execute arbitrary code, modify system files, or open ports. | `execute_command` (PowerShell command executor) | **Always prompts** the user `[y/N]` before execution. Session bypass is disabled. |

---

## 👤 User-in-the-Loop Prompting

When a `RESTRICTED` or `DANGEROUS` tool is called by an agent:

1. The agent loop pauses.
2. The `PermissionManager` prints the action details on the console (e.g., the exact PowerShell code to be run, or the file path to be created).
3. The user is prompted for approval:
   - `y` (yes): Authorizes this specific execution.
   - `n` (no): Rejects the execution. The tool returns an error message telling the agent the user denied the request.
   - `sempre` (always - only for RESTRICTED): Authorizes all future RESTRICTED writes for this session without further prompts.
4. You can reset session-approved permissions at any time by typing the `/reset` slash command.

---

## 🌐 Objective Source Logging

To protect the user from LLM hallucinations when accessing online data:

* **No LLM Omission**: The framework captures raw results from search engines (DuckDuckGo, Google, Tavily) and URL browsers.
* **Console Logging**: Upon successful tool completion, the CLI prints the list of source URLs directly to the terminal:
  ```
  ✔ Tool 'web_search' completato.
    └─ Fonti trovate:
       • https://nodejs.org/en/blog/announcements/v22-release-announce
       • ...
  ```
* This ensures that the user is aware of the exact resources queried by the agent, even if the agent fails to cite them in its final conversational output.
