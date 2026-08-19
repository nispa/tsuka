import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { HeaderView } from '../src/tui/views/Header';
import { TUI_TABS, layoutTabs, tabAtColumn, tabByKey, labelForWidth } from '../src/tui/navigation';
import { TUI_COMMANDS, findCommand, parseCommandLine, assertMenuCoverage } from '../src/tui/commands';
import { buildSessionMarkdown, defaultExportPath } from '../src/tui/commands/sessionMarkdown';

describe('TUI command registry (data-driven dispatch)', () => {

  it('resolves every canonical name and alias to exactly one command', () => {
    assert.strictEqual(findCommand('/export'), findCommand('/save'), 'Alias and command must share one implementation');
    assert.strictEqual(findCommand('/stop'), findCommand('/kill'));
    assert.strictEqual(findCommand('/models'), findCommand('/model'));
    assert.strictEqual(findCommand('/HELP')?.name, '/help', 'Lookup is case-insensitive');
    assert.strictEqual(findCommand('/nope'), undefined, 'An unknown command resolves to nothing');
  });

  it('declares no duplicate spelling across the table', () => {
    const spellings = TUI_COMMANDS.flatMap((s) => [s.name, ...(s.aliases || [])]);
    assert.strictEqual(new Set(spellings).size, spellings.length, 'Two commands must never claim the same spelling');
    for (const spec of TUI_COMMANDS) {
      assert.ok(spec.name.startsWith('/'), `${spec.name} must start with a slash`);
      assert.ok(spec.description.length > 0, `${spec.name} must describe itself`);
    }
  });

  it('splits the command line into name and argument', () => {
    assert.deepStrictEqual(parseCommandLine('/clear'), { cmd: '/clear', arg: '' });
    assert.deepStrictEqual(parseCommandLine('  /TEAM  devs "ship it"  '), { cmd: '/team', arg: 'devs "ship it"' });
    assert.deepStrictEqual(parseCommandLine('/goal build a parser'), { cmd: '/goal', arg: 'build a parser' });
  });

  it('keeps the slash menu and the handlers in sync', () => {
    const { menuWithoutHandler, handlerWithoutMenu } = assertMenuCoverage();
    assert.deepStrictEqual(menuWithoutHandler, [], 'A menu entry with no handler would do nothing when picked');
    assert.deepStrictEqual(handlerWithoutMenu, [], 'A visible command missing from the menu is undiscoverable');
  });

  it('resolves every lazy require() a slash command depends on, with the export it destructures', () => {
    // Command handlers pull in their CLI implementation lazily (`require('../../cli/commands/x')`)
    // to keep TUI startup light. `assertMenuCoverage` only checks that a name is registered — it
    // never runs the handler, so a require() pointing at a nonexistent module (e.g. a typo'd
    // filename) or destructuring a name the module doesn't export passes every other check and
    // only breaks the moment a user actually picks the command. This walks the same requires the
    // handlers use and resolves them for real, so that break shows up here instead.
    const commandsDir = path.join(__dirname, '../src/tui/commands');
    const requireCallRe = /const\s*\{\s*([a-zA-Z0-9_$]+)\s*\}\s*=\s*require\(\s*['"](\.\.\/\.\.\/[^'"]+)['"]\s*\)/g;

    let checked = 0;
    for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      for (const match of src.matchAll(requireCallRe)) {
        const [, exportName, relPath] = match;
        const resolvedPath = path.join(commandsDir, relPath);

        let mod: any;
        assert.doesNotThrow(
          () => { mod = require(resolvedPath); },
          `${file}: require('${relPath}') must resolve to a real module`
        );
        assert.strictEqual(
          typeof mod[exportName], 'function',
          `${file}: '${relPath}' must export a function named '${exportName}'`
        );
        checked++;
      }
    }
    assert.ok(checked > 0, 'sanity check: this test should find at least one lazy require to verify');
  });

});

describe('TUI navigation table (header labels and click zones)', () => {

  it('gives every tab a function key and per-width labels', () => {
    const keys = TUI_TABS.map((t) => t.key);
    assert.strictEqual(new Set(keys).size, keys.length, 'One function key per tab');
    for (const tab of TUI_TABS) {
      assert.strictEqual(tab.labels.length, 3, `${tab.id} needs narrow, medium and wide labels`);
      assert.ok(labelForWidth(tab, 70).length > 0);
    }
    assert.strictEqual(tabByKey('f12')?.id, 'help');
    assert.strictEqual(tabByKey('f9'), undefined);
  });

  it('lays out zones contiguously, in order, within the drawn row', () => {
    const store = new TuiStore();
    const width = 120;
    const zones = layoutTabs(width, 'chat');
    const rowWidth = TuiScreen.stringWidth(TuiScreen.stripAnsi(HeaderView.render(store.getState(), width, 'chat')[0]));

    assert.deepStrictEqual(zones.map((z) => z.spec.id), TUI_TABS.map((t) => t.id), 'Zones keep the table order');
    zones.forEach((zone, i) => {
      assert.ok(zone.end >= zone.start, `Zone of '${zone.spec.id}' must not be empty`);
      if (i > 0) {
        // One separating space between two tabs: no overlap, no gap wider than that.
        assert.strictEqual(zone.start, zones[i - 1].end + 2, `Zone of '${zone.spec.id}' must follow the previous one`);
      }
    });
    assert.ok(zones[zones.length - 1].end <= rowWidth, 'The last zone stays inside the rendered row');
  });

  it('maps a clicked column back to its tab', () => {
    const width = 120;
    const zones = layoutTabs(width, 'chat');
    for (const zone of zones) {
      assert.strictEqual(tabAtColumn(width, 'chat', zone.start)?.id, zone.spec.id);
      assert.strictEqual(tabAtColumn(width, 'chat', zone.end)?.id, zone.spec.id);
    }
    const lastColumn = zones[zones.length - 1].end;
    assert.strictEqual(tabAtColumn(width, 'chat', lastColumn + 2), undefined, 'Empty header space selects nothing');
  });

  it('keeps zones consistent on a narrow terminal, where labels shrink', () => {
    const store = new TuiStore();
    const width = 70;
    const tabsRow = TuiScreen.stripAnsi(HeaderView.render(store.getState(), width, 'tools')[0]);
    for (const zone of layoutTabs(width, 'tools')) {
      assert.ok(tabsRow.slice(zone.start - 1, zone.end).includes(zone.label), `Narrow zone of '${zone.spec.id}'`);
    }
  });

});

