import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildWiki, rewriteLink, extractSections } from '../scripts/buildWiki';

const SLUG = 'nispa/tsuka';

function inTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-wiki-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('GitHub wiki generator', () => {

  it('turns repository paths into absolute blob links', () => {
    assert.strictEqual(
      rewriteLink('../src/core/logSink.ts', 'docs/architecture.md', SLUG),
      'https://github.com/nispa/tsuka/blob/main/src/core/logSink.ts'
    );
    assert.strictEqual(
      rewriteLink('presets/packs/', 'README.md', SLUG),
      'https://github.com/nispa/tsuka/tree/main/presets/packs'
    );
    assert.strictEqual(
      rewriteLink('LICENSE', 'README.md', SLUG),
      'https://github.com/nispa/tsuka/blob/main/LICENSE'
    );
  });

  it('turns cross-references between documents into wiki pages', () => {
    assert.strictEqual(rewriteLink('multi-agent.md', 'docs/architecture.md', SLUG), 'Multi-Agent-Workflows');
    assert.strictEqual(rewriteLink('architecture-it.md', 'docs/README-it.md', SLUG), 'Architettura');
    assert.strictEqual(rewriteLink('security.md#tiers', 'docs/README.md', SLUG), 'Security#tiers');
  });

  it('leaves external links and anchors untouched', () => {
    assert.strictEqual(rewriteLink('https://ollama.com/', 'README.md', SLUG), 'https://ollama.com/');
    assert.strictEqual(rewriteLink('#-highlights', 'README.md', SLUG), '#-highlights');
  });

  it('recovers editor-made local absolute paths', () => {
    assert.strictEqual(
      rewriteLink('file:///f:/progetti_ai/harness/src/core/loop.ts', 'docs/multi-agent-it.md', SLUG),
      'https://github.com/nispa/tsuka/blob/main/src/core/loop.ts'
    );
  });

  it('extracts the requested sections in the requested order', () => {
    const markdown = ['# Title', '', '## One', 'a', '', '## Two', 'b', '', '## Three', 'c'].join('\n');
    assert.strictEqual(extractSections(markdown, ['## Two']), '## Two\nb');
    assert.strictEqual(extractSections(markdown, ['## Three', '## One']), '## Three\nc\n\n## One\na');
    assert.throws(() => extractSections(markdown, ['## Missing']), /not found/);
  });

  it('writes every page plus the sidebar and the footer', () => inTempDir((dir) => {
    const written = buildWiki(dir, SLUG);

    assert.ok(written.includes('Home.md'), 'The landing page is mandatory on a GitHub wiki');
    assert.ok(written.includes('_Sidebar.md') && written.includes('_Footer.md'));
    assert.ok(written.includes('Architecture.md') && written.includes('Architettura.md'), 'Both languages are published');

    for (const file of written) {
      assert.ok(fs.statSync(path.join(dir, file)).size > 0, `${file} must not be empty`);
    }
  }));

  it('leaves no link that would break once out of the repository', () => inTempDir((dir) => {
    for (const file of buildWiki(dir, SLUG)) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const broken = content.match(/\]\((\.\.?\/|file:\/\/|docs\/|src\/)[^)]*\)/g);
      assert.strictEqual(broken, null, `${file} keeps repository-relative links: ${broken?.join(', ')}`);
    }
  }));

  it('derives the commands page from the command table', () => inTempDir((dir) => {
    buildWiki(dir, SLUG);
    const page = fs.readFileSync(path.join(dir, 'Slash-Commands.md'), 'utf-8');

    assert.ok(page.includes('| `/export` | `/save` |'), 'Aliases are documented next to their command');
    assert.ok(page.includes('`/goal`') && page.includes('`/team`'));
    assert.ok(!page.includes('| `/blackboard` |'), 'Hidden commands stay out of the main table');
  }));

  it('marks every page as generated, with a link back to its source', () => inTempDir((dir) => {
    buildWiki(dir, SLUG);
    const architecture = fs.readFileSync(path.join(dir, 'Architecture.md'), 'utf-8');

    buildWiki(dir, SLUG);
    const regenerated = fs.readFileSync(path.join(dir, 'Architecture.md'), 'utf-8');
    assert.strictEqual(architecture, regenerated, 'Generation is deterministic');
    assert.ok(regenerated.includes('edit that file in the repository, not this page'));
    assert.ok(regenerated.includes('[🇮🇹 Italiano](Architettura)'), 'Each page links to its translation');
  }));

});
