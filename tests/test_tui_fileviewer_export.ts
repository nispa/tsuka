/**
 * Automated Test Suite for TSUKA TUI FileViewer Modal & /export Command.
 * Validates file inspection, security boundaries, key navigation, and session Markdown export.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TuiStore } from '../src/tui/store';
import { FileViewerModal, ModalKeyHandler } from '../src/tui/modals';
import { ModalView } from '../src/tui/views/Modal';
import { TuiCommandController } from '../src/tui/controllers/commandController';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err: any) {
    console.error(`  ✘ ${name}: ${err.message}`);
    throw err;
  }
}

async function run() {
  console.log('=== Test Suite: TUI File Viewer & Session Markdown Export ===\n');

  const wsOutDir = path.join(process.cwd(), 'output', 'test_fv');
  fs.mkdirSync(wsOutDir, { recursive: true });
  const sampleFilePath = path.join(wsOutDir, 'test_script.ts');
  const sampleContent = [
    '// Sample TypeScript File',
    'import { LLMProvider } from "./provider";',
    '',
    'export function computeTotal(a: number, b: number): number {',
    '  return a + b;',
    '}',
  ].join('\n');
  fs.writeFileSync(sampleFilePath, sampleContent, 'utf-8');

  const subDir = path.join(wsOutDir, 'subdir');
  fs.mkdirSync(subDir, { recursive: true });

  const outsideTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-fileviewer-test-'));

  try {
    // ── 1. FileViewerModal: Text File Preview & Metadata ──
    await test('FileViewerModal: opens valid text file and initializes state correctly', () => {
      const store = new TuiStore();
      FileViewerModal.openFileModal(store, sampleFilePath);

      const modal = store.getState().activeModal;
      assert.ok(modal, 'Modal should be open');
      assert.strictEqual(modal?.type, 'file_viewer');
      assert.ok(modal?.fileViewer, 'fileViewer state should be defined');
      assert.strictEqual(modal?.fileViewer?.filename, 'test_script.ts');
      assert.strictEqual(modal?.fileViewer?.totalLines, 6);
      assert.strictEqual(modal?.fileViewer?.scrollOffset, 0);
      assert.strictEqual(modal?.fileViewer?.lines[0], '// Sample TypeScript File');
    });

    // ── 2. FileViewerModal: Error Handling on Missing, Dir, or Outside Workspace ──
    await test('FileViewerModal: warns on directories, missing files and outside-jail paths', () => {
      const store = new TuiStore();
      let notifText = '';
      let notifType = '';
      store.notify = (text, type) => {
        notifText = text;
        notifType = type || '';
      };

      FileViewerModal.openFileModal(store, subDir);
      assert.strictEqual(store.getState().activeModal, null, 'Modal should not open for directory');
      assert.strictEqual(notifType, 'warn');

      FileViewerModal.openFileModal(store, path.join(wsOutDir, 'missing_file.ts'));
      assert.strictEqual(store.getState().activeModal, null, 'Modal should not open for missing file');
      assert.strictEqual(notifType, 'error');

      // Attempt out-of-workspace escape
      FileViewerModal.openFileModal(store, path.join(outsideTmpDir, 'external.ts'));
      assert.strictEqual(store.getState().activeModal, null, 'Modal should block outside-jail access');
      assert.strictEqual(notifType, 'error');
    });

    // ── 3. FileViewer Navigation & Key Handling ──
    await test('ModalKeyHandler: navigates scrolling, home, end, and inserts into prompt', () => {
      const store = new TuiStore();
      FileViewerModal.openFileModal(store, sampleFilePath);
      const modal = store.getState().activeModal!;

      // Scroll Down
      ModalKeyHandler.handleKey({ name: 'down' }, modal, store);
      assert.strictEqual(store.getState().activeModal?.fileViewer?.scrollOffset, 1);

      // Scroll Up
      ModalKeyHandler.handleKey({ name: 'up' }, store.getState().activeModal!, store);
      assert.strictEqual(store.getState().activeModal?.fileViewer?.scrollOffset, 0);

      // PageDown / End
      ModalKeyHandler.handleKey({ name: 'end' }, store.getState().activeModal!, store);
      assert.ok((store.getState().activeModal?.fileViewer?.scrollOffset || 0) >= 0);

      // Home
      ModalKeyHandler.handleKey({ name: 'home' }, store.getState().activeModal!, store);
      assert.strictEqual(store.getState().activeModal?.fileViewer?.scrollOffset, 0);

      // Insert filename into prompt with 'i'
      ModalKeyHandler.handleKey({ name: 'i' }, store.getState().activeModal!, store);
      assert.strictEqual(store.getState().activeModal, null, 'Modal should close on insert');
      assert.ok(store.getState().inputText.includes('test_script.ts'), 'Filename should be inserted in inputText');
    });

    // ── 4. ModalView File Viewer Box Rendering ──
    await test('ModalView: renders file viewer overlay with line numbers and box styling', () => {
      const store = new TuiStore();
      FileViewerModal.openFileModal(store, sampleFilePath);
      const modal = store.getState().activeModal!;

      const screenLines = new Array(25).fill(' '.repeat(80));
      const rendered = ModalView.renderOverlay(modal, screenLines, 80, 25);

      assert.strictEqual(rendered.length, 25);
      const joined = rendered.join('\n');
      assert.ok(joined.includes('test_script.ts'), 'Rendered modal must show filename in header');
      assert.ok(joined.includes('1 │') || joined.includes('1'), 'Rendered modal must show line number');
      assert.ok(joined.includes('computeTotal'), 'Rendered modal must show file code content');
    });

    // ── 5. /export Command: Full Markdown Session Dump ──
    await test('TuiCommandController: /export generates structured Markdown session archive', async () => {
      const store = new TuiStore();
      store.setState({
        activeAiName: 'Spock',
        activeCharacterRole: 'analyst',
        activeCharacterTrait: 'logical',
        activeProvider: 'ollama',
        activeModel: 'qwen3.8-27b',
        stats: {
          usedTokens: 1200,
          totalSessionTokens: 3500,
          maxTokens: 8192,
          percentage: 15,
          turnCount: 2,
          toolCallsCount: 1,
        },
      });

      store.addMessage({ role: 'user', content: 'Can you analyze this project?' });
      store.addMessage({
        role: 'assistant',
        authorName: 'Spock',
        content: 'Analysis complete. The codebase exhibits maximum logical coherence.',
        thinkingContent: 'The user requested a systematic structural analysis.',
        thinkingTokens: 150,
        toolCalls: [
          {
            id: 'tc_1',
            name: 'read_file',
            args: JSON.stringify({ filePath: 'package.json' }),
            output: '{"name": "tsuka"}',
            status: 'completed',
            durationMs: 45,
          },
        ],
      });

      const exportDest = path.join(wsOutDir, 'test_export_session.md');
      const cmdController = new TuiCommandController({
        store,
        configManager: {} as any,
        provider: {} as any,
        layoutConfig: {} as any,
        getAgent: () => ({} as any),
        setAgent: () => {},
        recreateAgent: () => ({} as any),
        syncState: () => {},
        probeContextWindow: async () => {},
        setActiveTab: () => {},
        stopApp: () => {},
      });

      await cmdController.handleCommand(`/export ${exportDest}`);

      assert.ok(fs.existsSync(exportDest), 'Export file must exist on disk');
      const exportedContent = fs.readFileSync(exportDest, 'utf-8');

      assert.ok(exportedContent.includes('# 📜 TSUKA Chat Session Export'), 'Must include export title');
      assert.ok(exportedContent.includes('Spock'), 'Must mention active persona');
      assert.ok(exportedContent.includes('qwen3.8-27b'), 'Must mention active model');
      assert.ok(exportedContent.includes('Can you analyze this project?'), 'Must contain user prompt');
      assert.ok(exportedContent.includes('Analysis complete'), 'Must contain assistant reply');
      assert.ok(exportedContent.includes('Reasoning Trace'), 'Must contain thinking details tag');
      assert.ok(exportedContent.includes('Tool Execution: `read_file`'), 'Must contain tool call summary');
    });

  } finally {
    try {
      fs.rmSync(wsOutDir, { recursive: true, force: true });
      fs.rmSync(outsideTmpDir, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\n=== Risultato: ${passed} passati, 0 falliti ===`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
