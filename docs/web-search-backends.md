# Web Search Backends and the MCP Adapter Contract

TSUKA exposes one LLM-facing tool, `web_search`. The tool delegates retrieval to a
`WebSearchBackend`, then owns normalization, result limits, formatting, and context
capping. Backends return data; they do not format prompt text.

## Backend contract

```ts
interface WebSearchBackend {
  readonly id: string;
  search(query: string): Promise<WebSearchResult[]>;
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
