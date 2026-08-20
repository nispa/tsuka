/**
 * Tests for T18.4 — live thoughts readable while they stream, and clicks that land on the
 * row actually drawn.
 *
 * Two defects lived in the same place. A running thought was collapsed into a single line
 * (the tail of the text in quotes), so the reasoning could not be read while waiting, and
 * clicking it during a turn did nothing: the hit-testers rebuilt the pane geometry with their
 * own arithmetic, ignoring the trailing spacing line and the "generating" activity card, so
 * the row they resolved was one to three lines above the row under the cursor.
 *
 * The click cases here derive the expected row from the rendered frame instead of hardcoding
 * it — the only way to catch a renderer and a hit-tester drifting apart again.
 *
 * Isolated run: npx tsx tests/test_tui_thinking_view.ts
 */
import chalk from 'chalk';
import { ChatView } from '../src/tui/views/Chat';
import { TuiStore } from '../src/tui/store';
import { TuiState } from '../src/tui/types';

if (chalk.level === 0) chalk.level = 1;

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) { passed++; console.log(`✔ ${id} PASS — ${detail}`); }
  else { failed++; console.log(`✘ ${id} FAIL — ${detail}`); }
}

const WIDTH = 80;
const HEIGHT = 20;

/** Strips ANSI so assertions read the text, not the colours. */
function plain(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Row a click would carry, for the first rendered line matching `needle`. The chat pane is
 * drawn inside a box, and app.ts subtracts that top border before hit-testing, so the click
 * row is the index in the frame minus one.
 */
function clickRowOf(state: TuiState, needle: string): number {
  const frame = ChatView.render(state, WIDTH, HEIGHT).map(plain);
  const idx = frame.findIndex((l) => l.includes(needle));
  return idx < 0 ? -1 : idx - 1;
}

function main() {
  console.log('=== TUI: live thinking view and click targeting ===\n');

  // TV1: a streaming thought is open by default — no click needed to read it.
  {
    const store = new TuiStore();
    const id = store.addMessage({
      role: 'assistant',
      authorName: 'Geordi',
      isStreaming: true,
      thinkingContent: 'First I inspect the repo\nThen I read the task file\nFinally I plan the edit',
    });
    const frame = ChatView.render(store.getState(), WIDTH, HEIGHT).map(plain);
    check('TV1a', frame.some((l) => l.includes('Thinking…') && l.includes('┌─')), 'live thought drawn as an open block');
    check('TV1b', frame.some((l) => l.includes('Then I read the task file')), 'the body of the thought is readable, not just its tail');
    check('TV1c', !!store.getState().messages.find((m) => m.id === id), 'message present in the store');
  }

  // TV2: an explicit collapse by the user still wins over the live default.
  {
    const store = new TuiStore();
    store.addMessage({
      role: 'assistant',
      authorName: 'Geordi',
      isStreaming: true,
      isThinkingExpanded: false,
      thinkingContent: 'First I inspect the repo\nThen I read the task file',
    });
    const frame = ChatView.render(store.getState(), WIDTH, HEIGHT).map(plain);
    check('TV2a', !frame.some((l) => l.includes('┌─')), 'collapsed by hand: no open block');
    check('TV2b', frame.some((l) => l.includes('Thinking…')), 'the one-line summary is still there');
  }

  // TV3: a finished thought keeps following the global toggle (collapsed by default).
  {
    const store = new TuiStore();
    store.addMessage({
      role: 'assistant',
      authorName: 'Geordi',
      content: 'Done.',
      thinkingContent: 'First I inspect the repo\nThen I read the task file',
    });
    const frame = ChatView.render(store.getState(), WIDTH, HEIGHT).map(plain);
    check('TV3a', frame.some((l) => l.includes('Thought (') && l.includes('[Click / Ctrl+T]')), 'finished thought collapsed on one line');
    check('TV3b', !frame.some((l) => l.includes('┌─')), 'no open block once the answer arrived');
  }

  // TV4: a long live thought shows its tail, so it cannot flood the pane.
  {
    const store = new TuiStore();
    const many = Array.from({ length: 40 }, (_, i) => `reasoning step number ${i}`).join('\n');
    store.addMessage({ role: 'assistant', authorName: 'Geordi', isStreaming: true, thinkingContent: many });
    const frame = ChatView.render(store.getState(), WIDTH, HEIGHT).map(plain);
    check('TV4a', frame.some((l) => l.includes('reasoning step number 39')), 'the newest lines of the thought are visible');
    check('TV4b', !frame.some((l) => l.includes('reasoning step number 0 ') || /step number 0$/.test(l.trim())), 'the oldest lines are dropped, not stacked');
  }

  // TV5: clicking a collapsed thought hits it — short conversation, nothing scrolled.
  {
    const store = new TuiStore();
    const id = store.addMessage({
      role: 'assistant',
      authorName: 'Geordi',
      content: 'Answer line one\nAnswer line two',
      thinkingContent: 'A short thought',
    });
    const state = store.getState();
    const row = clickRowOf(state, 'Thought (');
    const target = ChatView.getThinkingHeaderAtRow(state, WIDTH, HEIGHT, row);
    check('TV5', target?.id === id, `click on the drawn row targets the thought (row ${row})`);
  }

  // TV6: same click on a conversation long enough to scroll — the pane is pinned to the
  // bottom, which is where the off-by-one used to appear.
  {
    const store = new TuiStore();
    let lastId = '';
    for (let i = 0; i < 12; i++) {
      store.addMessage({ role: 'user', content: `question ${i}` });
      lastId = store.addMessage({
        role: 'assistant',
        authorName: 'Geordi',
        content: `answer ${i}`,
        thinkingContent: `thinking about ${i}`,
      });
    }
    const state = store.getState();
    const frame = ChatView.render(state, WIDTH, HEIGHT).map(plain);
    const lastThoughtIdx = frame.map((l, i) => ({ l, i })).filter((e) => e.l.includes('Thought (')).pop();
    const row = lastThoughtIdx ? lastThoughtIdx.i - 1 : -1;
    const target = ChatView.getThinkingHeaderAtRow(state, WIDTH, HEIGHT, row);
    check('TV6', target?.id === lastId, `scrolled feed: click on the drawn row targets the newest thought (row ${row})`);
  }

  // TV7: the same click while a turn is running. The activity card adds two lines the
  // hit-testers did not know about, which is why clicking an old thought did nothing.
  {
    const store = new TuiStore();
    let targetId = '';
    for (let i = 0; i < 12; i++) {
      store.addMessage({ role: 'user', content: `question ${i}` });
      const id = store.addMessage({
        role: 'assistant',
        authorName: 'Geordi',
        content: `answer ${i}`,
        thinkingContent: `thinking about ${i}`,
      });
      if (i === 11) targetId = id;
    }
    store.setState({ isGenerating: true, generationStatus: { phase: 'tool', toolName: 'read_file' } as any });
    const state = store.getState();
    const frame = ChatView.render(state, WIDTH, HEIGHT).map(plain);
    check('TV7a', frame.some((l) => l.includes('TOOL EXECUTION')), 'activity card is on screen while generating');
    const lastThought = frame.map((l, i) => ({ l, i })).filter((e) => e.l.includes('Thought (')).pop();
    const row = lastThought ? lastThought.i - 1 : -1;
    const target = ChatView.getThinkingHeaderAtRow(state, WIDTH, HEIGHT, row);
    check('TV7b', target?.id === targetId, `click while generating targets the thought under the cursor (row ${row})`);
  }

  // TV8: clicking response text must still fall through, so text selection keeps working.
  {
    const store = new TuiStore();
    store.addMessage({
      role: 'assistant',
      authorName: 'Geordi',
      content: 'Answer line one\nAnswer line two',
      thinkingContent: 'A short thought',
    });
    const state = store.getState();
    const row = clickRowOf(state, 'Answer line one');
    const target = ChatView.getThinkingHeaderAtRow(state, WIDTH, HEIGHT, row);
    check('TV8', target === undefined, `click on response text is not a thought toggle (row ${row})`);
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
