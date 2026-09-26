# Backend di ricerca web e contratto adapter MCP

TSUKA espone al modello un solo tool, `web_search`. Il tool delega il recupero a un
`WebSearchBackend` e mantiene la responsabilità di normalizzazione, limiti, formato e
budget di contesto. I backend restituiscono dati strutturati, non testo già formattato
per il prompt.

## Scegliere il provider di ricerca

Il provider attivo si sceglie con `/search-engine <nome>` (oppure `webSearch.provider` in
`tsuka.config.json`). Il catalogo di serie, `web_search_providers.json`, ne contiene due:

| Provider | Chiave | Note |
|---|---|---|
| `duckduckgo` | nessuna | Legge la pagina HTML dei risultati di DuckDuckGo. DuckDuckGo può rispondere alle richieste automatiche con una pagina anti-bot (HTTP 202); in quel caso `web_search` fallisce con un errore esplicito invece di riportare "nessun risultato". Riprova più tardi o cambia provider. |
| `tavily` | `TAVILY_API_KEY` | API di ricerca JSON pensata per gli agenti. Il piano gratuito dà 1.000 crediti al mese (una ricerca base costa un credito) e non chiede la carta di credito; senza carta non può esserci alcun addebito, le ricerche falliscono semplicemente fino al mese successivo. |

Per usare Tavily: crea un account su tavily.com, metti la chiave in `.env` come
`TAVILY_API_KEY=tvly-...`, poi esegui `/search-engine tavily`. La chiave non arriva mai ai
comandi di shell né ai server MCP, e un risultato di tool che dovesse contenerla viene
oscurato (vedi la politica sulle credenziali in [sicurezza](security-it.md)).

La Custom Search JSON API di Google è stata tolta dal catalogo: è chiusa ai nuovi clienti e
viene spenta il 1° gennaio 2027. È prevista un'opzione locale senza chiavi, un'istanza
SearXNG (T24.14): richiede una voce esplicita di allowlist di rete, perché altrimenti la
policy SSRF rifiuta gli indirizzi di loopback e le porte non standard.

## Vedere cosa ha risposto il server

Ogni chiamata a `web_search` registra lo scambio grezzo con il provider: la richiesta (con
le credenziali oscurate), lo status HTTP, il content type, la dimensione, quanti risultati
sono stati estratti e il corpo della risposta (fino a `webSearchTraceMaxChars`). Apri la
vista Tools (F2) per leggerlo sotto la chiamata, nella sezione `server:`. È mostrato solo a
te: il modello riceve i risultati formattati, mai la pagina grezza.

Solo un HTTP 200 porta risultati. Qualunque altro status è riportato come errore con il suo
codice, così un provider bloccato o limitato non può passare per una ricerca vuota.

## Contratto del backend

```ts
interface WebSearchBackend {
  readonly id: string;
  // onTrace riceve lo scambio grezzo (status, corpo, ...) per la vista Tools, quando il
  // backend ne ha uno; non arriva mai al modello.
  search(query: string, onTrace?: (trace: WebSearchTrace) => void): Promise<WebSearchResult[]>;
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
- Solo un HTTP 200 porta risultati; ogni altro status è un errore, mai una lista vuota.
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
