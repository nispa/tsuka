/** Regression tests for T23.3: strict write_file and edit_file mutation contracts. */
import * as fs from 'fs';
import * as path from 'path';
import { editFileTool } from '../src/tools/impl/editFile';
import { writeFileTool } from '../src/tools/impl/writeFile';

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

async function main(): Promise<void> {
  const filePath = path.resolve(process.cwd(), '.smoke-t23-3.txt');
  try {
    const invalidAppendValues: unknown[] = ['true', 'false', 1, 0, null];
    for (const [index, append] of invalidAppendValues.entries()) {
      fs.writeFileSync(filePath, 'original', 'utf8');
      let rejected = false;
      try {
        await writeFileTool.execute({ path: filePath, content: 'changed', append: append as any });
      } catch {
        rejected = true;
      }
      check(`MUT.${index + 1}`, rejected && fs.readFileSync(filePath, 'utf8') === 'original', `append=${JSON.stringify(append)} is rejected without mutation`);
    }

    fs.writeFileSync(filePath, 'alpha beta', 'utf8');
    for (const [index, targetContent] of ['', '   ', '\n\t'].entries()) {
      let rejected = false;
      try {
        await editFileTool.execute({ path: filePath, targetContent, replacementContent: 'x' });
      } catch {
        rejected = true;
      }
      check(`MUT.${invalidAppendValues.length + 1 + index}`, rejected && fs.readFileSync(filePath, 'utf8') === 'alpha beta', `targetContent=${JSON.stringify(targetContent)} is rejected without mutation`);
    }

    await editFileTool.execute({ path: filePath, targetContent: 'beta', replacementContent: '' });
    check('MUT.9', fs.readFileSync(filePath, 'utf8') === 'alpha ', 'an empty replacement still permits intentional deletion');
  } finally {
    try { fs.rmSync(filePath, { force: true }); } catch {}
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
