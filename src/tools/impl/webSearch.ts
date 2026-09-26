import { Tool, ToolExecutionContext } from '../registry';
import type { WebSearchTrace } from '../webSearch/types';
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
  execute: async (args: { query: string }, context?: ToolExecutionContext) => {
    const config = configCache.get();
    const backend = createWebSearchBackend(config.getWebSearchBackend(), { provider: config.getWebSearchProvider() });
    const onTrace = (trace: WebSearchTrace) =>
      context?.onEvent?.({ type: 'tool_diagnostics', name: 'web_search', text: formatWebSearchTrace(trace), agentLabel: context.requesterLabel });
    const result = formatWebSearchResults(normalizeWebSearchResults(await backend.search(args.query, onTrace)));

    return capForContext(result, undefined, {
      label: `search results for "${args.query}"`,
      recoveryHint: `Narrow your web_search query, or use browse_url on the most promising result URL.`
    });
  }
};

/** The raw exchange as the Tools view shows it: request, status, headers of interest, body. */
export function formatWebSearchTrace(trace: WebSearchTrace): string {
  return [
    `provider: ${trace.provider}`,
    `request:  ${trace.request}`,
    `status:   ${trace.status} ${trace.statusText}`.trimEnd(),
    `type:     ${trace.contentType}`,
    `size:     ${trace.bytes} bytes · ${trace.results} result(s) parsed`,
    '',
    trace.body,
  ].join('\n');
}

/** Resolves the configured provider through the local hot-path snapshot. */
export function getConfiguredWebSearchProvider(): string {
  return configCache.get().getWebSearchProvider();
}

/** Exposes cache counters so regression tests can prove search calls do not reload config. */
export function getWebSearchConfigCacheMetrics() {
  return configCache.getMetrics();
}
