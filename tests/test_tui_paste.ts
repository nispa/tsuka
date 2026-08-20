/**
 * Tests for T18.7 — pasting multi-line text into the prompt.
 *
 * Without bracketed paste the terminal hands a pasted block over as plain bytes: every
 * newline in it is a CR, every CR is Enter, so the prompt submitted the first line and
 * queued the rest as separate turns. The fix enables DECSET 2004 and treats what arrives
 * between the markers as text, never as keys.
 *
 * Isolated run: npx tsx tests/test_tui_paste.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { InputParser } from '../src/tui/inputParser';
import { TuiStore } from '../src/tui/store';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

describe('Bracketed paste parsing (T18.7)', () => {

  it('turns a multi-line paste into one text event, not a run of Enters', () => {
    InputParser.__resetPasteStateForTest();
    const { keys } = InputParser.parse(PASTE_START + 'first line\nsecond line' + PASTE_END);
    assert.strictEqual(keys.length, 1, 'a paste is a single event');
    assert.strictEqual(keys[0].name, 'paste');
    assert.strictEqual(keys[0].char, 'first line\nsecond line');
    assert.ok(!keys.some((k) => k.name === 'return'), 'no Enter is synthesized from the paste');
  });

  it('normalizes CR and CRLF inside the pasted text', () => {
    InputParser.__resetPasteStateForTest();
    const { keys } = InputParser.parse(PASTE_START + 'a\r\nb\rc' + PASTE_END);
    assert.strictEqual(keys[0].char, 'a\nb\nc');
  });

  it('holds a paste split across stdin chunks until its closing marker', () => {
    InputParser.__resetPasteStateForTest();
    const first = InputParser.parse(PASTE_START + 'line one\r');
    assert.strictEqual(first.keys.length, 0, 'nothing is emitted while the paste is incomplete');

    const second = InputParser.parse('line two' + PASTE_END);
    assert.strictEqual(second.keys.length, 1);
    assert.strictEqual(second.keys[0].char, 'line one\nline two');
  });

  it('keeps parsing keys around the paste', () => {
    InputParser.__resetPasteStateForTest();
    const { keys } = InputParser.parse('ab' + PASTE_START + 'x\ny' + PASTE_END + '\r');
    assert.deepStrictEqual(keys.map((k) => k.name), ['a', 'b', 'paste', 'return']);
    assert.strictEqual(keys[2].char, 'x\ny');
  });

  it('leaves a bare CR outside a paste as Enter', () => {
    InputParser.__resetPasteStateForTest();
    const { keys } = InputParser.parse('hi\r');
    assert.deepStrictEqual(keys.map((k) => k.name), ['h', 'i', 'return']);
  });

  it('inserts pasted text at the cursor, newlines included', () => {
    const store = new TuiStore();
    store.setInputText('run: ', 5);
    store.insertInputText('one\ntwo');
    assert.strictEqual(store.getState().inputText, 'run: one\ntwo');
    assert.strictEqual(store.getState().inputCursor, 12, 'the cursor lands after the pasted block');
    assert.strictEqual(store.commitInput(), 'run: one\ntwo', 'the whole block is submitted as one prompt');
  });

});
