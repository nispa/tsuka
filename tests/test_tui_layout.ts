/**
 * TUI layout management: config persistence, presets, themes and frame geometry.
 *
 * Guards the defects found while wiring the LCARS theme: themes were stored but never
 * drawn, presets shared their `visibleWidgets` array with the live config (so a widget
 * toggle mutated DEFAULT_LAYOUT_CONFIG and "reset" stopped resetting), the mouse router
 * assumed a 3-line header and input, and the config file lived beside the source.
 *
 * Run: npx tsx tests/test_tui_layout.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { HeaderView } from '../src/tui/views/Header';
import { composeFrame } from '../src/tui/layoutComposer';
import { layoutTabs } from '../src/tui/navigation';
import { BoxDrawing } from '../src/tui/boxDrawing';
import { computeFrameGeometry } from '../src/tui/interaction/geometry';
import { routeMouseEvent } from '../src/tui/interaction/mouseRouter';
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

function layout(patch: Partial<TuiLayoutConfig> = {}): TuiLayoutConfig {
  return applyLayout({ ...DEFAULT_LAYOUT_CONFIG }, patch);
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

  it('defaults to the LCARS theme, reachable as a preset', () => {
    assert.strictEqual(DEFAULT_LAYOUT_CONFIG.theme, 'lcars');
    assert.strictEqual(LAYOUT_PRESETS.lcars.config.theme, 'lcars');
    assert.ok(TUI_THEMES.lcars.lcars, 'the LCARS theme carries its chrome');
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
    assert.ok(LayoutConfigManager.save(layout({ theme: 'amber', sidebarPosition: 'right' })));
    const loaded = LayoutConfigManager.load();
    assert.strictEqual(loaded.theme, 'amber');
    assert.strictEqual(loaded.sidebarPosition, 'right');
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
});

describe('themes reach the screen', () => {
  it('draws LCARS frames with exactly the classic box geometry', () => {
    const content = ['alpha', 'beta'];
    const scroll = { total: 40, visible: 6, offset: 3 };
    const classic = BoxDrawing.drawBox('Pane', content, 30, 8, false, undefined, scroll);
    const lcars = BoxDrawing.drawBox('Pane', content, 30, 8, false, undefined, scroll, { style: 'lcars', color: '#ff9900' });
    assert.strictEqual(lcars.length, classic.length);
    lcars.forEach((line) => assert.strictEqual(TuiScreen.stringWidth(TuiScreen.stripAnsi(line)), 30));
    assert.ok(TuiScreen.stripAnsi(lcars[1]).startsWith('█alpha'), 'content sits right after the elbow bar');
  });

  it('gives each pane its own LCARS colour and leaves classic themes on the rounded box', () => {
    assert.strictEqual(paneFrame(TUI_THEMES.cyan, 'chat', true), undefined);
    const chat = paneFrame(TUI_THEMES.lcars, 'chat', true);
    const files = paneFrame(TUI_THEMES.lcars, 'files', true);
    assert.ok(chat && files && chat.color !== files.color);
    assert.notStrictEqual(paneFrame(TUI_THEMES.lcars, 'chat', false)?.color, chat?.color, 'focus changes the shade');
  });

  it('keeps every tab label inside its click zone with LCARS pills', () => {
    const store = new TuiStore();
    for (const width of [70, 100, 130, 160]) {
      const row = TuiScreen.stripAnsi(HeaderView.render(store.getState(), width, 'chat', TUI_THEMES.lcars)[0]);
      for (const zone of layoutTabs(width, 'chat')) {
        // Measure in terminal columns: emoji labels are two columns but not two code units.
        const at = row.indexOf(` ${zone.label} `);
        assert.ok(at >= 0, `label of ${zone.spec.id} drawn at width ${width}`);
        assert.strictEqual(TuiScreen.stringWidth(row.slice(0, at)) + 1, zone.start, `zone of ${zone.spec.id} at width ${width}`);
      }
    }
  });

  it('composes a full-size frame for every theme, sidebar position and terminal width', () => {
    // A row wider than the terminal wraps and shifts the whole frame: at 110-130 columns
    // the header's emoji labels used to overflow by several columns.
    const store = new TuiStore();
    store.addMessage({ role: 'user', content: 'Engage.' });
    for (const width of [80, 115, 120, 131, 170]) {
      for (const theme of Object.keys(TUI_THEMES) as TuiLayoutConfig['theme'][]) {
        for (const sidebarPosition of ['left', 'right', 'hidden'] as const) {
          const frame = composeFrame(store.getState(), width, HEIGHT, 'chat', layout({ theme, sidebarPosition }));
          const where = `${theme}/${sidebarPosition} at ${width}`;
          assert.strictEqual(frame.length, HEIGHT, `${where} fills the screen`);
          frame.forEach((line, i) =>
            assert.strictEqual(TuiScreen.stringWidth(TuiScreen.stripAnsi(line)), width - 1, `${where}, row ${i}`)
          );
        }
      }
    }
  });
});

describe('frame geometry is shared by drawing and hit-testing', () => {
  it('follows the header when it grows a progress line', () => {
    const store = new TuiStore();
    store.setState({ isGenerating: true, generationStatus: { phase: 'reasoning', detail: 'step 3 of 8' } });
    const state = store.getState();
    assert.strictEqual(HeaderView.lineCount(state), HeaderView.render(state, WIDTH).length);
  });

  it('places the sidebar after the main pane when it sits on the right', () => {
    const g = computeFrameGeometry(WIDTH, HEIGHT, layout({ sidebarPosition: 'right' }), { headerHeight: 3, inputText: '' });
    assert.strictEqual(g.mainStart, 1);
    assert.strictEqual(g.sidebarStart, g.mainWidth + 1);
    assert.strictEqual(g.mainWidth + g.sidebarWidth, g.effectiveWidth);
  });

  function router(store: TuiStore, config: TuiLayoutConfig) {
    return (row: number, col: number) =>
      routeMouseEvent(
        {
          store,
          layout: config,
          getActiveTab: () => 'chat',
          dimensions: () => ({ width: WIDTH, height: HEIGHT }),
          currentFiles: () => [],
          openFileEntry: () => {},
          activateTab: () => {},
        },
        { button: 'left', action: 'down', row, col } as any
      );
  }

  it('routes a click on a tall multi-line input to the input, not to the chat', () => {
    const store = new TuiStore();
    store.setState({ inputText: 'one\ntwo\nthree\nfour' });
    const g = computeFrameGeometry(WIDTH, HEIGHT, layout(), { headerHeight: 3, inputText: store.getState().inputText });
    assert.ok(g.inputHeight > 3, 'the input really grew');
    store.setFocus('chat');
    router(store, layout())(HEIGHT - g.inputHeight + 1, 60);
    assert.strictEqual(store.getState().focus, 'input');
  });

  it('finds the chat scrollbar at the main pane edge with the sidebar on the right', () => {
    const store = new TuiStore();
    for (let i = 0; i < 10; i++) store.addMessage({ role: 'user', content: `message ${i}` });
    const config = layout({ sidebarPosition: 'right' });
    const g = computeFrameGeometry(WIDTH, HEIGHT, config, { headerHeight: 3, inputText: '' });
    router(store, config)(g.headerHeight + 2, g.mainStart + g.mainWidth - 1);
    assert.ok(store.getState().chatScrollOffset > 0, 'a click at the top of the track scrolls to older messages');
  });
});
