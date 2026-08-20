/**
 * Tests for T18.8 — markdown tables in the documentation stay well formed.
 *
 * A pipe inside inline code is still a cell separator for the table parser: the README row
 * `/benchmark [model|all]` was rendered with "all]" pushed into the next column, and the
 * whole table shifted from there. The escape (backslash before the pipe) is the fix, and
 * this suite is what keeps it: every documented table row must have exactly as many cells
 * as its header.
 *
 * Isolated run: npx tsx tests/test_markdown_tables.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

/** Backslash, built from its code point: writing it inline invites escaping accidents. */
const BS = String.fromCharCode(92);

/** Documentation the project ships. Workspace scratch files are none of our business. */
function documentedFiles(): string[] {
  const roots = ['README.md', 'README-it.md', 'SECURITY.md', 'AGENTS.md', 'TASKS.md'];
  const files = roots.filter((f) => fs.existsSync(f));
  if (fs.existsSync('docs')) {
    for (const name of fs.readdirSync('docs')) {
      if (name.endsWith('.md')) files.push(path.join('docs', name));
    }
  }
  return files;
}

/** Cells of a table row, splitting on unescaped pipes only. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '|' && inner[i - 1] !== BS) { out.push(cur); cur = ''; }
    else cur += inner[i];
  }
  out.push(cur);
  return out;
}

/** Table rows of a file, grouped per table, fenced code blocks excluded. */
function tableRows(content: string): Array<{ line: number; text: string; headerLine: number; headerCells: number }> {
  const rows: Array<{ line: number; text: string; headerLine: number; headerCells: number }> = [];
  let inFence = false;
  let headerCells = 0;
  let headerLine = 0;

  content.split(/\r?\n/).forEach((text, idx) => {
    if (/^\s*```/.test(text)) { inFence = !inFence; return; }
    if (inFence) return;
    const isRow = /^\s*\|/.test(text) && text.trim().endsWith('|');
    if (!isRow) { headerCells = 0; return; }
    if (headerCells === 0) {
      headerCells = cells(text).length;
      headerLine = idx + 1;
      return;
    }
    rows.push({ line: idx + 1, text, headerLine, headerCells });
  });

  return rows;
}

describe('Documentation markdown tables (T18.8)', () => {

  it('has tables to check', () => {
    const total = documentedFiles().reduce((n, f) => n + tableRows(fs.readFileSync(f, 'utf8')).length, 0);
    assert.ok(total > 20, `the scan must actually reach the tables, found ${total} rows`);
  });

  it('never leaves a pipe unescaped inside inline code', () => {
    const offenders: string[] = [];
    for (const file of documentedFiles()) {
      for (const row of tableRows(fs.readFileSync(file, 'utf8'))) {
        const spans = row.text.match(/`[^`]*`/g) || [];
        const bad = spans.some((span) => {
          for (let i = 0; i < span.length; i++) {
            if (span[i] === '|' && span[i - 1] !== BS) return true;
          }
          return false;
        });
        if (bad) offenders.push(`${file}:${row.line}: ${row.text.trim().slice(0, 100)}`);
      }
    }
    assert.deepStrictEqual(offenders, [], 'a pipe inside code still splits the cell: escape it');
  });

  it('keeps every row as wide as its header', () => {
    const offenders: string[] = [];
    for (const file of documentedFiles()) {
      for (const row of tableRows(fs.readFileSync(file, 'utf8'))) {
        const count = cells(row.text).length;
        if (count !== row.headerCells) {
          offenders.push(`${file}:${row.line}: ${count} cells, header at line ${row.headerLine} has ${row.headerCells}`);
        }
      }
    }
    assert.deepStrictEqual(offenders, [], 'a row wider than its header spills into the next column');
  });

});
