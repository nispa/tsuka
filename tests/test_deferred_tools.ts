/**
 * Tests for T14.14 — Deferred tool schemas (`coreTools` + `load_tools`).
 *
 * What the task promises, and what is verified here:
 *  1. `resolveToolSet` (src/core/toolSet.ts) splits a role's allowedTools into an
 *     active set (full schema on every round) and a deferred one (name only in the
 *     prompt). A role WITHOUT `coreTools` behaves exactly as before: everything
 *     active, no `load_tools` offered — the change must be opt-in per role.
 *  2. The security perimeter never widens: `coreTools` naming a tool the role does
 *     not allow does not grant it, and `Agent.activateTools` refuses any name that
 *     was not declared deferred.
 *  3. End to end through the real ReAct loop: the first request carries no schema
 *     for a deferred tool, `load_tools` activates it, and the NEXT request carries
 *     its full schema and can execute it.
 *  4. `loadSystemPrompt` advertises deferred tools by name only (never their
 *     description or parameters), and — for a model without measured native
 *     function calling — the textual "Available tools" list is names only, since
 *     the descriptions already travel in the `tools` array of every request.
 *  5. Regression guard: the escalation schemas expose real parameters. They used
 *     the key "schema" instead of "parameters", so `loadToolSchema` fell back to an
 *     empty object and the model saw request_goal / request_team / request_call as
 *     parameterless. The legacy key is now accepted as an alias.
 *
 * Isolated run: npx tsx tests/test_deferred_tools.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import { resolveToolSet, LOAD_TOOLS_TOOL } from '../src/core/toolSet';
import { ToolRegistry, loadToolSchema } from '../src/tools/registry';
import { loadToolsTool } from '../src/tools/impl/loadTools';
import { Agent } from '../src/core/agent';
import { PermissionManager } from '../src/safety/permissions';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { loadSystemPrompt, loadRole, RoleConfig, TraitConfig } from '../src/cli/shared';
import { homePath } from '../src/core/apphome';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

const fakeTrait: TraitConfig = { name: 't', displayName: 'T', description: 't', prompt: 'neutral style' };

async function main() {
  console.log('=== Test deferred tool schemas (T14.14) ===\n');

  // ════════════════════════════════════════════════════════════════
  // Group A — resolveToolSet, pure split logic
  // ════════════════════════════════════════════════════════════════
  {
    const plainRole = { allowedTools: ['read_file', 'write_file', 'spawn_agent'] };
    const plain = resolveToolSet(plainRole, { enabled: true });
    check('A1a', JSON.stringify(plain.active) === JSON.stringify(plainRole.allowedTools),
      'role without coreTools: every allowed tool stays active (behaviour identical to before T14.14)');
    check('A1b', plain.deferred.length === 0 && !plain.active.includes(LOAD_TOOLS_TOOL),
      'role without coreTools: nothing deferred and no load_tools added — no unrequested cost');

    const splitRole = {
      allowedTools: ['read_file', 'write_file', 'spawn_agent', 'web_search'],
      coreTools: ['read_file', 'write_file']
    };
    const split = resolveToolSet(splitRole, { enabled: true });
    check('A2a', JSON.stringify(split.active) === JSON.stringify(['read_file', 'write_file', LOAD_TOOLS_TOOL]),
      `role with coreTools: active set is core + load_tools (${split.active.join(', ')})`);
    check('A2b', JSON.stringify([...split.deferred].sort()) === JSON.stringify(['spawn_agent', 'web_search']),
      'the remaining allowed tools become deferred, none is lost');

    const sneaky = resolveToolSet(
      { allowedTools: ['read_file'], coreTools: ['read_file', 'execute_command'] },
      { enabled: true }
    );
    check('A3', !sneaky.active.includes('execute_command') && !sneaky.deferred.includes('execute_command'),
      'coreTools naming a tool outside allowedTools does not grant it: the role stays the permission perimeter');

    const withContext = resolveToolSet(splitRole, { enabled: true, alwaysActive: ['report_status', 'post_note'] });
    check('A4a', withContext.active.includes('report_status') && withContext.active.includes('post_note'),
      'tools granted by the calling context (team protocol, blackboard) are always active');
    check('A4b', !withContext.deferred.includes('report_status') && !withContext.deferred.includes('post_note'),
      'context tools are never deferred: the model is ordered to call them, it must not have to load them first');

    const disabled = resolveToolSet(splitRole, { enabled: false });
    check('A5', disabled.deferred.length === 0 && disabled.active.length === splitRole.allowedTools.length,
      'deferredToolsEnabled=false restores the pre-T14.14 behaviour exactly (kill switch)');

    const allCore = resolveToolSet(
      { allowedTools: ['read_file', 'write_file'], coreTools: ['read_file', 'write_file'] },
      { enabled: true }
    );
    check('A6', allCore.deferred.length === 0 && !allCore.active.includes(LOAD_TOOLS_TOOL),
      'coreTools covering every allowed tool leaves nothing to defer, so load_tools is not offered');
  }

  // ════════════════════════════════════════════════════════════════
  // Group B — Agent.activateTools (ToolSetController contract)
  // ════════════════════════════════════════════════════════════════
  {
    const agent = new Agent(
      new MockLLMProvider([]), new ToolRegistry(), new PermissionManager(), 'sys', ['read_file', LOAD_TOOLS_TOOL]
    );
    agent.setDeferredTools(['spawn_agent', 'web_search']);

    const first = agent.activateTools(['spawn_agent']);
    check('B1a', first.activated.length === 1 && first.activated[0] === 'spawn_agent',
      'a deferred tool is reported as activated');
    check('B1b', (agent.getAllowedTools() || []).includes('spawn_agent'),
      'the activated tool enters the active set: from the next round its schema travels with the request');
    check('B1c', !agent.getDeferredTools().includes('spawn_agent') && agent.getDeferredTools().includes('web_search'),
      'it leaves the deferred list, the others stay there');

    const second = agent.activateTools(['spawn_agent']);
    check('B2a', second.alreadyActive.length === 1 && second.activated.length === 0,
      'activating it twice reports it as already active instead of activating it again');
    check('B2b', (agent.getAllowedTools() || []).filter((n) => n === 'spawn_agent').length === 1,
      'no duplicate entry in the active set');

    const before = JSON.stringify(agent.getAllowedTools());
    const denied = agent.activateTools(['execute_command']);
    check('B3a', denied.unknown.length === 1 && denied.activated.length === 0,
      'a tool the role never allowed cannot be activated: reported as unavailable');
    check('B3b', JSON.stringify(agent.getAllowedTools()) === before,
      'and the active set is untouched — load_tools is not a privilege escalation path');
  }

  // ════════════════════════════════════════════════════════════════
  // Group C — end to end in the real ReAct loop
  // ════════════════════════════════════════════════════════════════
  {
    const HEAVY = 'probe_t1414_heavy_tool';
    const CORE = 'probe_t1414_core_tool';

    const registry = new ToolRegistry();
    registry.register({ name: CORE, riskLevel: 'SAFE', execute: async () => 'core-ok' });
    registry.register({ name: HEAVY, riskLevel: 'SAFE', execute: async () => 'heavy-ok' });
    registry.register(loadToolsTool);

    const toolSet = resolveToolSet({ allowedTools: [CORE, HEAVY], coreTools: [CORE] }, { enabled: true });
    check('C0', toolSet.deferred.includes(HEAVY) && toolSet.active.includes(LOAD_TOOLS_TOOL),
      'precondition: the heavy tool is deferred and load_tools is offered');

    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall(LOAD_TOOLS_TOOL, { names: [HEAVY] })] },
      { toolCalls: [mockToolCall(HEAVY, {})] },
      { content: 'done' }
    ]);
    const agent = new Agent(provider, registry, new PermissionManager(), 'sys', toolSet.active);
    agent.setDeferredTools(toolSet.deferred);

    const answer = await agent.run('do the job');

    const round1 = (provider.callLog[0].tools || []).map((t: any) => t.function.name);
    const round2 = (provider.callLog[1].tools || []).map((t: any) => t.function.name);

    check('C1', !round1.includes(HEAVY) && round1.includes(CORE) && round1.includes(LOAD_TOOLS_TOOL),
      `first request: the deferred schema is NOT sent (tools: ${round1.join(', ')}) — this is the token saving`);
    check('C2', round2.includes(HEAVY),
      `after load_tools the very next request carries the full schema (tools: ${round2.join(', ')})`);

    const heavyResult = agent.getMessages().find((m) => m.role === 'tool' && m.name === HEAVY);
    check('C3', heavyResult?.content === 'heavy-ok',
      'and the tool really executes: deferring changes when the schema is sent, never what the tool does');
    check('C4', answer === 'done', 'the turn completes normally through the deferral round trip');

    const loadResult = agent.getMessages().find((m) => m.role === 'tool' && m.name === LOAD_TOOLS_TOOL);
    check('C5', typeof loadResult?.content === 'string' && loadResult.content.includes(HEAVY),
      'load_tools reports back which tools it activated, so the model knows what it may call next');

    // A model guessing a name outside its role must get a usable answer, not a dead turn.
    const provider2 = new MockLLMProvider([
      { toolCalls: [mockToolCall(LOAD_TOOLS_TOOL, { names: ['nonexistent_tool_xyz'] })] },
      { content: 'gave up' }
    ]);
    const agent2 = new Agent(provider2, registry, new PermissionManager(), 'sys', toolSet.active);
    agent2.setDeferredTools(toolSet.deferred);
    await agent2.run('load something impossible');
    const denied = agent2.getMessages().find((m) => m.role === 'tool' && m.name === LOAD_TOOLS_TOOL);
    check('C6', typeof denied?.content === 'string' && denied.content.includes(HEAVY),
      'asking for an unavailable tool answers with the list of loadable ones instead of failing the turn');
  }

  // ════════════════════════════════════════════════════════════════
  // Group D — loadSystemPrompt: names in the prompt, schemas out of it
  // ════════════════════════════════════════════════════════════════
  {
    const DEFERRED_NAME = 'probe_t1414_prompt_deferred';
    const registry = new ToolRegistry();
    registry.register({ name: 'read_file', riskLevel: 'SAFE', execute: async () => 'ok' });
    registry.register({ name: DEFERRED_NAME, riskLevel: 'SAFE', execute: async () => 'ok' });
    registry.register(loadToolsTool);

    const role: RoleConfig = {
      name: 'probe', displayName: 'Probe', description: 'p',
      systemPrompt: 'You are a test.',
      allowedTools: ['read_file', DEFERRED_NAME],
      coreTools: ['read_file']
    };

    // Never-profiled model → hasNativeFunctionCalling is false → the textual list is written.
    const prompt = loadSystemPrompt(role, fakeTrait, '__t1414_unprofiled__', registry, null);

    check('D1', prompt.includes(DEFERRED_NAME) && prompt.includes('load_tools'),
      'the deferred tool is advertised by name, together with the way to load it');

    const readFileDescription = loadToolSchema('read_file').description;
    check('D2a', readFileDescription.length > 40,
      `precondition: read_file has a real description (${readFileDescription.length} chars)`);
    check('D2b', prompt.includes('read_file') && !prompt.includes(readFileDescription),
      'the textual "Available tools" list is names only: descriptions already travel in the `tools` array, writing them here bills them twice');

    const promptNoDefer = loadSystemPrompt(
      { ...role, coreTools: undefined }, fakeTrait, '__t1414_unprofiled__', registry, null
    );
    check('D3', !promptNoDefer.includes('available on demand'),
      'a role without coreTools gets no deferral section at all: no prompt change for the roles that did not opt in');
  }

  // ════════════════════════════════════════════════════════════════
  // Group E — escalation schemas really expose their parameters
  // ════════════════════════════════════════════════════════════════
  {
    const expectations: Array<[string, string[]]> = [
      ['request_goal', ['goal', 'reason']],
      ['request_team', ['task', 'reason']],
      ['request_call', ['topic', 'reason']]
    ];
    for (const [name, fields] of expectations) {
      const schema = loadToolSchema(name).schema;
      const props = Object.keys(schema?.properties || {});
      check(`E1:${name}`, fields.every((f) => props.includes(f)),
        `${name} exposes its parameters (${props.join(', ') || 'NONE'}) — before the fix the model received an empty object and had to guess them`);
    }

    // The legacy "schema" key must keep working for hand-written tool schemas.
    const legacyName = 'probe_t1414_legacy_key';
    const legacyDir = homePath('custom_tools_schemas');
    const legacyPath = path.join(legacyDir, `${legacyName}.json`);
    const dirExisted = fs.existsSync(legacyDir);
    try {
      if (!dirExisted) fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(legacyPath, JSON.stringify({
        name: legacyName,
        description: 'legacy key probe',
        schema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] }
      }), 'utf-8');
      const resolved = loadToolSchema(legacyName).schema;
      check('E2', Object.keys(resolved?.properties || {}).includes('target'),
        'a schema file using the legacy "schema" key still resolves its parameters (alias kept for user-written tools)');
    } finally {
      if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
      if (!dirExisted && fs.existsSync(legacyDir)) {
        try { fs.rmdirSync(legacyDir); } catch { /* directory not empty: leave it */ }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Group F — the shipped roles stay coherent with the split
  // ════════════════════════════════════════════════════════════════
  {
    for (const roleName of ['developer', 'sysadmin', 'architect', 'security_auditor', 'researcher']) {
      const role = loadRole(roleName);
      const set = resolveToolSet(role, { enabled: true });
      const covered = [...set.active.filter((n) => n !== LOAD_TOOLS_TOOL), ...set.deferred].sort();
      check(`F1:${roleName}`, JSON.stringify(covered) === JSON.stringify([...role.allowedTools].sort()),
        `${roleName}: active + deferred reproduce allowedTools exactly (${set.active.length - 1} core, ${set.deferred.length} deferred)`);
    }
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error in test:', err);
  process.exit(1);
});
