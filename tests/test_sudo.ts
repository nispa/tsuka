import './isolateMemory';
import { strict as assert } from 'assert';
import { PermissionManager } from '../src/safety/permissions';
import { controlSudo } from '../src/core/sudoControl';
import { ToolRegistry } from '../src/tools/registry';
import { Agent } from '../src/core/agent';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { findCommand } from '../src/tui/commands/registry';

async function main(): Promise<void> {
  const permissions = new PermissionManager();
  assert.equal(permissions.isSudo(), false);
  assert.match(controlSudo(permissions, ''), /OFF/);
  assert.match(controlSudo(permissions, 'invalid'), /Usage/);
  assert.equal(permissions.isSudo(), false);
  controlSudo(permissions, 'on');
  assert.equal(await permissions.checkPermission('execute_command', 'arbitrary script', 'DANGEROUS'), true);
  assert.equal(await permissions.checkPermission('delete_file', 'file', 'RESTRICTED'), false);
  assert.equal(await permissions.checkPermission('create_tool', 'code', 'DANGEROUS'), false);

  let executions = 0;
  const registry = new ToolRegistry();
  registry.register({ name: 'execute_command', riskLevel: 'DANGEROUS', execute: async () => { executions++; return 'ok'; } });
  const provider = new MockLLMProvider([
    { toolCalls: [mockToolCall('execute_command', { command: 'arbitrary script' })] },
    { content: 'done' },
    { content: 'normal' },
  ]);
  const agent = new Agent(provider, registry, permissions, 'Use tools.', []);
  await agent.run('execute');
  assert.equal(executions, 1);
  assert(provider.callLog[0].tools?.some(t => t.function.name === 'execute_command'));
  assert(provider.callLog[0].messages.some(m => String(m.content).includes('Session sudo is ON')));
  assert(!agent.getMessages().some(m => String(m.content).includes('Session sudo is ON')));
  controlSudo(permissions, 'off');
  await agent.run('continue normally');
  assert(!provider.callLog[2].tools?.some(t => t.function.name === 'execute_command'));
  assert(!provider.callLog[2].messages.some(m => String(m.content).includes('Session sudo is ON')));
  assert.equal(await permissions.checkPermission('execute_command', 'arbitrary script', 'DANGEROUS'), false);
  controlSudo(permissions, 'on');
  permissions.resetSession();
  assert.equal(permissions.isSudo(), false);

  // Revocation must apply to a command waiting behind another permission prompt.
  let release!: (decision: 'no') => void;
  let started!: () => void;
  const prompting = new Promise<void>(resolve => { started = resolve; });
  let prompts = 0;
  const queued = new PermissionManager(async () => {
    prompts++;
    if (prompts === 1) {
      started();
      return new Promise<'no'>(resolve => { release = resolve; });
    }
    return 'no';
  });
  const first = queued.checkPermission('delete_file', 'file', 'RESTRICTED');
  await prompting;
  queued.setSudo(true);
  const second = queued.checkPermission('execute_command', 'script', 'DANGEROUS');
  queued.setSudo(false);
  release('no');
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(prompts, 2);

  const messages: string[] = [];
  await findCommand('/sudo')!.run({ arg: 'on', cliContext: () => ({ permissionManager: permissions }),
    store: { addMessage: (m: { content: string }) => messages.push(m.content) } } as any);
  assert.equal(permissions.isSudo(), true);
  assert.match(messages[0], /SUDO ON/);
  permissions.resetSession();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
