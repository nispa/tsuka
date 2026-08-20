import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withWorkspaceOverride } from '../src/tools/impl/utils';
import { listDirectory, enterDirectory, parentDirectory, entryPath, PARENT_ENTRY } from '../src/tui/fileExplorer';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { FilesView } from '../src/tui/views/Files';

/** Temporary workspace: docs/guide.md, src/nested/deep.txt, readme.md, node_modules/ (ignored). */
function makeWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-explorer-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# guide\n');
  fs.writeFileSync(path.join(root, 'src', 'nested', 'deep.txt'), 'deep\n');
  fs.writeFileSync(path.join(root, 'readme.md'), 'hello\n');
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), '//\n');
  return root;
}

/** Runs the assertions with the workspace jail pointed at a temporary tree. */
function inWorkspace(fn: (root: string) => void): Promise<void> {
  const root = makeWorkspace();
  return withWorkspaceOverride(root, async () => fn(root)).finally(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
}

describe('Files Explorer directory navigation (T14.12)', () => {

  it('lists directories first and hides ignored folders', () => inWorkspace(() => {
    const items = listDirectory('');
    assert.deepStrictEqual(items.map((i) => i.name), ['docs', 'src', 'readme.md']);
    assert.ok(items.every((i) => i.name !== 'node_modules'), 'Ignored directories stay out of the listing');
    assert.ok(!items.some((i) => i.name === PARENT_ENTRY), 'The workspace root has no parent entry');
  }));

  it('offers a parent entry only below the root', () => inWorkspace(() => {
    const items = listDirectory('src');
    assert.strictEqual(items[0].name, PARENT_ENTRY, 'The way back is the first row');
    assert.strictEqual(items[0].isDir, true);
    assert.deepStrictEqual(items.map((i) => i.name), [PARENT_ENTRY, 'nested']);
  }));

  it('walks down and back up one level at a time', () => inWorkspace(() => {
    assert.strictEqual(enterDirectory('', 'src'), 'src');
    assert.strictEqual(enterDirectory('src', 'nested'), 'src/nested');
    assert.strictEqual(enterDirectory('src/nested', PARENT_ENTRY), 'src');
    assert.strictEqual(parentDirectory('src/nested'), 'src');
    assert.strictEqual(parentDirectory('src'), '');
    assert.strictEqual(parentDirectory(''), '', 'The root is its own parent');
  }));

  it('refuses to leave the workspace jail', () => inWorkspace(() => {
    assert.strictEqual(enterDirectory('', '..'), '', 'Going up from the root stays at the root');
    assert.strictEqual(enterDirectory('src', '../..'), 'src', 'An escaping path leaves the position unchanged');
    assert.strictEqual(enterDirectory('src', path.join('..', '..', '..', 'etc')), 'src');
    assert.deepStrictEqual(listDirectory('../..'), [], 'A directory outside the jail lists nothing');
  }));

  it('does not enter a file or a missing directory', () => inWorkspace(() => {
    assert.strictEqual(enterDirectory('', 'readme.md'), '', 'A file is not a directory to enter');
    assert.strictEqual(enterDirectory('src', 'ghost'), 'src');
  }));

  it('builds the path used by the file viewer and the prompt insertion', () => inWorkspace(() => {
    assert.strictEqual(entryPath('src/nested', 'deep.txt'), 'src/nested/deep.txt');
    assert.strictEqual(entryPath('', 'readme.md'), 'readme.md');
  }));

  it('renders the browsed path as breadcrumb and the way back', () => inWorkspace(() => {
    const store = new TuiStore();
    store.setState({ filesCwd: 'src/nested', workspaceFiles: [], focus: 'files', selectedFileIndex: 0 });

    const plain = FilesView.render(store.getState(), 30, 10).map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('src/nested'), 'The title shows where the panel is');
    assert.ok(plain.includes('.. (up)'), 'The parent entry is visible and labelled');
    assert.ok(plain.includes('deep.txt'), 'The files of the browsed directory are listed');
  }));

  it('falls back to the root listing when no directory is selected', () => inWorkspace(() => {
    const store = new TuiStore();
    const plain = FilesView.render(store.getState(), 30, 10).map((l) => TuiScreen.stripAnsi(l)).join('\n');
    assert.ok(plain.includes('Files'), 'At the root the panel keeps its name');
    assert.ok(plain.includes('readme.md'));
  }));

});

describe('Files Explorer click targeting (T18.7)', () => {

  it('maps a click to the row drawn under the cursor, border included', () => inWorkspace(() => {
    const store = new TuiStore();
    const height = 10;
    const state = store.getState();

    // The panel is a box: line 0 is the top border, so its first entry is content row 0.
    const frame = FilesView.render(state, 30, height).map((l) => TuiScreen.stripAnsi(l));
    const files = FilesView.visibleFiles(state);
    const firstEntryFrameIdx = frame.findIndex((l) => l.includes(files[0].name));
    assert.strictEqual(firstEntryFrameIdx, 1, 'the first entry sits right below the top border');

    for (let contentRow = 0; contentRow < files.length; contentRow++) {
      const index = FilesView.indexAtRow(state, height, contentRow);
      assert.strictEqual(index, contentRow, `content row ${contentRow} selects entry ${contentRow}`);
      const drawn = frame[contentRow + 1];
      assert.ok(drawn.includes(files[contentRow].name), `row ${contentRow} draws ${files[contentRow].name}`);
    }
  }));

  it('rejects rows that hold no entry', () => inWorkspace(() => {
    const store = new TuiStore();
    const state = store.getState();
    assert.strictEqual(FilesView.indexAtRow(state, 10, -1), undefined, 'the top border is not an entry');
    assert.strictEqual(FilesView.indexAtRow(state, 10, 50), undefined, 'a row past the panel is not an entry');
    assert.strictEqual(FilesView.indexAtRow(state, 10, 6), undefined, 'an empty row below the listing selects nothing');
  }));

  it('follows the drawn scroll window, not the raw offset', () => inWorkspace(() => {
    const store = new TuiStore();
    // Offset far past the end: render() clamps it, so hit-testing must clamp it too.
    store.setState({ filesScrollOffset: 99 });
    const state = store.getState();
    const files = FilesView.visibleFiles(state);
    const height = files.length + 2; // whole listing visible: the clamp brings the window back to 0
    assert.strictEqual(FilesView.indexAtRow(state, height, 0), 0, 'the first drawn row is still the first entry');
  }));

  it('converts a terminal row into a pane content row', () => {
    // Header is 3 lines; every pane opens with a top border before its first line.
    assert.strictEqual(TuiScreen.paneContentRow(5, 3), 0, 'first content row of a full-height pane');
    assert.strictEqual(TuiScreen.paneContentRow(4, 3), -1, 'the pane top border is no content row');
    assert.strictEqual(TuiScreen.paneContentRow(6, 3), 1, 'the next terminal row is the next content row');
    // A pane stacked under a 12-line one starts that much lower.
    assert.strictEqual(TuiScreen.paneContentRow(17, 3, 12), 0, 'first content row of the stacked pane');
    assert.strictEqual(TuiScreen.paneContentRow(18, 3, 12), 1, 'second content row of the stacked pane');
  });

});
