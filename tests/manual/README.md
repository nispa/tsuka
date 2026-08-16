# Test Manuali & Integrazione Live

Questa cartella contiene script di test pensati per l'esecuzione manuale con server LLM locali (es. Ollama) o connessione di rete attiva. Non vengono eseguiti nella suite automatica `npm test` per garantire l'isolamento offline e la riproducibilità su qualsiasi ambiente di CI/CD.

## Elenco Test

- `test_ollama.ts`: Verifica la connessione, lista modelli e chat su Ollama (`localhost:11434`).
- `test_sysadmin_live.ts`: Test live end-to-end con un agente sysadmin che naviga un sito web.
- `test_search.ts`: Test live del tool di ricerca DuckDuckGo su rete reale.
- `test_search_debug.ts`: Script di debug per l'HTML parsing di DuckDuckGo.
- `test_browser.ts`: Test live del tool `browse_url` su una pagina web esterna.
