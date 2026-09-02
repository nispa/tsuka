import { parse } from 'node-html-parser';
import { TOOLS_DEFAULTS } from '../../core/constants';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Converts DOM text into bounded plain text. Search-page content is untrusted prompt input,
 * so formatting is flattened instead of allowing page HTML or Markdown to control the output.
 */
export function normalizeWebSearchText(value: unknown, maxChars: number): string {
  const singleLine = (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return singleLine.length > maxChars ? `${singleLine.slice(0, Math.max(0, maxChars - 1))}…` : singleLine;
}

function normalizeResultUrl(value: unknown): string {
  let url = normalizeWebSearchText(value, TOOLS_DEFAULTS.webSearchUrlMaxChars);
  if (url.includes('uddg=')) {
    const parameter = url.split('uddg=')[1]?.split('&')[0];
    if (parameter) {
      try {
        url = decodeURIComponent(parameter);
      } catch {
        // Keep the original link when a malformed redirect parameter cannot be decoded.
      }
    }
  }
  return url.startsWith('//') ? `https:${url}` : url;
}

/** Applies the shared trust boundary to results returned by HTML and JSON providers. */
export function normalizeWebSearchResult(title: unknown, url: unknown, snippet: unknown): WebSearchResult {
  return {
    title: normalizeWebSearchText(title, TOOLS_DEFAULTS.webSearchTitleMaxChars),
    url: normalizeResultUrl(url),
    snippet: normalizeWebSearchText(snippet, TOOLS_DEFAULTS.webSearchSnippetMaxChars),
  };
}

/** Re-applies the trust boundary at the public capability edge, including plugin backends. */
export function normalizeWebSearchResults(results: ReadonlyArray<Partial<WebSearchResult>>): WebSearchResult[] {
  const normalized: WebSearchResult[] = [];
  for (const result of results) {
    const safe = normalizeWebSearchResult(result.title, result.url, result.snippet);
    if (!safe.title || !safe.url) continue;
    normalized.push(safe);
    if (normalized.length >= TOOLS_DEFAULTS.webSearchMaxResults) break;
  }
  return normalized;
}

/**
 * Parses DuckDuckGo's result DOM without regular-expression tag stripping. The parser decodes
 * entities and tolerates malformed markup; script/style nodes are excluded before text access.
 */
export function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const document = parse(html, { lowerCaseTagName: true });
  for (const ignored of document.querySelectorAll('script, style')) ignored.remove();

  const blocks = document.querySelectorAll('.web-result');
  const results: WebSearchResult[] = [];
  for (const block of blocks) {
    const titleAnchor = block.querySelector('.result__a');
    if (!titleAnchor) continue;

    const snippetNode = block.querySelector('.result__snippet');
    const result = normalizeWebSearchResult(
      titleAnchor.text,
      titleAnchor.getAttribute('href') ?? '',
      snippetNode?.text ?? '',
    );
    if (!result.title || !result.url) continue;
    results.push(result);
    if (results.length >= TOOLS_DEFAULTS.webSearchMaxResults) break;
  }
  return results;
}

/** Formats untrusted search results as plain labelled fields instead of executable Markdown. */
export function formatWebSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) return 'No useful web search results found.';
  return normalizeWebSearchResults(results).map((result, index) => [
    `[Untrusted web result ${index + 1}]`,
    `Title: ${result.title}`,
    `URL: ${result.url}`,
    `Snippet: ${result.snippet || '(none)'}`
  ].join('\n')).join('\n\n');
}
