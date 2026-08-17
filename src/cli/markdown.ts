import chalk from 'chalk';
import { marked } from 'marked';
import hljs from 'highlight.js';
import wrapAnsi from 'wrap-ansi';

interface RenderLine { text: string; }

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

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
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

/** Converts marked HTML to plain terminal text. */
function htmlToText(s: string): string {
  return decodeEntities(stripTags(s));
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
        const txt = htmlToText(marked.parser([t] as any)).trim();
        const size = level === 1 ? 2 : level === 2 ? 1 : 0;
        const styled = chalk.bold.cyan('#'.repeat(size) + ' ' + txt);
        lines.push(styled);
        lines.push('');
        break;
      }
      case 'paragraph': {
        const html = marked.parser([t] as any);
        const txt = htmlToText(html).trim();
        pushWrapped(txt, chalk.white);
        lines.push('');
        break;
      }
      case 'list': {
        const items = (t as any).items as any[];
        for (const it of items) {
          const txt = htmlToText(marked.parser(it.tokens as any)).trim();
          pushWrapped('• ' + txt, chalk.white, 2);
        }
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
        const txt = htmlToText(html).trim();
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
          pushWrapped(htmlToText(html).trim(), chalk.white);
          lines.push('');
        }
      }
    }
  }

  return lines;
}
