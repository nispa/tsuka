import type { WebSearchResult } from '../impl/webSearchParsing';

/**
 * What the provider actually answered, for the human inspecting a search (Tools view).
 * Never sent to the model: a raw HTML page would only burn its context.
 */
export interface WebSearchTrace {
  provider: string;
  /** Method and URL, with credentials redacted. */
  request: string;
  status: number;
  statusText: string;
  contentType: string;
  bytes: number;
  results: number;
  /** Response body, capped at TOOLS_DEFAULTS.webSearchTraceMaxChars. */
  body: string;
}

/**
 * Narrow capability contract. Backends return data only; the public tool owns formatting
 * and context capping. `onTrace` receives the raw exchange when the backend has one.
 */
export interface WebSearchBackend {
  readonly id: string;
  search(query: string, onTrace?: (trace: WebSearchTrace) => void): Promise<WebSearchResult[]>;
}

export interface WebSearchBackendFactoryContext {
  provider: string;
}

export type WebSearchBackendFactory = (context: WebSearchBackendFactoryContext) => WebSearchBackend;
