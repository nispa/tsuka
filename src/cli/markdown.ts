import chalk from 'chalk';
import { marked } from 'marked';
import hljs from 'highlight.js';
import wrapAnsi from 'wrap-ansi';

function hl(code: string, lang?: string): string {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code;
  }
}

/**
 * Decodes HTML entities produced by marked and highlight.js (e.g. &#39; -> ').
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Visible length of a string, ignoring ANSI escape codes — for padding/width math, not display. */
function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// Highlight.js class to chalk color mapping
const HLJS_STYLES: Record<string, (s: string) => string> = {
  keyword: chalk.magenta,
  built_in: chalk.cyan,
  type: chalk.cyan,
  literal: chalk.yellow,
  number: chalk.yellow,
  regexp: chalk.red,
  string: chalk.green,
  comment: chalk.gray,
  doctag: chalk.gray,
  meta: chalk.gray,
  title: chalk.blue,
  'function': chalk.blue,
  'class': chalk.blue,
  attr: chalk.cyan,
  attribute: chalk.cyan,
  variable: chalk.white,
  params: chalk.white,
  symbol: chalk.yellow,
  bullet: chalk.yellow,
  section: chalk.blue,
  tag: chalk.magenta,
  name: chalk.blue,
  selector: chalk.magenta,
  operator: chalk.white,
  property: chalk.cyan,
  subst: chalk.white,
};

/**
 * Converts highlight.js HTML spans into colored ANSI terminal text.
 */
function hljsHtmlToAnsi(html: string): string {
  const tagRegex = /<span class="hljs-([\w-]+)[^"]*">|<\/span>|<[^>]+>/g;
  const styleStack: Array<(s: string) => string> = [];
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;

  const emit = (text: string) => {
    if (!text) return;
    const decoded = decodeEntities(text);
    const style = styleStack.length > 0 ? styleStack[styleStack.length - 1] : null;
    out += style ? style(decoded) : decoded;
  };

  while ((match = tagRegex.exec(html)) !== null) {
    emit(html.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[0] === '</span>') {
      styleStack.pop();
    } else if (match[1] !== undefined) {
      const base = match[1].replace(/_+$/, '');
      styleStack.push(HLJS_STYLES[base] || styleStack[styleStack.length - 1] || chalk.white);
    } else if (match[0].startsWith('<span')) {
      styleStack.push(styleStack[styleStack.length - 1] || chalk.white);
    }
  }
  emit(html.slice(last));
  return out;
}

// Inline markdown tag -> ANSI style. Any tag not listed here (p, li, ul, blockquote, h1…) is
// still tracked on the stack so nesting stays balanced, but contributes no styling of its own.
const INLINE_STYLES: Record<string, (s: string) => string> = {
  strong: chalk.bold,
  b: chalk.bold,
  em: chalk.italic,
  i: chalk.italic,
  del: chalk.strikethrough,
  s: chalk.strikethrough,
  code: chalk.hex('#facc15'),
  a: chalk.cyan.underline,
};

// Tags whose open/close should also print a literal marker (styled like their content),
// beyond whatever ANSI styling INLINE_STYLES already applies — backticks read as "code" even
// when a terminal has ANSI colors disabled.
const INLINE_MARKERS: Record<string, [string, string]> = {
  code: ['`', '`'],
};

/**
 * Converts the inline HTML `marked` produces for a paragraph/heading/list-item/table-cell into
 * ANSI terminal text: bold/italic/strikethrough/inline-code get real styling instead of being
 * discarded, and links keep their destination (as trailing `(url)`) instead of silently losing
 * it. Block-level wrapper tags (`<p>`, `<li>`, …) carry no style, so they push/pop the stack as
 * harmless no-ops — no need to special-case every tag `marked` might emit.
 */
