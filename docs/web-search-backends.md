# Web Search Backends and the MCP Adapter Contract

TSUKA exposes one LLM-facing tool, `web_search`. The tool delegates retrieval to a
`WebSearchBackend`, then owns normalization, result limits, formatting, and context
capping. Backends return data; they do not format prompt text.

## Choosing a search provider

The active provider is chosen with `/search-engine <name>` (or `webSearch.provider` in
`tsuka.config.json`). The built-in catalog, `web_search_providers.json`, ships two:

| Provider | Key | Notes |
|---|---|---|
| `duckduckgo` | none | Reads DuckDuckGo's HTML results page. DuckDuckGo may answer automated requests with a bot-detection page (HTTP 202); `web_search` then fails with an explicit error instead of reporting "no results". Retry later or switch provider. |
| `tavily` | `TAVILY_API_KEY` | JSON search API built for agents. The free plan gives 1,000 credits a month (one basic search = one credit) and needs no credit card; without a card nothing can be charged, searches simply fail until the next month. |

To use Tavily: create an account at tavily.com, put the key in `.env` as
`TAVILY_API_KEY=tvly-...`, then run `/search-engine tavily`. The key never reaches shell
commands or MCP servers, and any tool result that happens to contain it is redacted
(see the credential policy in [security](security.md)).

Google's Custom Search JSON API was removed from the catalog: it is closed to new
customers and shuts down on 1 January 2027. A keyless local option, a SearXNG instance,
is planned (T24.14): it needs an explicit network allowlist entry, because the SSRF
policy otherwise refuses loopback addresses and non-standard ports.

## Seeing what the server answered

Every `web_search` call records the raw exchange with the provider: the request (with
credentials redacted), HTTP status, content type, size, how many results were parsed,
and the response body (up to `webSearchTraceMaxChars`). Open the Tools view (F2) to read
it under the call, in the `server:` section. It is shown to you only: the model receives
the formatted results, never the raw page.

Only an HTTP 200 carries results. Any other status is reported as an error naming the
status, so a blocked or rate-limited provider cannot pass for an empty search.

## Backend contract

```ts
interface WebSearchBackend {
  readonly id: string;
  // onTrace receives the raw exchange (status, body, ...) for the Tools view, when the
  // backend has one; it never reaches the model.
  search(query: string, onTrace?: (trace: WebSearchTrace) => void): Promise<WebSearchResult[]>;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}
```

A backend factory receives the configured provider name. Register the factory before
the first `web_search` execution:

```ts
import { registerWebSearchBackend } from '../src/tools/webSearch';

registerWebSearchBackend('my-backend', ({ provider }) => {
  return createMyBackend(provider);
});
```

Select it in `tsuka.config.json`:

```json
{
  "webSearch": {
    "backend": "my-backend",
    "provider": "my-provider"
  }
}
```

The built-in `http` backend reads providers from `web_search_providers.json`. The
catalog contains endpoint and mapping data, but credential fields may only reference
environment-variable names. Secret values belong in `.env` and are resolved only when
the request is built.

## MCP client adapter

`adaptMcpWebSearchBackend` adapts a narrow client owned by an integration layer:

```ts
interface McpWebSearchClient {
  searchWeb(query: string): Promise<ReadonlyArray<{
    title?: unknown;
    url?: unknown;
    snippet?: unknown;
  }>>;
}
```

The client decides how to call the remote MCP server. The adapter deliberately knows
nothing about MCP JSON-RPC, process lifecycle, browser profiles, or credentials.

```ts
import {
  adaptMcpWebSearchBackend,
  registerWebSearchBackend,
} from '../src/tools/webSearch';

const client = {
  async searchWeb(query: string) {
    const payload = await mcpBridge.callSearch(query);
    return payload.results;
  },
};

registerWebSearchBackend('company-mcp', () =>
  adaptMcpWebSearchBackend('company-mcp', client),
);
```

Then configure:

```json
{
  "webSearch": {
    "backend": "company-mcp",
    "provider": "default"
  }
}
```

Registration is currently an application-composition responsibility. Configuring an
ordinary MCP tool in `mcpServers` does not automatically register it as a
`WebSearchBackend`; the bridge must translate that server's tool result into the
three fields above and register the factory during startup.

## Trust and error boundaries

- Treat every returned field as untrusted. The public `web_search` tool normalizes it
  again and drops entries without a title or URL.
- Backends must return structured results, never Markdown or preformatted prompt text.
- The shared boundary limits the number of results and the length of every field.
- HTTP backends must use `safeFetch` so redirects and targets pass the SSRF policy.
- Only an HTTP 200 carries results; any other status is an error, never an empty list.
- Missing credentials may identify the missing environment-variable name, but errors
  and logs must never contain its value.
- MCP and future browser integrations must keep cookies, authorization tokens, CSRF
  values, and browser storage outside the adapter result.
- The adapter does not grant permissions or start an MCP process. Those responsibilities
  remain with the application composition root and MCP lifecycle owner.

## Future browser-session backend

A browser-backed implementation can satisfy the same `McpWebSearchClient` or
`WebSearchBackend` contract later. It should execute inside an explicitly authorized
browser session and return only `title`, `url`, and `snippet`. It must not extract
browser cookies for replay through the HTTP backend.

The executable contract is covered by `tests/test_web_search_backends.ts`.
