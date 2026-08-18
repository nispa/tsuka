import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { InputParser } from '../src/tui/inputParser';
import { InputView } from '../src/tui/views/Input';
import { ToolsView } from '../src/tui/views/Tools';
import { handleTools } from '../src/cli/commands/tools';
import { handleExport } from '../src/cli/commands/exportSession';

describe('TUI & CLI Parity: Multi-line Input & Tools Search Filter', () => {

  it('InputParser: parses linefeed control code and shift-enter sequences', () => {
    // Code 10 -> linefeed
    const parsed10 = InputParser.parse('\n');
    assert.strictEqual(parsed10.keys.length, 1);
    assert.strictEqual(parsed10.keys[0].name, 'linefeed');
    assert.strictEqual(parsed10.keys[0].char, '\n');

    // Shift+Enter escape sequence
    const parsedShift = InputParser.parse('\x1b[13;2u');
    assert.strictEqual(parsedShift.keys.length, 1);
    assert.strictEqual(parsedShift.keys[0].name, 'linefeed');
  });

  it('TuiStore & InputView: supports multiline input text and 2D cursor rendering', () => {
    const store = new TuiStore();
    store.insertInputChar('Line 1');
    store.insertInputChar('\n');
    store.insertInputChar('Line 2');

    const state = store.getState();
    assert.strictEqual(state.inputText, 'Line 1\nLine 2');
    assert.strictEqual(state.inputCursor, 13);

    const rendered = InputView.render(state, 60, 4);
    const plain = rendered.map(l => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('Line 1'), 'Must render line 1');
    assert.ok(plain.includes('Line 2'), 'Must render line 2');
    assert.ok(plain.includes('2 lines'), 'Must display multiline count in title');
  });

  it('ToolsView: filters tool executions by query string', () => {
    const store = new TuiStore();
    store.setState({
      activeTools: [
        { id: '1', name: 'read_file', args: '{"path":"a.ts"}', output: 'content', startedAt: 100, completedAt: 150, status: 'completed', riskLevel: 'SAFE' },
        { id: '2', name: 'run_command', args: '{"cmd":"ls"}', output: 'ok', startedAt: 200, completedAt: 250, status: 'completed', riskLevel: 'DANGEROUS' },
      ],
      toolsFilter: 'command',
    });

    const state = store.getState();
    const lines = ToolsView.render(state, 80, 15);
    const plain = lines.map(l => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('run_command'), 'Must include matching tool');
    assert.ok(!plain.includes('read_file'), 'Must exclude non-matching tool');
    assert.ok(plain.includes('Filter: "command"'), 'Must display active filter header');
  });

  it('CLI /tools [query]: filters displayed tool table by query', async () => {
    let capturedLog = '';
    const mockCtx: any = {
      configManager: {
        getActiveCharacter: () => 'developer',
        getActiveRole: () => 'developer',
      },
      loadCharacter: () => null,
      loadRole: () => ({ displayName: 'Developer', allowedTools: ['read_file', 'write_file', 'run_command'] }),
      provider: { getCurrentModel: () => 'qwen2.5-coder' },
      agent: { current: { getReasoningEffort: () => 'standard' } },
      registry: {
        getAllTools: () => [
          { name: 'read_file', riskLevel: 'SAFE' },
          { name: 'write_file', riskLevel: 'SAFE' },
          { name: 'run_command', riskLevel: 'DANGEROUS' },
        ],
        listForLLM: () => [
          { function: { name: 'read_file' } },
          { function: { name: 'write_file' } },
          { function: { name: 'run_command' } },
        ],
      },
    };

    // Test query filter 'command'
    await handleTools(mockCtx, 'command');
    // Test query filter 'safe'
    await handleTools(mockCtx, 'safe');
    // Test empty query (all tools)
    await handleTools(mockCtx, '');
  });

  it('CLI /export [path]: exports conversation session to Markdown', async () => {
    const wsDir = path.resolve(process.cwd(), 'output', 'test_cli_export');
    fs.mkdirSync(wsDir, { recursive: true });
    const targetFile = path.join(wsDir, 'cli_session_export.md');

    try {
      const mockCtx: any = {
        agent: {
          current: {
            getMessages: () => [
              { role: 'system', content: 'You are helpful.' },
              { role: 'user', content: 'Create a test file' },
              { role: 'assistant', content: 'Done!', tool_calls: [{ function: { name: 'write_file', arguments: '{"path":"test.txt"}' } }] },
              { role: 'tool', tool_call_id: 'call_1', content: 'File written successfully' }
            ]
          }
        },
        configManager: {
          getActiveCharacter: () => 'spock',
          getActiveRole: () => 'logic_analyst',
          getActiveProviderName: () => 'ollama'
        },
        loadCharacter: () => ({ displayName: 'Spock', aiName: 'spock', role: 'logic_analyst' }),
        loadRole: () => ({ displayName: 'Logic Analyst' }),
        provider: { getCurrentModel: () => 'qwen2.5-coder' }
      };

      await handleExport(mockCtx, targetFile);

      assert.ok(fs.existsSync(targetFile), 'Exported file must exist on disk');
      const content = fs.readFileSync(targetFile, 'utf-8');
      assert.ok(content.includes('# 📜 TSUKA Chat Session Export'));
      assert.ok(content.includes('Create a test file'));
      assert.ok(content.includes('write_file'));
      assert.ok(content.includes('File written successfully'));
    } finally {
      try {
        fs.rmSync(wsDir, { recursive: true, force: true });
      } catch {}
    }
  });

});
