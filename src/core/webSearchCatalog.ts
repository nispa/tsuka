import * as fs from 'fs';
import { resolveAssetPath } from './apphome';

export type WebSearchValueSource =
  | { source: 'query' }
  | { source: 'maxResults' }
  | { source: 'env'; name: string }
  | { source: 'literal'; value: string | number | boolean };

export interface WebSearchJsonResponseMapping {
  itemsPath: string;
  titlePath: string;
  urlPath: string;
  snippetPath: string;
}

export interface WebSearchDomResponseMapping {
  adapter: string;
}

export interface WebSearchHttpProviderDefinition {
  displayName: string;
  hint: string;
  transport: 'json' | 'dom';
  endpoint: string;
  method: 'GET' | 'POST';
  query?: Record<string, WebSearchValueSource>;
  body?: Record<string, WebSearchValueSource>;
  headers?: Record<string, WebSearchValueSource>;
  response: WebSearchJsonResponseMapping | WebSearchDomResponseMapping;
}

interface WebSearchCatalogFile {
  version: number;
  providers: Record<string, unknown>;
}

export interface WebSearchProviderOption {
  id: string;
  displayName: string;
  hint: string;
}

export const WEB_SEARCH_CATALOG_PATH = resolveAssetPath('web_search_providers.json');

function isEnvironmentName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/.test(value);
}

function isPath(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value);
}

function parseValueSource(value: unknown, label: string): WebSearchValueSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a value source.`);
  const source = value as Record<string, unknown>;
  if (source.source === 'query' || source.source === 'maxResults') return { source: source.source };
  if (source.source === 'env' && isEnvironmentName(source.name)) return { source: 'env', name: source.name };
  if (source.source === 'literal' && (typeof source.value === 'string' || typeof source.value === 'number' || typeof source.value === 'boolean')) {
    return { source: 'literal', value: source.value };
  }
  throw new Error(`${label} is invalid.`);
}

function parseValues(value: unknown, label: string): Record<string, WebSearchValueSource> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const result: Record<string, WebSearchValueSource> = {};
  for (const [key, source] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) throw new Error(`${label} has invalid key '${key}'.`);
    const parsed = parseValueSource(source, `${label}.${key}`);
    if (/(authorization|cookie|token|key|secret)/i.test(key) && parsed.source !== 'env') {
      throw new Error(`${label}.${key} must reference an environment variable.`);
    }
    result[key] = parsed;
  }
  return result;
}

function parseHeaders(value: unknown, label: string): Record<string, WebSearchValueSource> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const result: Record<string, WebSearchValueSource> = {};
  for (const [key, header] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9-]+$/.test(key)) throw new Error(`${label} is invalid.`);
    const source = parseValueSource(header, `${label}.${key}`);
    if (/(authorization|cookie|token|key|secret)/i.test(key) && source.source !== 'env') {
      throw new Error(`${label}.${key} must reference an environment variable.`);
    }
    result[key] = source;
  }
  return result;
}

function parseProvider(id: string, value: unknown): WebSearchHttpProviderDefinition {
  if (!/^[a-z][a-z0-9-]*$/.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Provider '${id}' is invalid.`);
  const raw = value as Record<string, unknown>;
  if (typeof raw.displayName !== 'string' || !raw.displayName.trim() || typeof raw.hint !== 'string') throw new Error(`Provider '${id}' has invalid display metadata.`);
  if (raw.transport !== 'json' && raw.transport !== 'dom') throw new Error(`Provider '${id}' has invalid transport.`);
  if (raw.method !== 'GET' && raw.method !== 'POST') throw new Error(`Provider '${id}' has invalid method.`);
  if (typeof raw.endpoint !== 'string') throw new Error(`Provider '${id}' has invalid endpoint.`);
  let endpoint: URL;
  try { endpoint = new URL(raw.endpoint); } catch { throw new Error(`Provider '${id}' has invalid endpoint.`); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error(`Provider '${id}' endpoint must be credential-free HTTPS.`);
  const query = parseValues(raw.query, `Provider '${id}' query`);
  const body = parseValues(raw.body, `Provider '${id}' body`);
  const headers = parseHeaders(raw.headers, `Provider '${id}' headers`);
  if (raw.transport === 'dom') {
    if (!raw.response || typeof raw.response !== 'object' || Array.isArray(raw.response) || typeof (raw.response as Record<string, unknown>).adapter !== 'string') throw new Error(`Provider '${id}' has invalid DOM response mapping.`);
    return { displayName: raw.displayName.trim(), hint: raw.hint, transport: 'dom', endpoint: endpoint.toString(), method: raw.method, query, body, headers, response: { adapter: (raw.response as Record<string, string>).adapter } };
  }
  if (!raw.response || typeof raw.response !== 'object' || Array.isArray(raw.response)) throw new Error(`Provider '${id}' has invalid JSON response mapping.`);
  const response = raw.response as Record<string, unknown>;
  if (!isPath(response.itemsPath) || !isPath(response.titlePath) || !isPath(response.urlPath) || !isPath(response.snippetPath)) throw new Error(`Provider '${id}' has invalid JSON response mapping.`);
  return { displayName: raw.displayName.trim(), hint: raw.hint, transport: 'json', endpoint: endpoint.toString(), method: raw.method, query, body, headers, response: { itemsPath: response.itemsPath, titlePath: response.titlePath, urlPath: response.urlPath, snippetPath: response.snippetPath } };
}

/** Loads a versioned, credential-free catalog. Invalid definitions fail closed. */
export function loadWebSearchCatalog(filePath = WEB_SEARCH_CATALOG_PATH): Record<string, WebSearchHttpProviderDefinition> {
  let parsed: WebSearchCatalogFile;
  try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as WebSearchCatalogFile; }
  catch { throw new Error('Web search provider catalog could not be loaded.'); }
  if (parsed.version !== 1 || !parsed.providers || typeof parsed.providers !== 'object' || Array.isArray(parsed.providers)) throw new Error('Web search provider catalog has an unsupported version or invalid providers.');
  const providers: Record<string, WebSearchHttpProviderDefinition> = {};
  for (const [id, definition] of Object.entries(parsed.providers)) providers[id] = parseProvider(id, definition);
  if (Object.keys(providers).length === 0) throw new Error('Web search provider catalog has no providers.');
  return providers;
}

export function listWebSearchProviderOptions(catalog = loadWebSearchCatalog()): WebSearchProviderOption[] {
  return Object.entries(catalog).map(([id, definition]) => ({ id, displayName: definition.displayName, hint: definition.hint }));
}
