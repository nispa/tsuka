# TSUKA

![Logo TSUKA](assets/logo.png)

**TypeScript Unified Kit for Agents** — un harness da terminale per eseguire agenti LLM con modelli locali o cloud.

[English](README.md) · [Documentazione](docs/README-it.md) · [Licenza MIT](LICENSE)

TSUKA collega un modello linguistico a strumenti, memoria e workflow multi-agente attraverso una CLI o un'interfaccia terminale a schermo intero. Utilizza endpoint chat compatibili con OpenAI, con backend locali come Ollama e gateway cloud come OpenRouter.

Il modello propone le azioni; l'harness gestisce l'esecuzione dei tool, i permessi, lo stato della conversazione e le condizioni di arresto. Il termine “deterministico” riguarda questa logica di controllo, non le risposte del modello o il risultato di un'attività.

Il progetto è anche un laboratorio per capire come funziona un agente: ciclo di esecuzione, registro dei tool, memoria e client dei provider sono moduli TypeScript separati, consultabili ed estendibili. Il nome *tsuka* (柄) indica l'impugnatura della spada giapponese: il modello è la lama intercambiabile.

## Primi passi

Servono Git, Node.js e npm, oltre all'accesso a un backend LLM. Il pacchetto richiede Node.js 18 o successivo; il progetto consiglia la versione 20 o successiva. TSUKA funziona su Windows, Linux e macOS.

### 1. Installa dal sorgente

```sh
git clone https://github.com/nispa/tsuka.git
cd tsuka
npm install
npm run build
npm link
```

`npm link` rende disponibile il comando `tsuka` anche fuori dal repository.

### 2. Collega un modello

Per un ambiente locale, avvia il backend e carica un modello con supporto alle chiamate di tool. La configurazione Ollama inclusa usa `http://localhost:11434/v1` e `qwen2.5-coder:7b`.

Se usi Ollama e il servizio non è già attivo, avvia `ollama serve`. In un altro terminale, scarica il modello configurato:

```sh
ollama pull qwen2.5-coder:7b
```

Per OpenRouter, aggiungi la chiave a un file `.env` nella cartella da cui avvierai TSUKA:

```dotenv
OPENROUTER_API_KEY=your_key_here
```

Avvia TSUKA, poi usa `/provider` per scegliere il backend e `/models` per selezionare il modello.

### 3. Apri un workspace

Avvia TSUKA dalla cartella su cui vuoi far lavorare gli agenti:

```sh
cd path/to/your/project
tsuka --tui
```

Usa `tsuka --cli` per la REPL a righe di comando. Il comando `tsuka` senza opzioni usa il valore configurato in `defaultUi`.

Comincia con una richiesta circoscritta, per esempio «Leggi questo progetto e spiegami i suoi punti di ingresso». Usa `/tools` per vedere gli strumenti disponibili e `/help` per i comandi supportati dall'interfaccia corrente.

## Lavorare con gli agenti

Un personaggio combina uno o più **ruoli**, che definiscono istruzioni e strumenti disponibili, con un **tratto**, che ne definisce lo stile comunicativo. Seleziona un personaggio con `/agent` e descrivi il compito in linguaggio naturale. Gli agenti ricevono l'istruzione di rispondere nella lingua che usi.

Per coinvolgere più agenti:

| Comando | A cosa serve |
|---|---|
| `/team` | Scegliere un team predefinito ed eseguire un'attività collaborativa. |
| `/goal <objective>` | Affidare all'orchestratore la pianificazione e il coordinamento di un'attività. |
| `/call` | Riunire più agenti in una discussione strutturata. |

I team supportano le modalità round-robin, pipeline, orchestrated e hybrid. Ogni esecuzione di un workflow dispone di una lavagna temporanea condivisa; la memoria persistente conserva informazioni tra sessioni. L'esecuzione parallela degli obiettivi è opzionale e usa workspace di staging, con rilevamento dei conflitti quando le modifiche vengono unite.

