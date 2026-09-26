/**
 * TUI layout management: config persistence, presets, themes, pluggable layout engines
 * and the frame regions the input layer hit-tests against.
 *
 * Guards the defects found while building the LCARS layouts (T23.16, T24.5, T24.7):
 * themes stored but never drawn, classic themes rendering identically, presets sharing
 * `visibleWidgets` with the live config, F7 changes lost on restart, hit-testing that
 * re-derived geometry instead of reading the frame on screen, focus cycling to panes a
 * layout does not show, and header rows wider than the terminal.
 *
 * Run: npx tsx tests/test_tui_layout.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { HeaderView } from '../src/tui/views/Header';
import { composeFrame } from '../src/tui/layoutComposer';
import { layoutTabs, TUI_TABS } from '../src/tui/navigation';
import { BoxDrawing } from '../src/tui/boxDrawing';
import { routeMouseEvent } from '../src/tui/interaction/mouseRouter';
import { composeLayoutFrame, listLayoutEngines, registerLayoutEngine, TuiFrame } from '../src/tui/layoutEngines';
import { LayoutModals } from '../src/tui/modals/layoutModals';
import type { TuiFocus } from '../src/tui/types';
import {
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_PRESETS,
  LayoutConfigManager,
  TUI_THEMES,
  TuiLayoutConfig,
  applyLayout,
  paneFrame,
} from '../src/tui/layoutConfig';

const WIDTH = 120;
const HEIGHT = 34;
const plain = (line: string) => TuiScreen.stripAnsi(line);

function layout(patch: Partial<TuiLayoutConfig> = {}): TuiLayoutConfig {
  return applyLayout({ ...DEFAULT_LAYOUT_CONFIG }, patch);
}

function frameFor(store: TuiStore, config: TuiLayoutConfig, width = WIDTH, height = HEIGHT): TuiFrame {
  return composeLayoutFrame({ state: store.getState(), width, height, activeTab: 'chat', layout: config });
}

describe('layout config: defaults, presets and persistence', () => {
  let home: string;
  const previousHome = process.env.TSUKA_HOME;

  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-layout-'));
    process.env.TSUKA_HOME = home;
  });
  after(() => {
    if (previousHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('defaults to the LCARS console, and keeps an LCARS panels preset on the classic engine', () => {
    assert.strictEqual(DEFAULT_LAYOUT_CONFIG.theme, 'lcars');
    assert.strictEqual(DEFAULT_LAYOUT_CONFIG.engine, 'console');
    assert.strictEqual(LAYOUT_PRESETS.lcarsPanels.config.engine, 'classic');
    assert.strictEqual(LAYOUT_PRESETS.default.config.engine, 'classic');
  });

  it('never lets a preset share its widget array with the live config', () => {
    const live = layout();
    applyLayout(live, DEFAULT_LAYOUT_CONFIG);
    assert.notStrictEqual(live.visibleWidgets, DEFAULT_LAYOUT_CONFIG.visibleWidgets);
    live.visibleWidgets.push('telemetry');
    assert.ok(!DEFAULT_LAYOUT_CONFIG.visibleWidgets.includes('telemetry'), 'a toggle must not mutate the default');
  });

  it('stores the file in the app home and round-trips it', () => {
    assert.strictEqual(LayoutConfigManager.configPath(), path.join(home, 'tui.layout.json'));
    assert.ok(LayoutConfigManager.save(layout({ theme: 'amber', sidebarPosition: 'right', engine: 'classic' })));
    const loaded = LayoutConfigManager.load();
    assert.strictEqual(loaded.theme, 'amber');
    assert.strictEqual(loaded.sidebarPosition, 'right');
    assert.strictEqual(loaded.engine, 'classic');
  });

  it('drops values the TUI cannot honour when loading a hand-edited file', () => {
    fs.writeFileSync(
      LayoutConfigManager.configPath(),
      JSON.stringify({ theme: 'klingon', sidebarPosition: 'top', visibleWidgets: ['persona', 'warp_core'], showFilesExplorer: false })
    );
    const loaded = LayoutConfigManager.load();
    assert.strictEqual(loaded.theme, DEFAULT_LAYOUT_CONFIG.theme);
    assert.strictEqual(loaded.sidebarPosition, DEFAULT_LAYOUT_CONFIG.sidebarPosition);
    assert.deepStrictEqual(loaded.visibleWidgets, ['persona']);
    assert.strictEqual(loaded.showFilesExplorer, false, 'valid fields are kept');
  });

  it('saves every F7 change at once, without a separate Save step (T24.7)', () => {
    fs.rmSync(LayoutConfigManager.configPath(), { force: true });
    const store = new TuiStore();
    const live = layout();
    LayoutModals.openThemeModal(store, live);
    store.getState().activeModal!.onSelect!('matrix');
    assert.strictEqual(LayoutConfigManager.load().theme, 'matrix', 'choosing a theme persists it');
    LayoutModals.openEngineModal(store, live);
    store.getState().activeModal!.onSelect!('classic');
    assert.strictEqual(LayoutConfigManager.load().engine, 'classic', 'choosing a structure persists it');
  });
});

describe('themes reach the screen', () => {
  it('draws LCARS and caption frames with exactly the classic box geometry', () => {
    const content = ['alpha', 'beta'];
    const scroll = { total: 40, visible: 6, offset: 3 };
    const classic = BoxDrawing.drawBox('Pane', content, 30, 8, false, undefined, scroll);
    for (const frame of [{ style: 'lcars', color: '#ff9900' }, { style: 'caption', color: '#ff9900' }] as const) {
      const drawn = BoxDrawing.drawBox('Pane', content, 30, 8, false, undefined, scroll, frame);
      assert.strictEqual(drawn.length, classic.length, frame.style);
      drawn.forEach((line) => assert.strictEqual(TuiScreen.stringWidth(plain(line)), 30, frame.style));
    }
  });

  it('frames panes in the colours of each theme: LCARS elbows, rounded boxes for classic themes', () => {
    const lcarsChat = paneFrame(TUI_THEMES.lcars, 'chat', true);
    const lcarsFiles = paneFrame(TUI_THEMES.lcars, 'files', true);
    assert.ok(lcarsChat.style === 'lcars' && lcarsFiles.style === 'lcars' && lcarsChat.color !== lcarsFiles.color);
    assert.strictEqual(paneFrame(TUI_THEMES.amber, 'chat', true).style, 'rounded');
  });

  it('renders every classic theme differently (T24.5)', () => {
    const store = new TuiStore();
    store.addMessage({ role: 'user', content: 'Engage.' });
    const classicThemes = (Object.keys(TUI_THEMES) as TuiLayoutConfig['theme'][]).filter((t) => !TUI_THEMES[t].lcars);
    // Themes differ only in colour: force ANSI colours, which chalk drops when stdout is not a TTY.
    const previousLevel = chalk.level;
    chalk.level = 3;
    try {
      const frames = classicThemes.map((theme) => composeFrame(store.getState(), WIDTH, HEIGHT, 'chat', layout({ engine: 'classic', theme })).join('\n'));
      assert.strictEqual(new Set(frames).size, classicThemes.length, `${classicThemes.join(', ')} must not look alike`);
    } finally {
      chalk.level = previousLevel;
    }
  });

  it('keeps every tab label inside its click zone with LCARS pills', () => {
    const store = new TuiStore();
    for (const width of [70, 100, 130, 160]) {
      const row = plain(HeaderView.render(store.getState(), width, 'chat', TUI_THEMES.lcars)[0]);
      for (const zone of layoutTabs(width, 'chat')) {
        // Measure in terminal columns: emoji labels are two columns but not two code units.
        const at = row.indexOf(` ${zone.label} `);
        assert.ok(at >= 0, `label of ${zone.spec.id} drawn at width ${width}`);
        assert.strictEqual(TuiScreen.stringWidth(row.slice(0, at)) + 1, zone.start, `zone of ${zone.spec.id} at width ${width}`);
      }
    }
  });

  it('composes a full-size frame for every engine, theme, sidebar position and terminal width', () => {
    // A row wider than the terminal wraps and shifts the whole frame.
    const store = new TuiStore();
    store.addMessage({ role: 'user', content: 'Engage.' });
    for (const engine of listLayoutEngines().map((e) => e.id)) {
      for (const width of [80, 115, 120, 131, 170]) {
        for (const theme of Object.keys(TUI_THEMES) as TuiLayoutConfig['theme'][]) {
          for (const sidebarPosition of ['left', 'right', 'hidden'] as const) {
            const lines = composeFrame(store.getState(), width, HEIGHT, 'chat', layout({ engine, theme, sidebarPosition }));
            const where = `${engine}/${theme}/${sidebarPosition} at ${width}`;
            assert.strictEqual(lines.length, HEIGHT, `${where} fills the screen`);
            lines.forEach((line, i) => assert.strictEqual(TuiScreen.stringWidth(plain(line)), width - 1, `${where}, row ${i}`));
          }
        }
      }
    }
  });
});

describe('layout engines are plug-ins', () => {
  it('uses a registered plug-in engine selected by name', () => {
    registerLayoutEngine({
      id: 'test-plugin',
      label: 'Test plug-in',
      description: 'one line per row',
      compose: ({ height, width }) => ({ lines: Array(height).fill('#'.repeat(width - 1)), panes: {}, tabs: [] }),
    });
    const frame = frameFor(new TuiStore(), layout({ engine: 'test-plugin' }));
    assert.ok(frame.lines.every((line) => line.startsWith('#')), 'the plug-in drew the frame');
    assert.ok(listLayoutEngines().some((e) => e.id === 'test-plugin'), 'F7 lists it from the registry');
  });

  it('falls back to the default engine when the configured one is not registered', () => {
    const frame = frameFor(new TuiStore(), layout({ engine: 'no-such-engine' }));
    assert.strictEqual(frame.lines.length, HEIGHT);
    assert.ok(frame.panes.input, 'the fallback still draws a usable screen');
  });
});

describe('the LCARS console', () => {
  it('stacks every tab as a button in the left column, with click zones on the drawn rows', () => {
    const frame = frameFor(new TuiStore(), layout());
    assert.strictEqual(frame.tabs.length, TUI_TABS.length);
    for (const zone of frame.tabs) {
      const row = plain(frame.lines[zone.y - 1]).slice(zone.x - 1, zone.x - 1 + zone.width);
      assert.ok(row.includes(zone.spec.key.toUpperCase()), `button of ${zone.spec.id} carries ${zone.spec.key.toUpperCase()} (${row})`);
    }
  });

  it('shows the conversation and the prompt, and no sidebar or files pane', () => {
    const frame = frameFor(new TuiStore(), layout());
    assert.deepStrictEqual(Object.keys(frame.panes).sort(), ['chat', 'input']);
  });

  it('degrades to the classic quadrant on a terminal too narrow for the column', () => {
    const frame = frameFor(new TuiStore(), layout(), 60);
    assert.ok(frame.panes.sidebar || frame.tabs.every((t) => t.y === 1), 'narrow terminals get the classic arrangement');
  });
});

describe('input follows the frame on screen', () => {
  function click(store: TuiStore, frame: TuiFrame, row: number, col: number, activated: string[] = []) {
    routeMouseEvent(
      {
        store,
        getFrame: () => frame,
        getActiveTab: () => 'chat',
        dimensions: () => ({ width: WIDTH, height: HEIGHT }),
        currentFiles: () => [],
        openFileEntry: () => {},
        activateTab: (spec) => activated.push(spec.id),
      },
      { button: 'left', action: 'down', row, col } as any
    );
  }

  it('follows the header when it grows a progress line', () => {
    const store = new TuiStore();
    store.setState({ isGenerating: true, generationStatus: { phase: 'reasoning', detail: 'step 3 of 8' } });
    const state = store.getState();
    assert.strictEqual(HeaderView.lineCount(state), HeaderView.render(state, WIDTH).length);
  });

  it('routes a click on a tall multi-line prompt to the input, in both engines', () => {
    for (const engine of ['classic', 'console']) {
      const store = new TuiStore();
      store.setState({ inputText: 'one\ntwo\nthree\nfour' });
      const frame = frameFor(store, layout({ engine }));
      const input = frame.panes.input!;
      store.setFocus('chat');
      click(store, frame, input.y + 1, input.x + 5);
      assert.strictEqual(store.getState().focus, 'input', engine);
    }
  });

  it('finds the chat scrollbar at the pane edge with the sidebar on the right', () => {
    const store = new TuiStore();
    for (let i = 0; i < 10; i++) store.addMessage({ role: 'user', content: `message ${i}` });
    const frame = frameFor(store, layout({ engine: 'classic', sidebarPosition: 'right' }));
    const chat = frame.panes.chat!;
    assert.strictEqual(chat.x, 1, 'the conversation starts at the left edge');
    click(store, frame, chat.y + 1, chat.x + chat.width - 1);
    assert.ok(store.getState().chatScrollOffset > 0, 'a click at the top of the track scrolls to older messages');
  });

  it('activates a tab by clicking its LCARS button', () => {
    const store = new TuiStore();
    const frame = frameFor(store, layout());
    const memory = frame.tabs.find((t) => t.spec.id === 'memory')!;
    const activated: string[] = [];
    click(store, frame, memory.y, memory.x + 2, activated);
    assert.deepStrictEqual(activated, ['memory']);
  });

  it('cycles focus only through the panes the layout shows', () => {
    const store = new TuiStore();
    const frame = frameFor(store, layout());
    const visible = Object.keys(frame.panes) as TuiFocus[];
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      store.cycleFocus(visible);
      seen.add(store.getState().focus);
    }
    assert.deepStrictEqual([...seen].sort(), ['chat', 'input'], 'console: never sidebar, files or tools');
  });
});
