import { BoxDrawing } from './boxDrawing';

/**
 * Soft wrapping of the prompt: the text stays one logical line (Enter still sends it,
 * Shift/Ctrl+Enter still inserts a real newline) but is drawn over as many rows as the
 * pane width needs. Rows keep offsets into the original text, so the cursor — an index
 * into that text — maps to exactly one row and column.
 */

export interface PromptRow {
  /** Offsets into the full input text: the row shows text.slice(start, end). */
  start: number;
  end: number;
  /** First row of a logical line (after a real newline, or the very first row). */
  firstOfLine: boolean;
  /** Index of the logical line the row belongs to. */
  line: number;
}

/** Columns of the pane left for text: box borders and the "❯ " prefix take the rest. */
export function promptTextWidth(paneWidth: number): number {
  return Math.max(8, paneWidth - 6);
}

function charAt(text: string, index: number): string {
  const code = text.codePointAt(index)!;
  return String.fromCodePoint(code);
}

/**
 * Wraps each logical line at `rowWidth` display columns, breaking after the last space
 * that fits when there is one, inside a word otherwise. A row that ends exactly full
 * gets an empty row after it, so a cursor at the end of the text always has a column.
 */
export function wrapPrompt(text: string, rowWidth: number): PromptRow[] {
  const rows: PromptRow[] = [];
  let base = 0;
  text.split('\n').forEach((lineText, line) => {
    let pos = 0;
    let first = true;
    let lastFull = false;
    if (lineText.length === 0) rows.push({ start: base, end: base, firstOfLine: true, line });
    while (pos < lineText.length) {
      let end = pos;
      let used = 0;
      while (end < lineText.length) {
        const ch = charAt(lineText, end);
        const w = BoxDrawing.stringWidth(ch);
        if (used + w > rowWidth) break;
        used += w;
        end += ch.length;
      }
      if (end < lineText.length) {
        const space = lineText.lastIndexOf(' ', end - 1);
        if (space >= pos) end = space + 1;
        if (end === pos) end = pos + charAt(lineText, pos).length;
      }
      rows.push({ start: base + pos, end: base + end, firstOfLine: first, line });
      lastFull = end >= lineText.length && used >= rowWidth;
      first = false;
      pos = end;
    }
    if (lastFull) rows.push({ start: base + lineText.length, end: base + lineText.length, firstOfLine: false, line });
    base += lineText.length + 1;
  });
  return rows;
}

/** Row holding the cursor: inside [start, end), or at the end of its logical line's last row. */
export function cursorRow(rows: PromptRow[], cursor: number): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isLastOfLine = i === rows.length - 1 || rows[i + 1].line !== row.line;
    if (cursor >= row.start && (cursor < row.end || (isLastOfLine && cursor === row.end))) return i;
  }
  return Math.max(0, rows.length - 1);
}