La [guida ai workflow multi-agente](docs/multi-agent-it.md) descrive sintassi e modalità di esecuzione; i [casi d'uso](docs/use-cases-it.md) propongono esempi di attività.

## Configurazione e personalizzazione

La cartella di installazione è la **directory applicativa** predefinita, modificabile tramite `TSUKA_HOME`. La directory di lavoro è il **workspace** predefinito dei tool sui file, salvo un'impostazione esplicita di `workspaceRoot`.

| File o directory | Funzione |
|---|---|
| `.tsuka/config.json` nel workspace, oppure `tsuka.config.json` nella directory applicativa come fallback | Provider attivo, modelli, interfaccia, limiti di esecuzione e funzionalità opzionali. |
| `providers.json` | Endpoint dei provider, modelli predefiniti e nomi delle variabili d'ambiente per le chiavi API. |
| `.env` | Credenziali, caricate dalla directory applicativa, poi da `.tsuka/.env` e infine da `.env` nel workspace; i file successivi hanno precedenza. |
| `characters/`, `roles/`, `traits/`, `teams/` | Definizioni degli agenti e composizione dei team. |

La [configurazione di esempio](tsuka.config.json.example) illustra le impostazioni disponibili. Usa `/provider` e `/models` per cambiare backend in modo interattivo e `/benchmark` per valutare le capacità di tool calling di un modello.

Per creare definizioni degli agenti locali al progetto, esegui uno di questi comandi nel workspace:

```sh
tsuka init --preset core
tsuka init --preset full
tsuka init --preset core --pack osint,devops
```

Sono inizializzazioni alternative. Il solo comando `tsuka init` apre la procedura guidata. Le risorse e la configurazione locali in `.tsuka/` hanno precedenza quando presenti; altrimenti il runtime usa `tsuka.config.json` nella directory applicativa come fallback.

## Strumenti ed estensioni

I tool inclusi coprono operazioni sui file, comandi shell, ricerca e navigazione web, memoria persistente, analisi statica del codice e coordinamento degli agenti. L'insieme attivo dipende dai ruoli selezionati, dal livello di capacità del modello e dalla configurazione.

TSUKA rileva le implementazioni dei tool nativi attraverso il proprio registro e supporta **server MCP via stdio**. Memoria e provider LLM espongono contratti che permettono di sostituirne le implementazioni senza cambiare il ciclo dell'agente.

- [Integrazione MCP](docs/mcp-it.md): collegare server esterni ed esporne i tool.
- [Backend di ricerca web](docs/web-search-backends-it.md): configurare i provider di ricerca.
- [Creazione di tool da parte degli agenti](docs/self-authoring-it.md): abilitare la generazione di strumenti eseguibili. La funzione è disattivata per impostazione predefinita e richiede l'approvazione prevista per le operazioni pericolose.

## Permessi e limiti

I tool nativi sui file applicano il confinamento al workspace. L'esecuzione usa i livelli di rischio `SAFE`, `RESTRICTED` e `DANGEROUS`; le richieste di approvazione dipendono dall'operazione e dai permessi della sessione.

Comandi shell, server MCP esterni e tool eseguibili personalizzati possono agire con i permessi del processo che li ospita. I controlli sui percorsi dei file non rendono questi processi una sandbox del sistema operativo. Anche le verifiche con `node:vm` sui tool generati non costituiscono un confine di sicurezza.

La [guida a sicurezza e permessi](docs/security-it.md) descrive le policy e i loro limiti.

## Sviluppo

```sh
npm run dev -- --cli
npm run tui
```

Prima di proporre una modifica, esegui tutti e tre i controlli:

```sh
npm test
npm run build
npm run typecheck
```

Il test runner isola memoria e log dei workflow in directory temporanee. I test usano backend simulati e non richiedono un modello attivo.

| Directory | Responsabilità |
|---|---|
| `src/core/` | Ciclo dell'agente, provider, memoria, configurazione e stato dei workflow. |
| `src/tools/` | Registro e implementazioni dei tool. |
| `src/safety/` | Permessi e policy di esecuzione. |
| `src/cli/` | REPL, comandi e output del terminale. |
| `src/tui/` | Interfaccia a schermo intero e gestione delle interazioni. |
| `tests/` | Test di regressione. |

Consulta [AGENTS.md](AGENTS.md) per le regole di contribuzione e la [guida all'architettura](docs/architecture-it.md) per i contratti dei sottosistemi.

## Approfondimenti

L'[indice della documentazione](docs/README-it.md) raccoglie le guide operative e didattiche. Puoi partire dalla [costruzione di un harness](docs/guida-didattica.md) per un percorso guidato, dalla [memoria](docs/memory-it.md) per stato e conservazione delle informazioni, oppure dai [benchmark](docs/benchmark-it.md) per la valutazione dei modelli.

TSUKA è distribuito con [licenza MIT](LICENSE).
