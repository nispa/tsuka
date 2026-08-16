# Security & Permissions Framework 🛡️

<div align="right">
  <p>Leggi in <a href="security-it.md">🇮🇹 Italiano</a></p>
</div>

TSUKA is designed to automate real-world OS tasks on Windows, Linux, and macOS. Because running shell scripts or modifying files on a host system carries operational risk, the framework enforces a strict **User-in-the-Loop** permission model.

---

## 🔒 1. Tool Risk Tiers

Every registered tool declares an explicit `riskLevel`. The `PermissionManager` enforces authorization boundaries accordingly:

| Risk Tier | Operational Description | Examples | Execution Behavior |
| :--- | :--- | :--- | :--- |
| **`SAFE`** | Read-only operations, static code auditing, internet search, and system telemetry. | `read_file`, `list_dir`, `grep_search`, `audit_code`, `web_search`, `browse_url`, `get_ps_info` | Executed instantly without interrupting the user. |
| **`RESTRICTED`** | Actions modifying or deleting workspace files, or changing configuration states. | `write_file`, `edit_file`, `delete_file`, `download_file`, `create_role`, `create_tool` | Prompts the user: `[y/N/always]`. Choosing `always` approves all subsequent file modifications for the active session. |
| **`DANGEROUS`** | Arbitrary code execution, shell commands, or network port manipulation. | `execute_command` (PowerShell / Shell executor) | **Always prompts** the user `[y/N]`. Global session bypass is strictly disabled. |

---

## 🛡️ 2. Cybersecurity Specialist & Static Code Auditing (`audit_code`)

TSUKA includes a dedicated `security_auditor` role (covered by **Worf**, and as a secondary skill by **Tuvok** and **Sherlock**):

* **Defensive Static Analysis (`audit_code`)**: Scans workspace source files for OWASP vulnerabilities, hardcoded API keys/JWT tokens, command injection patterns, insecure dynamic execution (`eval`), and weak cryptographic hashing.
* **Remediation & Hardening**: The security agent formulates concrete defensive code fixes and configuration hardening recommendations for developer review.
* **Security Pack**: Enable security capabilities across any project using:
  ```powershell
  tsuka init --pack security
  ```

---

## 👤 3. User-in-the-Loop Authorization Workflow

When an agent requests a `RESTRICTED` or `DANGEROUS` tool:

1. The ReAct execution loop pauses immediately.
2. The `PermissionManager` displays exact action details (e.g. the exact PowerShell command or file destination path).
3. The user selects an option:
   * `y` (yes): Authorizes the single execution.
   * `n` (no): Denies the execution, returning an error to the agent to explore alternative approaches.
   * `always` (only for `RESTRICTED`): Authorizes all future workspace writes for the session.
4. Session-approved permissions can be revoked at any time via the `/reset` command.

---

## 🌐 4. Objective Source Logging

To protect against hallucinations when accessing online data:

* **Deterministic URL Capture**: The framework intercepts raw search results (DuckDuckGo, Google, Tavily) and browser targets directly.
* **Console Logging**: Upon tool completion, the CLI prints the queried URLs to the terminal:
  ```
  ✔ Tool 'web_search' completed.
    └─ Sources found:
       • https://nodejs.org/en/blog/announcements/v22-release-announce
       • ...
  ```
* Users always retain immediate visibility into external resources referenced by agents.
