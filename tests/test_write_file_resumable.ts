/** Regression coverage for transactional, resumable write_file mode. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWriteFileTool } from '../src/tools/impl/writeFile';
import { FileResumableWriteStore } from '../src/tools/impl/resumableWrite';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

async function rejects(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  console.log('=== Resumable write_file transaction tests ===\n');
  const root = fs.mkdtempSync(path.join(process.cwd(), '.smoke-resumable-write-'));
  const target = path.join(root, 'nested', 'document.txt');
  const tool = createWriteFileTool();

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'original destination', 'utf8');

    const first = await tool.execute({ path: target, content: 'café', offset: 0 });
    check('RW.1', fs.readFileSync(target, 'utf8') === 'original destination' && /offset 5/.test(first),
      'the first staged Unicode chunk leaves the destination untouched and returns a UTF-8 byte offset');

    const wrongOffsetRejected = await rejects(() => tool.execute({ path: target, content: '!', offset: 4 }));
    const duplicateRejected = await rejects(() => tool.execute({ path: target, content: '!', offset: 0 }));
    check('RW.2', wrongOffsetRejected && duplicateRejected && fs.readFileSync(target, 'utf8') === 'original destination',
      'out-of-order and duplicate chunks are rejected without changing the destination');

    const final = await tool.execute({ path: target, content: '!', offset: 5, complete: true });
    check('RW.3', /committed successfully/.test(final) && fs.readFileSync(target, 'utf8') === 'café!',
      'the final chunk atomically commits the full staged content');

    await tool.execute({ path: target, content: 'legacy overwrite' });
    await tool.execute({ path: target, content: ' + append', append: true });
    check('RW.4', fs.readFileSync(target, 'utf8') === 'legacy overwrite + append',
      'legacy overwrite and append calls remain backward compatible');

    const outside = path.join(os.tmpdir(), `tsuka-resumable-outside-${process.pid}.txt`);
    const jailRejected = await rejects(() => tool.execute({ path: outside, content: 'nope', offset: 0 }));
    check('RW.5', jailRejected && !fs.existsSync(outside), 'resumable mode honors the workspace jail before allocating staging');

    let now = 0;
    const cleanupStore = new FileResumableWriteStore({ now: () => now, staleMs: 10 });
    const cleanupTool = createWriteFileTool(cleanupStore);
    const abandoned = path.join(root, 'abandoned.txt');
    fs.writeFileSync(abandoned, 'preserve me', 'utf8');
    await cleanupTool.execute({ path: abandoned, content: 'incomplete', offset: 0 });
    now = 11;
    const removed = cleanupStore.cleanup(abandoned);
    check('RW.6', removed >= 1 && fs.readFileSync(abandoned, 'utf8') === 'preserve me',
      'bounded stale-session cleanup removes staging data without corrupting the destination');

    const incompatibleModeRejected = await rejects(() => tool.execute({ path: target, content: 'bad', append: false, offset: 0 }));
    check('RW.7', incompatibleModeRejected && fs.readFileSync(target, 'utf8') === 'legacy overwrite + append',
      'legacy append parameters cannot silently alter resumable transaction semantics');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal resumable write test error:', error);
  process.exit(1);
});