function inlineHtmlToAnsi(html: string): string {
  const tagRe = /<(\/?)([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*\/?>/g;
  const stack: Array<{ tag: string; href?: string }> = [];
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;

  const emit = (text: string) => {
    if (!text) return;
    let styled = decodeEntities(text);
    for (let i = stack.length - 1; i >= 0; i--) {
      const style = INLINE_STYLES[stack[i].tag];
      if (style) styled = style(styled);
    }
    out += styled;
  };

  while ((match = tagRe.exec(html)) !== null) {
    emit(html.slice(last, match.index));
    last = tagRe.lastIndex;
    const [, closingFlag, tagNameRaw, attrs] = match;
    const tag = tagNameRaw.toLowerCase();

    // Void elements: no closing tag will ever arrive, so never push them onto the stack.
    if (tag === 'br') { out += '\n'; continue; }
    if (tag === 'img') {
      const alt = decodeEntities(attrs.match(/alt="([^"]*)"/)?.[1] || 'image');
      const src = decodeEntities(attrs.match(/src="([^"]*)"/)?.[1] || '');
      out += chalk.cyan(`🖼 ${alt}`) + (src ? chalk.gray(` (${src})`) : '');
      continue;
    }

    if (closingFlag) {
      const openIdx = (() => {
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) return i;
        return -1;
      })();
      if (openIdx === -1) continue; // unmatched close (malformed HTML): ignore rather than corrupt the stack
      const opener = stack[openIdx];
      const marker = INLINE_MARKERS[tag];
      if (marker) emit(marker[1]);
      stack.length = openIdx;
      if (tag === 'a' && opener.href) out += chalk.gray(` (${opener.href})`);
    } else {
      const entry: { tag: string; href?: string } = { tag };
      if (tag === 'a') entry.href = decodeEntities(attrs.match(/href="([^"]*)"/)?.[1] || '') || undefined;
      stack.push(entry);
      const marker = INLINE_MARKERS[tag];
      if (marker) emit(marker[0]);
    }
  }
  emit(html.slice(last));
  return out;
}

/** Column widths for a table: natural per-column max, shrunk proportionally to fit innerWidth. */
function tableColumnWidths(headerCells: string[], bodyRows: string[][], innerWidth: number): number[] {
  const colCount = headerCells.length;
  const natural = Array.from({ length: colCount }, (_, i) => {
    const headerW = visibleLength(headerCells[i] || '');
    const bodyW = bodyRows.reduce((max, row) => Math.max(max, visibleLength(row[i] || '')), 0);
    return Math.max(3, headerW, bodyW);
  });

  const separatorOverhead = Math.max(0, colCount - 1) * 3; // " │ " between each pair of columns
  const naturalTotal = natural.reduce((a, b) => a + b, 0);
  if (naturalTotal + separatorOverhead <= innerWidth) return natural;

  const minWidth = 4;
  const budget = Math.max(colCount * minWidth, innerWidth - separatorOverhead);
  const scale = budget / naturalTotal;
  return natural.map((w) => Math.max(minWidth, Math.floor(w * scale)));
}

/** Pads a (possibly ANSI-styled) cell to `width` visible columns, per its column's alignment. */
function padCell(text: string, width: number, align: 'left' | 'center' | 'right' | null): string {
  const gap = Math.max(0, width - visibleLength(text));
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

/** Renders markdown into wrapped terminal lines for boxed panel output. */
export function renderMarkdownToLines(md: string, innerWidth: number): string[] {
  const tokens = marked.lexer(md);
  const lines: string[] = [];

  const pushWrapped = (text: string, style: (s: string) => string, indent = 0) => {
    const targetWidth = Math.max(4, innerWidth - indent);
    const wrapped = wrapAnsi(text, targetWidth, { hard: true, trim: false, wordWrap: true });
    for (const line of wrapped.split(/\r?\n/)) {
      lines.push(' '.repeat(indent) + style(line));
    }
  };

  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const level = (t as any).depth;
        const txt = inlineHtmlToAnsi(marked.parser([t] as any)).trim();
        const size = level === 1 ? 2 : level === 2 ? 1 : 0;
        const styled = chalk.bold.cyan('#'.repeat(size) + ' ' + txt);
        lines.push(styled);
        lines.push('');
        break;
      }
      case 'paragraph': {
        const html = marked.parser([t] as any);
        const txt = inlineHtmlToAnsi(html).trim();
        pushWrapped(txt, chalk.white);
        lines.push('');
        break;
      }
      case 'list': {
        const list = t as any;
        const items = list.items as any[];
        const ordered = !!list.ordered;
        const start = typeof list.start === 'number' ? list.start : 1;
        items.forEach((it, idx) => {
          const txt = inlineHtmlToAnsi(marked.parser(it.tokens as any)).trim();
          const marker = it.task ? (it.checked ? '☑ ' : '☐ ') : ordered ? `${start + idx}. ` : '• ';
          pushWrapped(marker + txt, chalk.white, 2);
        });
        lines.push('');
        break;
      }
      case 'table': {
        const table = t as any;
        const align = (table.align || []) as Array<'left' | 'center' | 'right' | null>;
        const headerCells = table.header.map((c: any) => inlineHtmlToAnsi(marked.parser(c.tokens)).trim());
        const bodyRows = table.rows.map((row: any) => row.map((c: any) => inlineHtmlToAnsi(marked.parser(c.tokens)).trim()));
        const colWidths = tableColumnWidths(headerCells, bodyRows, innerWidth);

        const fit = (cell: string, width: number) => wrapAnsi(cell, width, { hard: true, trim: false }).split(/\r?\n/)[0];
        const renderRow = (cells: string[], style: (s: string) => string) =>
          cells.map((cell, i) => padCell(style(fit(cell, colWidths[i])), colWidths[i], align[i] ?? null)).join(chalk.gray(' │ '));

        lines.push(renderRow(headerCells, chalk.bold.cyan));
        lines.push(chalk.gray(colWidths.map((w) => '─'.repeat(w)).join('─┼─')));
        for (const row of bodyRows) lines.push(renderRow(row, chalk.white));
        lines.push('');
        break;
      }
      case 'code': {
        const lang = (t as any).lang;
        const code = ((t as any).text || '').replace(/\r/g, '').replace(/\t/g, '  ');
        const highlighted = hljsHtmlToAnsi(hl(code, lang));
        const maxCodeWidth = Math.max(4, innerWidth - 4);
        const header = chalk.gray(`── ${lang || 'code'} ${'─'.repeat(Math.max(0, innerWidth - (lang || 'code').length - 5))}`);
        lines.push(chalk.gray(header));
        for (const cl of highlighted.split(/\r?\n/)) {
          const wrapped = wrapAnsi(cl, maxCodeWidth, { hard: true, trim: false });
          for (const wl of wrapped.split(/\r?\n/)) {
            lines.push(chalk.gray('│ ') + wl);
          }
        }
        lines.push(chalk.gray('└' + '─'.repeat(Math.max(0, innerWidth - 1))));
        lines.push('');
        break;
      }
      case 'blockquote': {
        const html = marked.parser([t] as any);
        const txt = inlineHtmlToAnsi(html).trim();
        pushWrapped(txt, chalk.italic.gray, 2);
        lines.push('');
        break;
      }
      case 'hr': {
        lines.push(chalk.gray('─'.repeat(innerWidth)));
        lines.push('');
        break;
      }
      default: {
        const html = marked.parser([t] as any);
        if (html && html.trim()) {
          pushWrapped(inlineHtmlToAnsi(html).trim(), chalk.white);
          lines.push('');
        }
      }
    }
  }

  return lines;
}
