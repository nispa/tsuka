/**
 * Soft wrapping of the TUI prompt: a long line continues on the next row instead of
 * running off the pane, the cursor stays visible, and the prompt grows to its maximum
 * height and then scrolls. Real newlines (Shift/Ctrl+Enter) keep their own marker.
 *
 * Run: npx tsx tests/test_prompt_wrap.ts
 */
import { wrapPrompt, cursorRow, promptTextWidth } from '../src/tui/promptWrap';
import { computeInputHeight } from '../src/tui/interaction/geometry';
import { InputView } from '../src/tui/views/Input';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { BoxDrawing } from '../src/tui/boxDrawing';
import { TUI_DEFAULTS } from '../src/core/constants';

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

const rowsText = (text: string, width: number) => wrapPrompt(text, width).map((r) => text.slice(r.start, r.end));

function main(): void {
  // --- wrapping ---
  const words = rowsText('alpha beta gamma delta', 12);
  check('PW.1', words.join('|') === 'alpha beta |gamma delta', `breaks after the last space that fits (${words.join('|')})`);

  const long = rowsText('abcdefghijklmnop', 5);
  check('PW.2', long.join('|') === 'abcde|fghij|klmno|p', `a word longer than the row is split (${long.join('|')})`);

  const text = 'first line that wraps\nsecond';
  const rows = wrapPrompt(text, 10);
  check('PW.3', rows.map((r) => `${r.line}${r.firstOfLine ? '*' : ''}`).join(' ') === '0* 0 0 1*',
    'rows remember their logical line; only the first row of each line is marked');
  check('PW.4', rows.every((r, i) => i === 0 || r.start >= rows[i - 1].end) && text.slice(rows[3].start, rows[3].end) === 'second',
    'row offsets point into the original text');

  const emoji = rowsText('🖖🖖🖖🖖', 4);
  check('PW.5', emoji.every((r) => BoxDrawing.stringWidth(r) <= 4) && emoji.join('') === '🖖🖖🖖🖖',
    `wide characters are measured in columns and never split (${emoji.join('|')})`);

  // --- cursor ---
  const full = 'abcde';
  const fullRows = wrapPrompt(full, 5);
  check('PW.6', fullRows.length === 2 && cursorRow(fullRows, 5) === 1, 'a cursor after a full row moves to a new empty row, so it stays visible');
  const soft = wrapPrompt('alpha beta', 6);
  check('PW.7', cursorRow(soft, 6) === 1 && cursorRow(soft, 5) === 0, 'at a soft break the cursor belongs to the next row');
  const hard = wrapPrompt('ab\ncd', 10);
  check('PW.8', cursorRow(hard, 2) === 0 && cursorRow(hard, 3) === 1, 'at a real newline the cursor ends its own line');

  // --- height and rendering ---
  const paneWidth = 40;
  const sentence = 'word '.repeat(40).trim();
  check('PW.9', computeInputHeight('short', paneWidth) === TUI_DEFAULTS.inputMinLines, 'a short prompt keeps the minimum height');
  check('PW.10', computeInputHeight(sentence, paneWidth) === TUI_DEFAULTS.inputMaxLines, 'a long single line grows the prompt to its maximum height');

  const store = new TuiStore();
  store.setState({ focus: 'input' });
  store.setInputText(sentence, sentence.length);
  const height = computeInputHeight(sentence, paneWidth);
  const drawn = InputView.render(store.getState(), paneWidth, height).map((l) => TuiScreen.stripAnsi(l));
  const lastRow = drawn[drawn.length - 2].slice(1, -1).trimEnd();
  check('PW.11', drawn.every((l) => TuiScreen.stringWidth(l) === paneWidth), 'every row keeps the pane width');
  check('PW.12', lastRow.endsWith('word') && !drawn[1].includes('❯'),
    'the visible window follows the cursor to the end of a long prompt, scrolling the first rows away');
  check('PW.13', promptTextWidth(paneWidth) === paneWidth - 6, 'text width leaves room for borders and the prompt marker');

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
