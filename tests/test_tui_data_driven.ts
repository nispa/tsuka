import { describe, it } from 'node:test';
import assert from 'node:assert';
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
