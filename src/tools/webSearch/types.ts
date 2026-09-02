import type { WebSearchResult } from '../impl/webSearchParsing';

/** Narrow capability contract. Backends return data only; the public tool owns formatting and context capping. */
export interface WebSearchBackend {
  readonly id: string;
  search(query: string): Promise<WebSearchResult[]>;
}

export interface WebSearchBackendFactoryContext {
  provider: string;
}

export type WebSearchBackendFactory = (context: WebSearchBackendFactoryContext) => WebSearchBackend;
