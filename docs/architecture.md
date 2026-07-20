# System Architecture 🏗️

This document describes the core design and dynamic mechanics of the TSUKA runtime, including file organization, plugin auto-discovery, model-adaptive tool filtering, and prompt generation.

---

## 📂 Core Folder Structure

```
harness/
├── characters/             # Character Presets JSON (maps Name -> Role + Trait)
├── roles/                  # Role & Skills JSON (defines allowedTools and systemPrompt)
├── traits/                 # Personality Traits JSON (defines conversational style prompts)
├── teams/                  # Collaborative Team JSON (defines workflow members)
├── tools_schemas/          # JSON schemas for Function Calling (descriptions & parameters)
├── docs/                   # System Documentation Portal (English)
├── src/
│   ├── cli/                # REPL Loop, commands, and interactive ANSI UI menus
│   ├── core/               # LLM Provider client, configuration manager, and agent loops
│   ├── safety/             # Permission manager and risk level definitions
│   └── tools/
│       ├── impl/           # Individual TS tool logic (read, write, search, shell, etc.)
│       ├── index.ts        # Dynamic plugin scanner and ESM importer
│       └── registry.ts     # In-memory tool registry and schema manager
```

---

## 🔌 Plugin Auto-Discovery (ESM Dynamic Imports)

The harness uses a procedural auto-discovery pattern to register tools at startup. In `src/tools/index.ts`:

1. It scans the `src/tools/impl/` directory for any module file.
2. It translates absolute Windows file paths to valid `file://` URLs using Node's native `pathToFileURL()` (preventing Windows absolute path ESM protocol errors).
3. It imports each file asynchronously using `await import()`.
4. It extracts any exported object matching the `Tool` interface and registers it in the `ToolRegistry`.

This allows developers to drop a new tool file into `impl/` and have it automatically registered without editing any imports or configuration registries.

---

## 🛡️ Model-Adaptive Tool Selection (Tier Pruning)

To prevent smaller local models (like 7B/9B parameters) from suffering from **Tool Overload** (which causes parameter hallucinations and syntax errors), the registry dynamically filters the tools sent to the LLM based on its parameter size.

We define three model classes (Tiers):
* **`SMALL`** (Models $\le$ 12B, e.g., `qwenpaw-9b`): Can access **9 tools** (file system read/write, web search, browsing, diagnostics). The dangerous `execute_command` tool is pruned to protect the system.
* **`MEDIUM`** (Models 13B to 35B, e.g., `gemma:26b`): Can access **all 10 tools** (including `execute_command`).
* **`LARGE`** (Models $\ge$ 70B or Cloud Models like GPT-4 / Claude): Can access **all 10 tools**.

The active model name is checked against regular expressions (e.g., matching `(\d+)b` to extract the parameter count) to assign its Tier dynamically at runtime.

---

## ⚙️ Dynamic Prompt Assembly

The final System Prompt passed to the LLM during chat requests is assembled dynamically for each request. It combines:

1. **Role Base Prompt**: Extracted from `roles/<active_role>.json` (defines the task rules).
2. **Attitude Prompt**: Extracted from `traits/<active_trait>.json` (defines the character style).
3. **General Safety Guidelines**: Standard precautions (incremental writes, PowerShell care).
4. **Dynamic Tool Guidelines**: Concatenates names and descriptions of only the tools that are both **allowed for the active role** and **compatible with the model's tier**.

This keeps the prompt context highly focused, preventing the model from hallucinating tool usage instructions or wasting token capacity on inactive capabilities.
