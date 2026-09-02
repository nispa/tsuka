import { normalizeWebSearchResult, type WebSearchResult } from '../impl/webSearchParsing';
import type { WebSearchBackend } from './types';

/**
 * Contract for an external MCP bridge. It deliberately receives only the query and may return
 * result fields; browser cookies and other session credentials never cross this boundary.
 */
export interface McpWebSearchClient {
  searchWeb(query: string): Promise<ReadonlyArray<{ title?: unknown; url?: unknown; snippet?: unknown }>>;
}

export function adaptMcpWebSearchBackend(id: string, client: McpWebSearchClient): WebSearchBackend {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('MCP web search backend id must be a non-empty kebab-case string.');
  return {
    id,
    async search(query: string): Promise<WebSearchResult[]> {
      const results = await client.searchWeb(query);
      if (!Array.isArray(results)) throw new Error(`MCP web search backend '${id}' returned an invalid result list.`);
      return results.map((result) => normalizeWebSearchResult(result.title, result.url, result.snippet));
    }
  };
}
