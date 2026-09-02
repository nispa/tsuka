import { Tool } from '../registry';
import { capForContext } from '../../core/contextBudget';
import { createHotPathConfigCache } from '../../core/config/hotPathCache';
import { formatWebSearchResults, normalizeWebSearchResults } from './webSearchParsing';
import { createWebSearchBackend, registerWebSearchBackend } from '../webSearch/registry';
import { HttpWebSearchBackend } from '../webSearch/httpBackend';
import { loadWebSearchCatalog } from '../../core/webSearchCatalog';

const configCache = createHotPathConfigCache();
// The built-in catalog is immutable process configuration; loading it once keeps
// synchronous filesystem access out of the per-search execution path.
const httpCatalog = loadWebSearchCatalog();

registerWebSearchBackend('http', ({ provider }) => new HttpWebSearchBackend(provider, httpCatalog));

export const webSearchTool: Tool = {
  name: 'web_search',
  riskLevel: 'SAFE',
  execute: async (args: { query: string }) => {
    const config = configCache.get();
    const backend = createWebSearchBackend(config.getWebSearchBackend(), { provider: config.getWebSearchProvider() });
    const result = formatWebSearchResults(normalizeWebSearchResults(await backend.search(args.query)));

    return capForContext(result, undefined, {
      label: `search results for "${args.query}"`,
      recoveryHint: `Narrow your web_search query, or use browse_url on the most promising result URL.`
    });
  }
};

/** Resolves the configured provider through the local hot-path snapshot. */
export function getConfiguredWebSearchProvider(): string {
  return configCache.get().getWebSearchProvider();
}

/** Exposes cache counters so regression tests can prove search calls do not reload config. */
export function getWebSearchConfigCacheMetrics() {
  return configCache.getMetrics();
}
