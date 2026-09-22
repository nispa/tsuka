import './isolateMemory';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PermissionManager, SUDO_AUTHORIZED_TOOLS } from '../src/safety/permissions';
import { controlSudo } from '../src/core/sudoControl';
import { ToolRegistry } from '../src/tools/registry';
import { Agent } from '../src/core/agent';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { findCommand } from '../src/tui/commands/registry';
import { withWorkspaceOverride } from '../src/tools/impl/utils';
import { createWriteFileTool } from '../src/tools/impl/writeFile';
import { editFileTool } from '../src/tools/impl/editFile';
import { deleteFileTool } from '../src/tools/impl/deleteFile';

async function main(): Promise<void> {
  const permissions = new PermissionManager();
  assert.equal(permissions.isSudo(), false);
  assert.deepEqual(permissions.getSudoTools(), SUDO_AUTHORIZED_TOOLS);
  assert.match(controlSudo(permissions, ''), /OFF/);
  assert.match(controlSudo(permissions, 'invalid'), /Usage/);
  assert.equal(permissions.isSudo(), false);

  const onMsg = controlSudo(permissions, 'on');
  assert.match(onMsg, /SUDO ON/);
  assert.match(onMsg, /write\/edit/);
  assert.equal(await permissions.checkPermission('execute_command', 'arbitrary script', 'DANGEROUS'), true);
  assert.equal(await permissions.checkPermission('write_file', 'file.txt', 'RESTRICTED'), true);
  assert.equal(await permissions.checkPermission('edit_file', 'file.txt', 'RESTRICTED'), true);
  assert.equal(await permissions.checkPermission('delete_file', 'file.txt', 'RESTRICTED'), false);
  assert.equal(await permissions.checkPermission('create_tool', 'code', 'DANGEROUS'), false);

  let executions = 0;
  const registry = new ToolRegistry();
  registry.register({ name: 'execute_command', riskLevel: 'DANGEROUS', execute: async () => { executions++; return 'ok'; } });
  registry.register({ name: 'write_file', riskLevel: 'RESTRICTED', execute: async () => { return 'ok'; } });
  registry.register({ name: 'edit_file', riskLevel: 'RESTRICTED', execute: async () => { return 'ok'; } });
  registry.register({ name: 'delete_file', riskLevel: 'RESTRICTED', execute: async () => { return 'ok'; } });

  const provider = new MockLLMProvider([
    { toolCalls: [mockToolCall('execute_command', { command: 'arbitrary script' })] },
    { content: 'done' },
    { content: 'normal' },
  ]);
  const agent = new Agent(provider, registry, permissions, 'Use tools.', []);
  await agent.run('execute');
  assert.equal(executions, 1);
  assert(provider.callLog[0].tools?.some(t => t.function.name === 'execute_command'));
  assert(provider.callLog[0].tools?.some(t => t.function.name === 'write_file'));
  assert(provider.callLog[0].tools?.some(t => t.function.name === 'edit_file'));
  assert(!provider.callLog[0].tools?.some(t => t.function.name === 'delete_file'));
  assert(provider.callLog[0].messages.some(m => String(m.content).includes('Session sudo is ON') && String(m.content).includes('write_file') && String(m.content).includes('delete_file still requires explicit confirmation')));
  assert(!agent.getMessages().some(m => String(m.content).includes('Session sudo is ON')));

  controlSudo(permissions, 'off');
  await agent.run('continue normally');
  assert(!provider.callLog[2].tools?.some(t => t.function.name === 'execute_command'));
  assert(!provider.callLog[2].tools?.some(t => t.function.name === 'write_file'));
  assert(!provider.callLog[2].tools?.some(t => t.function.name === 'edit_file'));
  assert(!provider.callLog[2].messages.some(m => String(m.content).includes('Session sudo is ON')));
  assert.equal(await permissions.checkPermission('execute_command', 'arbitrary script', 'DANGEROUS'), false);
  assert.equal(await permissions.checkPermission('write_file', 'file.txt', 'RESTRICTED'), false);
  assert.equal(await permissions.checkPermission('edit_file', 'file.txt', 'RESTRICTED'), false);

  controlSudo(permissions, 'on');
  permissions.resetSession();
  assert.equal(permissions.isSudo(), false);

  // Revocation must apply to commands/files waiting behind another permission prompt.
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
  const third = queued.checkPermission('write_file', 'file.txt', 'RESTRICTED');
  queued.setSudo(false);
  release('no');
  assert.deepEqual(await Promise.all([first, second, third]), [false, false, false]);
  assert.equal(prompts, 3);

  const messages: string[] = [];
  await findCommand('/sudo')!.run({ arg: 'on', cliContext: () => ({ permissionManager: permissions }),
    store: { addMessage: (m: { content: string }) => messages.push(m.content) } } as any);
  assert.equal(permissions.isSudo(), true);
  assert.match(messages[0], /SUDO ON/);
  permissions.resetSession();

  // Test Workspace Jail with Sudo ON
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-sudo-ws-'));
  try {
    await withWorkspaceOverride(tmpDir, async () => {
      const fsRegistry = new ToolRegistry();
      fsRegistry.register(createWriteFileTool());
      fsRegistry.register(editFileTool);
      fsRegistry.register(deleteFileTool);

      const sudoPerms = new PermissionManager();
      sudoPerms.setSudo(true);

      // Write inside workspace: succeeds without prompt
      const writeRes = await fsRegistry.executeTool('write_file', { path: 'sample.txt', content: 'hello world' }, sudoPerms);
      assert.equal(writeRes.success, true);
      assert.equal(fs.readFileSync(path.join(tmpDir, 'sample.txt'), 'utf8'), 'hello world');

      // Edit inside workspace: succeeds without prompt
      const editRes = await fsRegistry.executeTool('edit_file', { path: 'sample.txt', targetContent: 'hello', replacementContent: 'welcome' }, sudoPerms);
      assert.equal(editRes.success, true);
      assert.equal(fs.readFileSync(path.join(tmpDir, 'sample.txt'), 'utf8'), 'welcome world');

      // Attempt write outside workspace: blocked by jail
      const jailWriteRes = await fsRegistry.executeTool('write_file', { path: '../escaped.txt', content: 'bad' }, sudoPerms);
      assert.equal(jailWriteRes.success, false);
      assert.match(jailWriteRes.output, /Access denied/);

      // Attempt edit outside workspace: blocked by jail
      const jailEditRes = await fsRegistry.executeTool('edit_file', { path: '../escaped.txt', targetContent: 'a', replacementContent: 'b' }, sudoPerms);
      assert.equal(jailEditRes.success, false);
      assert.match(jailEditRes.output, /Access denied/);

      // Delete file with sudo ON: requires confirmation, fails without handler
      const deleteResNoHandler = await fsRegistry.executeTool('delete_file', { path: 'sample.txt' }, sudoPerms);
      assert.equal(deleteResNoHandler.success, false);
      assert.match(deleteResNoHandler.output, /denied by user/);
      assert.equal(fs.existsSync(path.join(tmpDir, 'sample.txt')), true);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Test strict per-call confirmation for delete_file (even with allowAllWrite / always)
  {
    let deletePrompts = 0;
    const decisions: ('yes' | 'no' | 'always')[] = ['always', 'yes', 'no'];
    const deletePerms = new PermissionManager(async (req) => {
      if (req.toolName === 'delete_file') {
        deletePrompts++;
        return decisions.shift() ?? 'no';
      }
      return 'yes';
    });

    deletePerms.setAllowAllWrite(true);
    assert.equal(deletePerms.isAllowAllWrite(), true);

    // write_file is approved without prompt
    assert.equal(await deletePerms.checkPermission('write_file', 'doc.txt', 'RESTRICTED'), true);
    assert.equal(deletePrompts, 0);

    // First delete_file: prompt is shown even though allowAllWrite is true. User responds 'always'.
    const del1 = await deletePerms.checkPermission('delete_file', 'file1.txt', 'RESTRICTED');
    assert.equal(del1, true);
    assert.equal(deletePrompts, 1);

    // Second consecutive delete_file: MUST prompt again! 'always' does not bypass delete_file.
    const del2 = await deletePerms.checkPermission('delete_file', 'file2.txt', 'RESTRICTED');
    assert.equal(del2, true);
    assert.equal(deletePrompts, 2);

    // Third delete_file when handler returns 'no': fails closed
    const del3 = await deletePerms.checkPermission('delete_file', 'file3.txt', 'RESTRICTED');
    assert.equal(del3, false);
    assert.equal(deletePrompts, 3);
  }

  // Test CLI permission prompt handler options for delete_file vs other tools
  {
    const { createCliPermissionPromptHandler } = await import('../src/cli/permissionPrompt');
    const { InteractiveMenu } = await import('../src/cli/ui');
    const originalSelect = InteractiveMenu.select;
    let presentedOptions: Array<{ title: string; value: string }> = [];

    (InteractiveMenu as any).select = async (_title: string, options: any[], _initial: any) => {
      presentedOptions = options;
      return 'yes';
    };

    try {
      const cliHandler = createCliPermissionPromptHandler();

      // delete_file: only 'yes' and 'no' options presented
      await cliHandler({ toolName: 'delete_file', details: 'rm.txt', riskLevel: 'RESTRICTED' });
      assert.deepEqual(presentedOptions.map(o => o.value), ['yes', 'no']);

      // write_file: 'yes', 'no', 'always' options presented
      await cliHandler({ toolName: 'write_file', details: 'doc.txt', riskLevel: 'RESTRICTED' });
      assert.deepEqual(presentedOptions.map(o => o.value), ['yes', 'no', 'always']);
    } finally {
      InteractiveMenu.select = originalSelect;
    }
  }

  // Test TUI ModalKeyHandler ignores 'a' hotkey for delete_file
  {
    const { ModalKeyHandler } = await import('../src/tui/modals/modalKeyHandler');
    let resolvedValue: string | null = null;
    const deleteModal: any = {
      type: 'permission',
      permissionReq: {
        toolName: 'delete_file',
        details: 'rm.txt',
        riskLevel: 'RESTRICTED',
        resolve: (val: string) => { resolvedValue = val; },
      },
    };

    // Pressing 'a' on delete_file modal must NOT resolve to 'always'
    ModalKeyHandler.handleKey({ name: 'a', ctrl: false, meta: false, shift: false } as any, deleteModal, {} as any);
    assert.equal(resolvedValue, null);

    // Pressing 'y' must resolve
    ModalKeyHandler.handleKey({ name: 'y', ctrl: false, meta: false, shift: false } as any, deleteModal, {} as any);
    assert.equal(resolvedValue, 'yes');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
