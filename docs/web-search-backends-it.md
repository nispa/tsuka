# Backend di ricerca web e contratto adapter MCP

TSUKA espone al modello un solo tool, `web_search`. Il tool delega il recupero a un
`WebSearchBackend` e mantiene la responsabilità di normalizzazione, limiti, formato e
budget di contesto. I backend restituiscono dati strutturati, non testo già formattato
per il prompt.

## Contratto del backend

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

La factory riceve il provider configurato e deve essere registrata prima della prima
esecuzione di `web_search`:

```ts
import { registerWebSearchBackend } from '../src/tools/webSearch';

registerWebSearchBackend('mio-backend', ({ provider }) => {
  return createMyBackend(provider);
});
```

Configurazione in `tsuka.config.json`:

```json
{
  "webSearch": {
    "backend": "mio-backend",
    "provider": "mio-provider"
  }
}
```

Il backend nativo `http` legge i provider da `web_search_providers.json`. Il catalogo
contiene endpoint e mapping, ma i campi sensibili possono soltanto riferirsi al nome
di una variabile d'ambiente. I valori reali restano in `.env` e vengono risolti solo
quando viene costruita la richiesta.

## Adapter del client MCP

`adaptMcpWebSearchBackend` adatta un client stretto posseduto dal livello di
integrazione:

```ts
interface McpWebSearchClient {
  searchWeb(query: string): Promise<ReadonlyArray<{
    title?: unknown;
    url?: unknown;
    snippet?: unknown;
  }>>;
}
```

Il client decide come invocare il server MCP. L'adapter non conosce JSON-RPC,
lifecycle dei processi, profili browser o credenziali.

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

Configurazione:

```json
{
  "webSearch": {
    "backend": "company-mcp",
    "provider": "default"
  }
}
```

Oggi la registrazione appartiene alla composition root dell'applicazione. Dichiarare
un normale tool in `mcpServers` non lo registra automaticamente come
`WebSearchBackend`: il bridge deve convertire il risultato del server nei tre campi
indicati e registrare la factory durante l'avvio.

## Confini di sicurezza ed errore

- Ogni campo restituito è non fidato: `web_search` lo normalizza nuovamente e scarta
  risultati senza titolo o URL.
- I backend restituiscono dati strutturati, mai Markdown o testo pronto per il prompt.
- Il boundary comune limita numero dei risultati e lunghezza di ogni campo.
- I backend HTTP devono usare `safeFetch`, incluse policy SSRF e redirect.
- Un errore può indicare il nome di una variabile mancante, mai il suo valore.
- MCP e future integrazioni browser tengono cookie, token, CSRF e browser storage fuori
  dal risultato dell'adapter.
- L'adapter non concede permessi e non avvia processi MCP: sono responsabilità della
  composition root e del proprietario del lifecycle MCP.

## Futuro backend `browser-session`

Un backend browser potrà implementare lo stesso `McpWebSearchClient` oppure direttamente
`WebSearchBackend`. Dovrà operare dentro una sessione autorizzata esplicitamente e
restituire soltanto `title`, `url` e `snippet`, senza estrarre cookie da riutilizzare
attraverso il backend HTTP.

Il contratto eseguibile è verificato da `tests/test_web_search_backends.ts`.
