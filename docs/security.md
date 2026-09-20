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

## 🔒 1. Tool Risk Tiers & Graduated Execution (`riskLevel`)

Every native and dynamic tool registered in `ToolRegistry` declares an explicit risk tier. The `PermissionManager` guarantees that no state-modifying or potentially dangerous action executes without authorization:

| Risk Tier | Operational Description | Native Tools | Execution Policy |
| :--- | :--- | :--- | :--- |
| **`SAFE`** | Read-only operations, defensive static analysis, internet searches, coordination protocols, and memory operations. | `read_file`, `list_dir`, `grep_search`, `audit_code`, `web_search`, `browse_url`, `get_ps_info`, `save_memory`, `recall_memory`, `update_memory`, `forget_memory`, `read_notes`, `post_note`, `report_status`, `route_next`, `cast_vote`, `send_message`, `load_tools`, `switch_skill` | **Immediate and transparent execution** without interrupting the user. |
| **`RESTRICTED`** | Modifying/deleting workspace files, network downloads, subagent spawning, escalation, or creating roles. | `write_file`, `edit_file`, `delete_file`, `download_file`, `spawn_agent`, `create_role`, `request_goal`, `request_team`, `request_call` | **Prompts the user interactively**: `[y/N/always]`. Choosing `always` grants permission for subsequent matching operations during the active session. |
| **`DANGEROUS`** | Executable self-authored code and other high-impact operations. | `create_tool` and every loaded custom executable tool | Requires the maximum interactive permission tier and remains unavailable unless `selfAuthoringEnabled` is explicitly true. |
| **`DANGEROUS` (Graduated)** | System shell execution (`execute_command`). Graduated dynamically per command invocation via `classifyRisk()` ([`src/safety/commandRisk.ts`](../src/safety/commandRisk.ts)). | `execute_command` | **Graduated Policy**: harmless read-only commands (`git status`, `ls`) execute as `SAFE`; build/test commands (`npm test`, `cargo build`) run as `RESTRICTED` (allowing session-wide approval); arbitrary/unknown commands remain `DANGEROUS` (always interactive prompt `[y/N]`). |

`execute_command` owns the spawned process tree for its full lifecycle. User cancellation and timeout share an idempotent terminal path that removes listeners and watchdogs, then terminates descendants cooperatively and forcibly if needed (`taskkill /T` on Windows, detached process groups on POSIX).

### Session shell authorization (`/sudo`)

`/sudo on` is an explicit, user-operated session control in both the CLI and TUI. While enabled, it makes `execute_command` available to every agent regardless of its role allowlist or model capability tier, and bypasses that tool's `SAFE`, `RESTRICTED`, and `DANGEROUS` permission prompts. It applies to workflow agents that share the same `PermissionManager`.

`/sudo`, `/sudo status`, and `/sudo off` inspect or revoke the control. It is disabled by default and cleared by `/reset` and when a new runtime starts. It does not elevate the operating-system process, grant other tools additional permissions, or undo a command already running; use the normal stop/interrupt path for that. A queued command checks the setting when it reaches the permission queue, so revocation takes effect before a waiting command is approved.

All built-in HTTP tools use the shared `safeFetch` boundary. It validates HTTP(S), standard ports, every DNS answer, and every redirect hop; private, loopback, link-local, multicast, reserved, and mixed public/private DNS answers fail closed. A residual DNS TOCTOU remains until the transport pins the validated address for the actual socket connection.

---

## 🏢 2. Strict Workspace Jail & Confinement

All filesystem operations (`read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `grep_search`, `audit_code`) are strictly confined to the active `workspaceRoot` via the secure resolver `resolveSafePath()`:

* **Canonical Path Protection (`CWE-22`)**: Both workspace and existing targets are resolved through `realpath`; new destinations are validated from their nearest existing ancestor. Prefix siblings, `..`, absolute escapes, external symlinks, junctions, and dangling links are denied.
* **Internal Links and Cycles**: Links resolving inside the workspace are allowed. Recursive tools track visited real directories so link cycles and aliases cannot cause repeated or infinite traversal.
* **Bounded Scans**: `grep_search` and `audit_code` share centralized depth, file-count, and byte ceilings and report blocked links or truncation.
* **Residual Race Boundary**: Canonical validation narrows link-based escapes, but Node's path-based synchronous APIs cannot make validation and open one indivisible OS operation. Mutating workspace links concurrently remains outside the guarantee until descriptor-relative APIs are available cross-platform.

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

## 🛠️ 6. Opt-in Self-Authoring Threat Model (`create_tool`)

The controls in this section remediate findings from an **external security audit** received by the project. The audit identified the tool's self-declared risk level and the use of `node:vm` as a presumed security boundary as inadequate. The complete configuration and usage procedure is in the [self-authoring guide](self-authoring.md).

`node:vm`, blocklists, and a jailed `fs` wrapper validate conventions but do not isolate hostile JavaScript. The immediate mitigation is fail-closed:
* **Disabled by Default**: `create_tool` is not registered and custom executable modules are not loaded unless `selfAuthoringEnabled: true` is set.
* **Maximum Permission Tier**: Creation and every loaded custom tool are forced to `DANGEROUS`, regardless of their own declaration.
* **Bounded Shape Validation**: `node:vm` checks that generated code loads with the expected module shape within a short timeout; it is explicitly not a security sandbox.
* **Residual Risk**: Enabling self-authoring authorizes executable JavaScript in the TSUKA process. A structural replacement requires a separate OS process/container with explicit filesystem, network, CPU, memory, time, and output capabilities.
* **Existing Defenses in Depth**: Core-name collision checks, versioned backups, pattern rejection, and canonical workspace-jailed `fs` remain active but do not change the residual trust model.

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
