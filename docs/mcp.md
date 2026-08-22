# 🔌 MCP Integration (Model Context Protocol)

The **Model Context Protocol (MCP)** is an open standard that enables AI agents to interact with external tools and data sources (such as GitHub, SQLite databases, web browsers, or external filesystems) through a uniform **JSON-RPC 2.0** protocol.

Starting from **v0.6.0**, TSUKA includes a **native MCP client** based on standard I/O (`stdio`): configured servers are automatically spawned as child processes, and their tools are seamlessly registered into TSUKA's `ToolRegistry`, making them immediately accessible to all agents.

---

## 🎯 Why MCP Integration Matters

1. **Expansive Ecosystem Without Extra Code**: gives agents access to hundreds of ready-to-use community servers (databases, cloud services, Git workflows, browser automation) without writing custom TypeScript tools.
2. **Native & Zero-Dependency Architecture**: the MCP client (`src/core/mcp/`) is implemented directly over stdio and JSON-RPC 2.0, without external SDKs or heavy transitive dependencies.
3. **First-Class Citizens**: MCP tools participate in the normal ReAct cycle, adhere to permission checks (`PermissionManager`), and respect model capability tier gating.

---

## ⚙️ Quick Configuration (`tsuka.config.json`)

To enable one or more MCP servers, add the `mcpServers` section to `tsuka.config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\data"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_secret_token"
      },
      "riskLevel": "RESTRICTED",
      "timeoutMs": 60000
    },
    "database": {
      "command": "node",
      "args": ["server-sqlite.mjs"],
      "enabled": false
    }
  }
}
```

### Configuration Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `command` | `string` | *(required)* | Executable command of the MCP server (e.g. `npx`, `node`, `python`, `uvx`). |
| `args` | `string[]` | `[]` | Arguments passed to the launch command. |
| `env` | `object` | `{}` | Additional environment variables (e.g. API tokens). Redacted from logs for safety. |
| `enabled` | `boolean` | `true` | When set to `false`, the server remains configured but is not started. |
| `riskLevel` | `string` | `"RESTRICTED"` | Security tier assigned to all tools from this server (`SAFE`, `RESTRICTED`, `DANGEROUS`). |
| `timeoutMs` | `number` | `60000` | Maximum timeout (in milliseconds) for `tools/list` and `tools/call` requests. |

---

## 🏷️ Naming Convention (`mcp__<server>__<tool>`)

To prevent naming collisions with TSUKA's 30 native tools and make the tool's origin immediately evident, every MCP tool is registered with a standardized prefix:

$$\text{Registered Name} = \mathbf{mcp\_\_}\{\text{server\_name}\}\mathbf{\_\_}\{\text{tool\_name}\}$$

**Examples:**
* `mcp__github__create_issue`
* `mcp__filesystem__list_directory`
* `mcp__sqlite__read_query`

The LLM invokes these tools identically to native tools, and user permission prompts clearly display which server is requesting the action.

---

## 🔒 Security & Permission Model

MCP tools are fully governed by TSUKA's defensive safety framework:

1. **Interactive Permission Prompts**: every MCP tool call passes through `PermissionManager`. With the default `RESTRICTED` level, the user receives an interactive prompt showing the full server name, tool name, and parameters before execution `[y/N/always]`.
2. **Pre-flight Schema Validation**: the input parameter schema (`inputSchema`) provided by the MCP server is validated locally before dispatch, stopping malformed calls before they leave the harness.
3. **Fault Isolation & Graceful Degradation**: if an MCP server crashes or fails during startup, a diagnostic warning is logged via `logSink` and TSUKA continues launching. A broken MCP server never blocks the harness.
4. **Clean Process Lifecycle**: upon exit (CLI or TUI), a synchronous handler terminates all spawned MCP child processes, preventing background orphan processes.

> ⚠️ **Note on Workspace Jail**: MCP servers run as independent host processes. An external filesystem server configured by the user has access to its assigned host paths, outside the local workspace root. Security is governed by the interactive `riskLevel` tier.

---

## 🔄 Lifecycle & Execution Flow

```
[ TSUKA Startup ] ──► [ Read mcpServers from tsuka.config.json ]
                              │
                              ▼
                [ Spawn child process (stdio) ]
                              │
                              ▼
                [ JSON-RPC 2.0 Handshake: initialize ]
                              │
                              ▼
                [ Fetch tool definitions: tools/list ]
                              │
                              ▼
       [ Register in ToolRegistry as mcp__<server>__<tool> ]
                              │
                              ▼
   [ ReAct Agent Execution with permission gating & validation ]
```

---

## 🚧 Current Status & Roadmap

* **Supported Transport**: Standard I/O (`stdio`). The pluggable `IMcpClient` interface is ready for future HTTP/Server-Sent Events (SSE) transports.
* **Content Types**: Text and JSON content blocks are supported natively. Binary resources/images produce descriptive type markers.
