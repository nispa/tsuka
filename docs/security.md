# Security, Confinement & Permissions Framework 🛡️

<div align="right">
  <p>Leggi in <a href="security-it.md">🇮🇹 Italiano</a></p>
</div>

**TSUKA** is engineered to automate real-world software engineering and operational tasks across operating systems (Windows, Linux, and macOS). Because executing shell scripts, modifying source files, and running autonomous multi-agent pipelines carry host-level operational risks, the framework enforces a multi-tier **Defense-in-Depth security architecture** strictly centered around the **User-in-the-Loop** principle.

---

## 🏛️ Multi-Layer Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           1. USER-IN-THE-LOOP                           │
│     PermissionManager: FIFO Prompt Queue · CLI / TUI Interactive Modals │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                    2. WORKSPACE JAIL & PATH CONFINEMENT                 │
│        resolveSafePath() · Path Traversal Blocking (CWE-22)             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  3. CREDENTIAL & SENSITIVE DATA MASKING                 │
│         Automatic Redaction: API Keys, Passwords, Tokens, Secrets       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  4. ISOLATED PARALLEL WORKSPACE STAGING                 │
│      Ephemeral Branch Sandboxes · Conflict-Aware Merge Detection        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  5. RUNTIME VM SANDBOX & USER-SPACE TOOLS               │
│        node:vm Isolation · Blocklist Policies · custom_tools/ User Space│
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                  6. DEFENSIVE SAST ENGINE (audit_code)                  │
│       CWE-798 · CWE-78/95 · CWE-89 · CWE-79 · CWE-327/295 · CWE-532    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 1. Three Tool Risk Tiers (`riskLevel`)

Every native and dynamic tool registered in `ToolRegistry` declares an explicit risk tier. The `PermissionManager` guarantees that no state-modifying or potentially dangerous action executes without authorization:

| Risk Tier | Operational Description | Native Tools | Execution Policy |
| :--- | :--- | :--- | :--- |
| **`SAFE`** | Read-only operations, defensive static analysis, internet searches, and system telemetry. | `read_file`, `list_dir`, `grep_search`, `audit_code`, `web_search`, `browse_url`, `get_ps_info`, `recall_memory`, `read_notes` | **Immediate and transparent execution** without interrupting the user. |
| **`RESTRICTED`** | Modifying/deleting workspace files, network downloads, or creating roles and tools. | `write_file`, `edit_file`, `delete_file`, `download_file`, `create_role`, `create_tool`, `save_memory`, `post_note` | **Prompts the user interactively**: `[y/N/always]`. Choosing `always` grants permission for subsequent workspace file writes during the active session. |
| **`DANGEROUS`** | Arbitrary code execution, system shell commands (PowerShell, Bash), or network socket operations. | `execute_command` | **ALWAYS prompts for explicit confirmation** `[y/N]`. Session-wide auto-approval is **strictly disabled** to prevent runaway executions. |

---

## 🏢 2. Strict Workspace Jail & Confinement

