# Tool Self-Authoring (`create_tool`)

<div align="right">
  <p>Leggi in <a href="self-authoring-it.md">Italiano</a></p>
</div>

Self-authoring lets an agent create a small JavaScript utility, describe its arguments with JSON Schema, and register it as a tool during the current session. It is an advanced capability and is disabled by default.

## Why it is opt-in

This security model follows findings from an **external security audit** received by the project. The audit identified that relying on `node:vm`, a blocklist, and the risk level claimed by generated code did not provide an adequate security boundary.

The controls are layered:

- `create_tool` and custom modules are not loaded by default;
- custom tool creation and execution are always `DANGEROUS`;
- generated code never runs inside TSUKA: validation and every call start a separate Node process under the permission model, with filesystem access only inside the workspace, no network, no child processes, no workers, no `eval`/`Function`, an empty environment (API keys never reach it), a heap ceiling, a timeout and a capped output;
- runtimes without that confinement (Node.js older than 25, which lacks `--allow-net`) refuse to run custom tools instead of running them unconfined.

Node documents its permission model as a safety belt for trusted code, **not** a sandbox against malicious code. The separate process keeps TSUKA intact and bounded (a crash, an infinite loop or a memory blow-up only ends the child) and removes the obvious escape routes, but it does not make hostile code safe. Use the capability only with models and requests you trust.

## 1. Enable self-authoring

Set the option explicitly in the project's `tsuka.config.json`:

```json
{
  "selfAuthoringEnabled": true
}
```

Restart TSUKA after changing the configuration. An absent or `false` value disables both `create_tool` and loading existing custom tools from disk.

The built-in roles that currently include `create_tool` in `allowedTools` are `developer`, `sysadmin`, and `game_designer`. Add it explicitly to the relevant file under `roles/` for another role.

This is an explicit project-level trust decision. A developer role, a request to improve TSUKA, or an agent detecting that it is working on the harness must never enable the capability automatically.

## 2. Ask the agent

You can describe the requirement without writing the payload yourself:

> Create a `count_lines` tool that accepts a workspace-relative file path and returns its line count.

If the model calls `create_tool`, TSUKA displays a `DANGEROUS` confirmation. Configuration makes the capability available; it does not replace security approval.

Treat creation as a review workflow, not as delegation of trust:

1. inspect the proposed body in the `DANGEROUS` prompt before allowing creation;
2. review the generated module and JSON Schema on disk;
3. test it in a controlled workspace;
4. only then add its name to a role's persistent `allowedTools` list.

Every later execution remains `DANGEROUS` and requires its own confirmation. Neither the configuration flag nor source review proves that the code is safe; they record the user's deliberate decision to expose and run an extension. Enabling self-authoring registers existing custom modules found on disk at startup without running them; each module runs, confined, only when called and confirmed. Review files already on disk before enabling it.

An equivalent call is:

```json
{
  "name": "count_lines",
  "description": "Counts the lines in a workspace file.",
  "parameters": {
    "type": "object",
    "properties": {
      "file": {
        "type": "string",
        "description": "Workspace-relative file path."
      }
    },
    "required": ["file"]
  },
  "executeBody": "const content = fs.readFileSync(args.file, 'utf8'); return String(content.split(/\\r?\\n/).length);",
  "global": false
}
```

The body receives `args`, `fs` (confined to the workspace by the child's permissions) and `path`, and must return a string. Nothing else can be required. `create_tool` also rejects bodies using `require`, dynamic imports, `eval`, `child_process`, `process` APIs or the `Function` constructor; the confinement does not depend on that check.

## 3. Persistence and availability

With `global: false` or omitted, TSUKA writes:

- `.tsuka/custom_tools/<name>.js`;
- `.tsuka/custom_tools_schemas/<name>.json`.

With `global: true`, it uses `TSUKA_HOME/custom_tools/` and `TSUKA_HOME/custom_tools_schemas/`. The tool is hot-registered, but the active role must still name it in `allowedTools` before an agent can call it.

To make it permanently available to a role, add its name to `allowedTools` in `roles/<role>.json`:

```json
{
  "allowedTools": [
    "count_lines"
  ]
}
```

Every loaded custom tool remains classified as `DANGEROUS`, regardless of what its module declares. Custom risk classifiers are ignored, so no custom module can downgrade an individual invocation to `SAFE` or `RESTRICTED`.

## 4. Disable and remove

To prevent new creations and loading custom tools:

```json
{
  "selfAuthoringEnabled": false
}
```

Restart TSUKA afterward. This does not delete existing files. To remove a tool permanently, carefully delete its module and schema from the local or global directories above and remove its name from `allowedTools`. When `create_tool` replaces an existing tool, it preserves the previous version under `tools_backup/`.

## 5. Guarantee boundaries

`DANGEROUS` confirmations, the confined child process, the blocklist, backups and schema validation are complementary defenses. The child process protects TSUKA and limits what a tool can reach, but it relies on Node's permission model, which is not designed against deliberately malicious code; stronger isolation would need an operating-system sandbox or container, which is not uniform across Windows, Linux and macOS. Leave self-authoring disabled when it is not needed.
