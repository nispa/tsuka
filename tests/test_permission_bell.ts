/**
 * Terminal bell on confirmation prompts.
 *
 * A DANGEROUS prompt rings the bell once the TUI modal is on screen; a RESTRICTED one never
 * does (writes are frequent, a bell on each would be ignored). The `permissionBell` config
 * defaults to on and an explicit `false` turns it off.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TuiStore } from '../src/tui/store';
import { TuiBridge } from '../src/tui/bridge';
import { PermissionManager, shouldRingPermissionBell } from '../src/safety/permissions';
import { ConfigManager } from '../src/core/config';
import { resolveConfigPath } from '../src/core/config/manager';

let passed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✔ ${name}`);
}

async function main(): Promise<void> {
  await test('policy: only DANGEROUS prompts ring', () => {
    assert.strictEqual(shouldRingPermissionBell('DANGEROUS'), true);
    assert.strictEqual(shouldRingPermissionBell('RESTRICTED'), false);
    assert.strictEqual(shouldRingPermissionBell('SAFE'), false);
  });

  await test('TuiBridge: bell rings with the DANGEROUS modal, not with RESTRICTED', async () => {
    const store = new TuiStore();
    const perm = new PermissionManager();
    let rings = 0;
    let modalOpenWhenRung = false;
    new TuiBridge(store, perm, {
      ringBell: () => {
        rings++;
        modalOpenWhenRung = store.getState().activeModal?.type === 'permission';
      },
    });

    const restricted = perm.checkPermission('write_file', 'notes.txt', 'RESTRICTED');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(rings, 0, 'RESTRICTED prompt stays silent');
    store.getState().activeModal?.permissionReq?.resolve('no');
    await restricted;

    const dangerous = perm.checkPermission('execute_command', 'rm -rf build', 'DANGEROUS');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(rings, 1, 'DANGEROUS prompt rings once');
    assert.ok(modalOpenWhenRung, 'the bell announces a modal already on screen');
    store.getState().activeModal?.permissionReq?.resolve('no');
    await dangerous;
  });

  await test('ConfigManager: permissionBell defaults to on, false disables it', () => {
    // Temporary TSUKA_HOME: the user's real tsuka.config.json is never read or written.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-bell-'));
    const previousHome = process.env.TSUKA_HOME;
    process.env.TSUKA_HOME = dir;
    try {
      fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(dir, 'providers.json'));
      const config = new ConfigManager();
      assert.strictEqual(config.isPermissionBellEnabled(), true);
      const file = resolveConfigPath();
      const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
      fs.writeFileSync(file, JSON.stringify({ ...saved, permissionBell: false }));
      config.load();
      assert.strictEqual(config.isPermissionBellEnabled(), false);
    } finally {
      if (previousHome === undefined) delete process.env.TSUKA_HOME;
      else process.env.TSUKA_HOME = previousHome;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log(`\n=== All ${passed} tests in test_permission_bell.ts passed cleanly! ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
