import { loadWebSearchCatalog, type WebSearchDomResponseMapping, type WebSearchHttpProviderDefinition, type WebSearchJsonResponseMapping, type WebSearchValueSource } from '../../core/webSearchCatalog';
import { safeFetch } from '../../core/network';
import { TOOLS_DEFAULTS } from '../../core/constants';
import { normalizeWebSearchResult, parseDuckDuckGoResults, type WebSearchResult } from '../impl/webSearchParsing';
import type { WebSearchBackend } from './types';

type DomResponseAdapter = (html: string) => WebSearchResult[];
export type WebSearchHttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const domResponseAdapters = new Map<string, DomResponseAdapter>();

/** DuckDuckGo is HTML, so its parser is a registered adapter rather than a provider branch. */
export function registerWebSearchDomAdapter(id: string, adapter: DomResponseAdapter): void {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Web search DOM adapter id must be a non-empty kebab-case string.');
  domResponseAdapters.set(id, adapter);
}

function resolveValue(source: WebSearchValueSource, query: string): string | number | boolean {
  if (source.source === 'query') return query;
  if (source.source === 'maxResults') return TOOLS_DEFAULTS.webSearchMaxResults;
  if (source.source === 'literal') return source.value;
  const value = process.env[source.name];
  if (!value) throw new Error(`Required environment variable '${source.name}' is not configured.`);
  return value;
}

function addQuery(url: URL, values: Record<string, WebSearchValueSource> | undefined, query: string): void {
  for (const [name, source] of Object.entries(values ?? {})) url.searchParams.set(name, String(resolveValue(source, query)));
}

function buildBody(values: Record<string, WebSearchValueSource> | undefined, query: string): string | undefined {
  if (!values) return undefined;
  const body: Record<string, string | number | boolean> = {};
  for (const [name, source] of Object.entries(values)) body[name] = resolveValue(source, query);
  return JSON.stringify(body);
}

function buildHeaders(values: Record<string, WebSearchValueSource> | undefined, query: string): Record<string, string> | undefined {
  if (!values) return undefined;
  const headers: Record<string, string> = {};
  for (const [name, source] of Object.entries(values)) headers[name] = String(resolveValue(source, query));
  return headers;
}

function redactProviderCredentials(message: string, definition: WebSearchHttpProviderDefinition): string {
  const sources = [definition.query, definition.body, definition.headers]
    .flatMap((values) => Object.values(values ?? {}));
  let safe = message;
  for (const source of sources) {
    if (source.source !== 'env') continue;
    const value = process.env[source.name];
    if (value) safe = safe.split(value).join('[REDACTED]');
  }
  return safe;
}

function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function parseJsonResponse(data: unknown, mapping: WebSearchJsonResponseMapping): WebSearchResult[] {
  const items = readPath(data, mapping.itemsPath);
  if (!Array.isArray(items)) return [];
  const results: WebSearchResult[] = [];
  for (const item of items) {
    const result = normalizeWebSearchResult(readPath(item, mapping.titlePath), readPath(item, mapping.urlPath), readPath(item, mapping.snippetPath));
    if (!result.title || !result.url) continue;
    results.push(result);
    if (results.length >= TOOLS_DEFAULTS.webSearchMaxResults) break;
  }
  return results;
}

function parseDomResponse(html: string, mapping: WebSearchDomResponseMapping): WebSearchResult[] {
  const adapter = domResponseAdapters.get(mapping.adapter);
  if (!adapter) throw new Error(`Web search DOM adapter '${mapping.adapter}' is not registered.`);
  return adapter(html).slice(0, TOOLS_DEFAULTS.webSearchMaxResults);
}

/** Native HTTP backend driven entirely by the validated versioned provider catalog. */
export class HttpWebSearchBackend implements WebSearchBackend {
  readonly id: string;
  private readonly definition: WebSearchHttpProviderDefinition;
  private readonly request: WebSearchHttpFetch;

  constructor(provider: string, catalog = loadWebSearchCatalog(), request: WebSearchHttpFetch = safeFetch) {
    const id = provider.trim().toLowerCase();
    const definition = catalog[id];
    if (!definition) throw new Error(`Unknown HTTP web search provider '${id}'.`);
    this.id = `http:${id}`;
    this.definition = definition;
    this.request = request;
  }

  async search(query: string): Promise<WebSearchResult[]> {
    const url = new URL(this.definition.endpoint);
    try {
      addQuery(url, this.definition.query, query);
      const body = buildBody(this.definition.body, query);
      const headers = buildHeaders(this.definition.headers, query);
      const response = await this.request(url, {
        method: this.definition.method,
        headers,
        body,
      });
      if (!response.ok) throw new Error(`HTTP status ${response.status}.`);
      return this.definition.transport === 'dom'
        ? parseDomResponse(await response.text(), this.definition.response as WebSearchDomResponseMapping)
        : parseJsonResponse(await response.json(), this.definition.response as WebSearchJsonResponseMapping);
    } catch (error: unknown) {
      const message = redactProviderCredentials(error instanceof Error ? error.message : 'Unknown error.', this.definition);
      // Values resolved from env are never interpolated into errors or logs.
      throw new Error(`Web search provider '${this.id}' failed: ${message}`);
    }
  }
}

registerWebSearchDomAdapter('duckduckgo-html-v1', parseDuckDuckGoResults);