describe('TUI header live-progress detail line', () => {
  // T14.15: a long CLI workflow's spinner (`/benchmark`, `/goal`'s parallel groups — see
  // core/progressSink.ts) reports its current step here so the header keeps the user informed
  // and the screen keeps repainting instead of appearing frozen on stale content.

  it('adds no line when idle or when generating without a reported detail', () => {
    const store = new TuiStore();
    assert.strictEqual(HeaderView.render(store.getState(), 80).length, 3, 'idle: tabs + status + separator only');

    store.setState({ isGenerating: true, generationStatus: { phase: 'reasoning', agentName: 'Tsuka' } });
    assert.strictEqual(HeaderView.render(store.getState(), 80).length, 3, 'generating with nothing to report stays 3 lines');
  });

  it('renders the detail between the status line and the separator while generating', () => {
    const store = new TuiStore();
    store.setState({
      isGenerating: true,
      generationStatus: { phase: 'reasoning', agentName: 'Benchmark Suite', detail: "Benchmarking 'llama3' — step 3 of 8" },
    });
    const lines = HeaderView.render(store.getState(), 80).map(TuiScreen.stripAnsi);
    assert.strictEqual(lines.length, 4);
    assert.ok(lines[2].includes("Benchmarking 'llama3' — step 3 of 8"));
    assert.ok(lines[3].startsWith('━'), 'the separator still closes the header, now one line lower');
  });

  it('drops the detail once generation ends, even though setState only merges shallowly', () => {
    const store = new TuiStore();
    store.setState({ isGenerating: true, generationStatus: { phase: 'reasoning', detail: 'still going' } });
    assert.strictEqual(HeaderView.render(store.getState(), 80).length, 4);

    store.setState({ isGenerating: false, generationStatus: { phase: 'idle' } });
    assert.strictEqual(HeaderView.render(store.getState(), 80).length, 3, 'a stale detail must not survive past its own turn');
  });

  it('truncates a detail line longer than the available width instead of wrapping', () => {
    const store = new TuiStore();
    const width = 40;
    store.setState({
      isGenerating: true,
      generationStatus: { phase: 'reasoning', detail: 'x'.repeat(200) },
    });
    const line = TuiScreen.stripAnsi(HeaderView.render(store.getState(), width)[2]);
    assert.strictEqual(TuiScreen.stringWidth(line), width, 'padded/truncated to exactly the header width, like every other row');
    assert.ok(line.includes('…'), 'an over-long detail is truncated with an ellipsis, not wrapped onto a 5th line');
  });
});

describe('TUI session markdown export', () => {

  it('renders users, reasoning traces and tool calls, and skips unknown roles', () => {
    const store = new TuiStore();
    store.addMessage({ role: 'user', content: 'Read the config' });
    store.addMessage({
      role: 'assistant',
      authorName: 'Geordi',
      content: 'Done.',
      thinkingContent: 'I should read the file first',
      thinkingTokens: 42,
      toolCalls: [{ id: 't1', name: 'read_file', args: '{"path":"a.txt"}', output: 'hello', status: 'completed', durationMs: 12 }],
    });
    store.addMessage({ role: 'tool', content: 'raw tool payload' });

    const md = buildSessionMarkdown(store.getState());

    assert.ok(md.includes('# 📜 TSUKA Chat Session Export'));
    assert.ok(md.includes('### 👤 User'));
    assert.ok(md.includes('### 🤖 @Geordi'));
    assert.ok(md.includes('Reasoning Trace (42 tokens)'));
    assert.ok(md.includes('Tool Execution: `read_file`'));
    assert.ok(md.includes('in 12ms'));
    assert.ok(md.includes('hello'));
    assert.ok(!md.includes('raw tool payload'), "The 'tool' role has no renderer: it must not leak into the export");
  });

  it('builds a timestamped default export path', () => {
    const path = defaultExportPath(new Date(2026, 7, 18, 9, 5, 3));
    assert.strictEqual(path, 'exports/session-2026-08-18-090503.md');
  });

});
