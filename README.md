# TSUKA

![TSUKA logo](assets/logo.png)

**TypeScript Unified Kit for Agents** — a terminal harness for running LLM agents with local or cloud models.

[Italiano](README-it.md) · [Documentation](docs/README.md) · [MIT License](LICENSE)

TSUKA connects a language model to tools, memory, and multi-agent workflows through a CLI or a full-screen terminal interface. It works with OpenAI-compatible chat endpoints, including local backends such as Ollama and cloud gateways such as OpenRouter.

The model proposes actions; the harness manages tool execution, permissions, conversation state, and stopping conditions. “Deterministic” describes that control logic, not the model's answers or the outcome of a task.

The project is also a practical way to study how an agent works: the execution loop, tool registry, memory backend, and provider client are separate TypeScript modules you can inspect and extend. The name *tsuka* (柄) means the hilt of a Japanese sword: the model is the interchangeable blade.

## Get started

You need Git, Node.js and npm, plus access to an LLM backend. The package requires Node.js 18 or later; the project recommends 20 or later. TSUKA runs on Windows, Linux, and macOS.

### 1. Install from source

```sh
git clone https://github.com/nispa/tsuka.git
cd tsuka
npm install
npm run build
npm link
```

`npm link` makes the `tsuka` command available outside the repository.

### 2. Connect a model

For a local setup, start your backend and load a model with tool-calling support. The bundled Ollama configuration uses `http://localhost:11434/v1` and `qwen2.5-coder:7b`.

If using Ollama, start `ollama serve` when the service is not already running. In a separate terminal, download the configured model:

```sh
ollama pull qwen2.5-coder:7b
```

For OpenRouter, add your key to a `.env` file in the directory where you will run TSUKA:

```dotenv
OPENROUTER_API_KEY=your_key_here
```

Launch TSUKA, then use `/provider` to select the backend and `/models` to select a model.

### 3. Open a workspace

Run TSUKA from the directory you want the agents to work in:

```sh
cd path/to/your/project
tsuka --tui
```

Use `tsuka --cli` for the line-based REPL. Running `tsuka` without a flag uses the configured `defaultUi`.

Start with a small request, such as “Read this project and explain its entry points.” Use `/tools` to inspect the available tools and `/help` for the commands supported by the current interface.

## Working with agents

A character combines one or more **roles**, which define its instructions and available tools, with a **trait**, which defines its communication style. Select a character with `/agent` and give it a task in ordinary language. Agents are instructed to respond in the language you use.

For work involving multiple agents:

| Command | Purpose |
|---|---|
| `/team` | Choose a predefined team and run a collaborative task. |
| `/goal <objective>` | Ask the orchestrator to plan and coordinate a task across agents. |
| `/call` | Bring several agents into a structured discussion. |

Teams support round-robin, pipeline, orchestrated, and hybrid execution. Workflow runs share a temporary blackboard; persistent memory retains information across sessions. Parallel goal execution is optional and uses staged workspaces with conflict detection when changes are merged.

See [multi-agent workflows](docs/multi-agent.md) for syntax and execution modes, or [practical examples](docs/use-cases.md) for task ideas.

## Configuration and customization

The installation directory is the default **application home**; `TSUKA_HOME` can override it. The working directory is the default **workspace** for file tools, unless `workspaceRoot` is configured.

| File or directory | Purpose |
|---|---|
| `.tsuka/config.json` in the workspace, or `tsuka.config.json` in the application home as fallback | Active provider, model overrides, UI, execution limits, and optional features. |
| `providers.json` | Provider endpoints, default models, and API-key environment variable names. |
| `.env` | Credentials, loaded from the application home, then workspace `.tsuka/.env`, then workspace `.env`, with later files taking precedence. |
| `characters/`, `roles/`, `traits/`, `teams/` | Agent definitions and team compositions. |

See [the example configuration](tsuka.config.json.example) for available settings. Use `/provider` and `/models` to change the active backend interactively, and `/benchmark` to evaluate a model's tool-calling capabilities.

To create a project-local set of agent definitions, run one of these commands in the workspace:

```sh
tsuka init --preset core
tsuka init --preset full
tsuka init --preset core --pack osint,devops
```

These are alternative initializations. Running `tsuka init` alone opens the setup wizard. Local assets and configuration under `.tsuka/` take precedence when present; otherwise the runtime falls back to the application home's `tsuka.config.json`.

## Tools and extensions

Built-in tools cover file operations, shell commands, web search and browsing, persistent memory, static code auditing, and agent coordination. The active set depends on the selected roles, model capability tier, and configuration.

TSUKA discovers native tool implementations through its registry and supports external **MCP stdio servers**. Memory and LLM providers expose contracts so their implementations can be replaced without changing the agent loop.

- [MCP integration](docs/mcp.md): connect external servers and expose their tools.
- [Web search backends](docs/web-search-backends.md): configure search providers.
- [Tool self-authoring](docs/self-authoring.md): enable agents to create executable tools. This feature is off by default and requires dangerous-operation approval.

## Permissions and boundaries

Native file tools enforce workspace confinement. Tool execution uses `SAFE`, `RESTRICTED`, and `DANGEROUS` risk levels, with approval requirements determined by the operation and session permissions.

Shell commands and external MCP servers can act with the permissions of their host process. Workspace file checks do not turn those processes into an operating-system sandbox.

Read [security and permissions](docs/security.md) for the policies and their limits.

## Development

```sh
npm run dev -- --cli
npm run tui
```

Before submitting a change, run all three checks:

```sh
npm test
npm run build
npm run typecheck
```

The test runner isolates memory and workflow logs in temporary directories. Tests use mocked backends rather than requiring a live model.

| Directory | Responsibility |
|---|---|
| `src/core/` | Agent loop, providers, memory, configuration, and workflow state. |
| `src/tools/` | Tool registry and implementations. |
| `src/safety/` | Permissions and execution policies. |
| `src/cli/` | REPL, commands, and terminal output. |
| `src/tui/` | Full-screen interface and interaction handling. |
| `tests/` | Regression tests. |

Read [AGENTS.md](AGENTS.md) for contributor rules and [the architecture guide](docs/architecture.md) for subsystem contracts.

## Further reading

The [documentation index](docs/README.md) brings together the operational and educational guides. Start with [building an agent harness](docs/educational-guide.md) for a guided tour, [memory](docs/memory.md) for state and retention, or [capability benchmarking](docs/benchmark.md) for model evaluation.

TSUKA is released under the [MIT License](LICENSE).
