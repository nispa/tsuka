/** Regression tests for T23.6: canonical workspace jail and bounded recursion. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

function rejects(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-jail-canonical-home-'));
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-jail-canonical-'));
  const workspace = path.join(container, 'workspace');
  const sibling = path.join(container, 'workspace-sibling');
  const outside = path.join(container, 'outside');
  fs.mkdirSync(workspace);
  fs.mkdirSync(sibling);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'EXTERNAL_SECRET', 'utf8');
  fs.mkdirSync(path.join(workspace, 'real'));
  fs.writeFileSync(path.join(workspace, 'real', 'inside.txt'), 'INTERNAL_MARKER', 'utf8');

  process.env.TSUKA_HOME = tmpHome;
  fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(tmpHome, 'providers.json'));
  fs.writeFileSync(path.join(tmpHome, 'tsuka.config.json'), JSON.stringify({
    activeProvider: 'ollama',
    workspaceRoot: workspace,
    webSearch: { provider: 'duckduckgo' },
    activeRole: 'developer',
    activeTrait: 'professional',
    activeCharacter: 'custom'
  }), 'utf8');

  const { resolveSafePath, walkWorkspaceFiles } = await import('../src/tools/impl/utils');
  const { grepSearchTool } = await import('../src/tools/impl/grepSearch');
  const { auditCodeTool } = await import('../src/tools/impl/auditCode');
  const { listDirTool } = await import('../src/tools/impl/listDir');

  try {
    check('CJ.1', resolveSafePath(workspace) === fs.realpathSync(workspace), 'the workspace root itself is accepted');
    check('CJ.2', rejects(() => resolveSafePath(path.join(sibling, 'file.txt'))), 'a sibling with a similar prefix is rejected');
    check('CJ.3', rejects(() => resolveSafePath(path.join(workspace, '..', 'outside', 'secret.txt'))), 'lexical traversal is rejected');
    check('CJ.4', resolveSafePath(path.join(workspace, 'new', 'file.txt')).endsWith(path.join('new', 'file.txt')), 'a new destination under a safe ancestor is accepted');

    const externalLink = path.join(workspace, 'external-link');
    const internalLink = path.join(workspace, 'internal-link');
    const cycleLink = path.join(workspace, 'real', 'cycle');
    fs.symlinkSync(outside, externalLink, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(path.join(workspace, 'real'), internalLink, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(workspace, cycleLink, process.platform === 'win32' ? 'junction' : 'dir');

    check('CJ.5', rejects(() => resolveSafePath(externalLink)), 'an external directory link is rejected');
    check('CJ.6', rejects(() => resolveSafePath(path.join(externalLink, 'secret.txt'))), 'a file reached through an external link is rejected');
    check('CJ.7', rejects(() => resolveSafePath(path.join(externalLink, 'new.txt'))), 'a new file below an external link is rejected');
    check('CJ.8', resolveSafePath(path.join(internalLink, 'inside.txt')) === fs.realpathSync(path.join(workspace, 'real', 'inside.txt')), 'an internal link resolves to its canonical in-workspace target');

    const walk = walkWorkspaceFiles(workspace);
    check('CJ.9', walk.files.length === 1 && walk.blockedLinks === 1, 'recursive walking blocks the external link and deduplicates internal cycles');

    const grep = await grepSearchTool.execute({ query: 'EXTERNAL_SECRET', path: workspace });
    check('CJ.10', /No matches found/.test(String(grep)), 'grep_search cannot read through the external link');
    const audit = await auditCodeTool.execute({ targetPath: workspace });
    check('CJ.11', !String(audit).includes('EXTERNAL_SECRET') && String(audit).includes('blocked links=1'), 'audit_code reports the blocked link without scanning outside');
    const listing = await listDirTool.execute({ path: workspace });
    check('CJ.12', String(listing).includes('external-link') && String(listing).includes('blocked'), 'list_dir exposes a blocked link without following it');

    const bounded = walkWorkspaceFiles(workspace, { maxDepth: 0 });
    check('CJ.13', bounded.truncatedReason === 'depth', 'recursive scans stop at the configured depth bound');
  } finally {
    delete process.env.TSUKA_HOME;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(container, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