All filesystem operations (`read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `grep_search`, `audit_code`) are strictly confined to the active `workspaceRoot` via the secure resolver `resolveSafePath()`:

* **Path Traversal Protection (`CWE-22`)**: Attempts to escape the workspace boundary using relative directory traversal (`..`) or absolute host paths are intercepted and rejected before touching the filesystem.
* **Host System Isolation**: Agents are unable to read or tamper with host system files, user home directories, SSH keys, or global OS settings.

```typescript
// src/tools/impl/utils.ts
export function resolveSafePath(workspaceRoot: string, targetPath: string): string {
  const resolved = path.resolve(workspaceRoot, targetPath);
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error(`Access denied: path '${targetPath}' is outside the workspace jail.`);
  }
  return resolved;
}
```

---

## 🔑 3. Sensitive Data & Credential Masking

TSUKA automatically scrubs sensitive credentials from all communication pipelines (`maskEnvVars`):
* **Environment Variable Redaction**: Any loaded `.env` variables or system environment keys matching sensitive patterns (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `AUTH`) are automatically masked.
* **Omnichannel Protection**: Scrubbing occurs before data reaches LLM prompts, persistent run logs (`workflow_logs/`), the CLI console stream, or the TUI screen buffers.

---

## ⚡ 4. Serialized Permission Queue (FIFO Prompt Queue)

In concurrent multi-agent or parallel branch workflows (`PARALLELO` blocks in `/goal`):
* Multiple concurrent agents may request permissions simultaneously.
* The `PermissionManager` sequentially chains interactive prompts through an asynchronous FIFO queue (`enqueuePrompt`).
* **Terminal Stream Protection**: Prompts appear one at a time, eliminating stdin collisions and double-buffered TUI modal corruption.

---

## 🧪 5. Isolated Parallel Workspace Sandboxes (`parallelWorkspace.ts`)

During parallel branch execution in the Goal Orchestrator:
1. **Isolated Staging**: Each agent operates in an isolated temporary staging directory managed via `AsyncLocalStorage`.
2. **Deterministic Merge**: Upon completing the parallel block, file changes are merged into the real workspace with conflict detection (blocking silent concurrent overwrites).
3. **Automatic Teardown**: Temporary staging folders are cleanly pruned upon completion.

---

## 🛠️ 6. VM Sandbox & User-Space Tool Isolation (`create_tool`)

TSUKA allows agents to safely author new tools at runtime:
* **`node:vm` Sandbox Execution**: Generated tool code is evaluated in an isolated virtual machine context with restricted globals (`fs` and `path` only, no `eval()`, `new Function()`, `process.exit`, `process.env`, or unvetted modules).
* **User-Space Isolation (`custom_tools/`)**: Self-authored tools and JSON schemas are stored in `custom_tools/` and `custom_tools_schemas/` (git-ignored), preventing accidental corruption of the framework's source repository.
* **Core Protection**: Dynamic tools cannot overwrite or shadow native core tools.
* **Automatic Versioning & Backup**: Updated custom tools are versioned and backed up in `tools_backup/`.

---

## 🔍 7. Defensive SAST Security Engine (`audit_code`)

TSUKA includes a built-in static application security testing engine (`audit_code`) to scan codebase files for common security vulnerabilities:

| Vulnerability / CWE | Description & Detection Patterns |
| :--- | :--- |
| **`CWE-798` (Hardcoded Secrets)** | Detects OpenAI API keys (`sk-...`), AWS credentials (`AKIA...`), GitHub tokens (`ghp_...`), JWTs, RSA/PEM private keys, and hardcoded passwords. |
| **`CWE-78 / CWE-95` (Code/Command Injection)** | Detects un-sanitized dynamic command execution with `child_process.exec`, `eval()`, `new Function()`, and `execSync`. |
| **`CWE-89` (SQL Injection)** | Detects raw SQL query concatenation and template string queries lacking parameterization. |
| **`CWE-22` (Path Traversal)** | Detects unsanitized dynamic filesystem lookups (`path.join` with user input). |
| **`CWE-79` (DOM XSS)** | Detects unsafe DOM element injections (`innerHTML`, `outerHTML`, `dangerouslySetInnerHTML`). |
| **`CWE-327 / CWE-295` (Broken Crypto & Insecure TLS)** | Detects insecure hashing algorithms (`MD5`, `SHA1`) and disabled TLS certificate verification (`rejectUnauthorized: false`). |
| **`CWE-532 / CWE-732` (Log Leaks & Permissive Permissions)** | Detects credentials logged to stdout/files and overly permissive file modes (`chmod 777`). |

### Audit Configuration Options:
* `path`: Specific file or directory to scan.
* `severityThreshold`: Severity filter (`HIGH`, `MEDIUM`, `LOW`).
* `fileExtensions`: Target file extensions (e.g. `['.ts', '.js', '.py', '.php', '.env']`).
* `maxIssues`: Maximum number of reported issues.

---

## 🤖 8. Multi-Agent Protocol Safety & Interruption Controls

* **Typed Inter-Agent Contracts**: Agent transitions and voting use structured protocol tools (`report_status`, `route_next`, `cast_vote`).
* **Turn Interrupt (<kbd>Esc</kbd> / `Ctrl+X`)**: Users can instantly interrupt execution at any time; the abort signal (`AbortSignal`) immediately propagates across all active subagents and running tools.
* **Subagent Safety Inheritance (`spawn_agent`)**: Subagents inherit the parent's workspace jail, token budgets, and permission handlers.
