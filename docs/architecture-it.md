# Architettura di Sistema — TSUKA 🏛️

<div align="right">
  <p>Read in <a href="architecture.md">🇬🇧 English</a></p>
</div>

> Questo documento descrive l'architettura tecnica, i principi di progettazione e l'organizzazione modulare del framework **TSUKA** (v0.5.1). Per le linee guida operative di contribuzione al codice si rimanda ad [`AGENTS.md`](../AGENTS.md); per l'elenco dei task completati e pianificati, consultare [`TASKS.md`](../TASKS.md).
>
> 📊 **Metriche di sistema**: 30 tool · 20 comandi REPL · 24 moduli core · 21 ruoli · 9 tratti · 24 personaggi (agenti) · 10 team configurati · 73 suite di test automatici · Doppia interfaccia CLI & TUI.

---

## 1. Modello Concettuale e Ciclo ReAct

TSUKA si basa sul paradigma **ReAct** (*Reason + Act*), arricchito da un'infrastruttura deterministica che governa rigorosamente il contesto, i tool e i limiti computazionali a disposizione del modello linguistico.

```
                      ┌────────────────────────────┐
                      │  Input Utente / Obiettivo  │
                      └─────────────┬──────────────┘
                                    │
                                    ▼
                      ┌────────────────────────────┐
                      │    Assemblaggio Prompt     │
                      │  (Identità + Memoria +     │
                      │   Tool ammessi per Tier)   │
                      └─────────────┬──────────────┘
                                    │
            ┌───────────────────────▼────────────────────────┐
            │       Invocazione LLM (HTTP Streaming)         │◄─────────────┐
            └───────────────────────┬────────────────────────┘              │
                                    │                                       │
                         [ Risposta del Modello ]                           │
                                    │                                       │
                      Contiene      │                                       │
                      tool calls?   ├────────── No ──────────┐              │
                                    │                        │              │
                                   Sì                        ▼              │
                                    │                  ┌───────────┐        │
                                    ▼                  │ Risposta  │        │
                         ┌──────────────────────┐      │  Finale   │        │
                         │ Validazione Argomenti│      └─────┬─────┘        │
                         │   e Check Permessi   │            │              │
                         └──────────┬───────────┘            │              │
                                    │                        │              │
                                    ▼                        │              │
                         ┌──────────────────────┐            │              │
                         │  Esecuzione Tool &   │            │              │
                         │ Troncamento Contesto │            │              │
                         └──────────┬───────────┘            │              │
                                    │                        │              │
                                    ▼                        │              │
                         ┌──────────────────────┐            │              │
                         │ Iniezione Risultati  │            │              │
                         │  nella Cronologia    │────────────┘              │
                         └──────────┬───────────┘                           │
                                    └───────────────────────────────────────┘
```

### Principio di controllo deterministico
Nei modelli linguistici locali (in particolare sotto i 30 miliardi di parametri), l'affidabilità aumenta quanto più la logica di controllo è delegata al codice dell'harness anziché all'autonomia del modello:
* **Il modello decide il contenuto**: sintetizza le risposte, interpreta i compiti e formula le invocazioni dei tool.
* **L'harness governa il flusso**: seleziona dinamicamente i tool visibili in base al tier, tronca gli output eccessivi, applica i controlli di sicurezza e interrompe i cicli infiniti tramite un tetto massimo invalicabile (`Agent.DEFAULT_MAX_TOOL_ROUNDS = 15`).

---

## 2. Architettura a Strati e Disaccoppiamento

La codebase è organizzata in quattro layer indipendenti con chiare responsabilità architetturali:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      1. CLI & INTERFACCIA (src/cli/)                    │
│      REPL · Slash Commands · Rendering ANSI Live · Menu Interattivi     │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Richieste utente / Eventi
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       2. MOTORE CORE (src/core/)                        │
│   Ciclo ReAct (Agent) · Provider LLM · Memoria Persistente · Contesto   │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │ Invocazione tool                │ Verifica permessi
                    ▼                                 ▼
┌─────────────────────────────────────┐   ┌───────────────────────────────┐
│      3. TOOL REGISTRY (src/tools/)  │   │  4. SICUREZZA (src/safety/)   │
│ Auto-discovery · JSON Schema · Impl │   │ Permission Manager · Sandbox  │
└─────────────────────────────────────┘   └───────────────────────────────┘
```

| Strato | Directory | Responsabilità architetturale |
|---|---|---|
| **Core** | `src/core/` | Gestisce il ciclo agentico (`Agent`), i provider LLM (`LLMProvider`), la memoria persistente (`MemoryStore`), il budget di contesto e la blackboard. È completamente disaccoppiato da Node TTY e dal terminale. |
| **Tools** | `src/tools/` | Contiene il registro dinamico (`ToolRegistry`), gli schemi di validazione JSON e le 27 implementazioni native. Non ha dipendenze dall'interfaccia utente. |
| **Safety** | `src/safety/` | Definisce i livelli di rischio (`SAFE`, `RESTRICTED`, `DANGEROUS`), gestisce la coda asincrona di autorizzazione e applica la jail sul filesystem. |
| **CLI** | `src/cli/` | Implementa il loop REPL, il dispatch dei comandi slash, la barra di stato animata e il renderer ANSI/Markdown. Rappresenta *uno* dei possibili client dell'infrastruttura core. |

### Disaccoppiamento dell'I/O: `AgentEvents` e `logSink`
Il livello core non invoca mai direttamente `console.log` o stream TTY:
* Le esecuzioni dell'agente notificano gli avanzamenti all'interfaccia tramite contratti di evento (`onChunk`, `onStats`, `onEvent`, `AbortSignal` in `agentEvents.ts`).
* I moduli infrastrutturali di servizio (`MemoryStore`, `ConfigManager`, `ToolRegistry`) utilizzano un sink iniettabile e intercettabile ([`src/core/logSink.ts`](../src/core/logSink.ts)), consentendo una futura integrazione con interfacce web o server headless senza dover rifattorizzare il motore logico.

---

## 3. Il Ciclo di Vita di una Richiesta

Ogni iterazione dell'utente all'interno del REPL o di un workflow attraversa sei fasi deterministiche:

1. **Assemblaggio dinamico del prompt (`loadSystemPrompt`)**: Concatena l'identità del personaggio, il system prompt del ruolo, le direttive stilistiche del tratto, i fatti estratti dalla memoria per rilevanza semantica e l'elenco testuale dei tool abilitati (omesso se il modello dispone di function calling nativo certificato).
2. **Filtraggio adattivo dei tool (`registry.listForLLM`)**: Applica un doppio filtro su ciascun tool: deve appartenere alla lista `allowedTools` del ruolo attivo e rispettare il `requiredTier` associato al modello corrente per il livello di reasoning effort selezionato.
3. **Potatura della cronologia (`pruneHistory`)**: Verifica che i token totali della cronologia rientrino nel budget (`maxHistoryTokens`). In caso di eccedenza, elimina progressivamente i messaggi più remoti preservando rigorosamente la coerenza tra coppie `tool_call` e risposte `tool`.
4. **Invocazione LLM in streaming (`provider.chatWithTools`)**: Trasmette il payload al backend OpenAI-compatible, separando in tempo reale il flusso di reasoning (`<think>`) dal contenuto effettivo (`content`).
5. **Validazione ed esecuzione dei tool**: Se il modello emette chiamate a tool, i parametri vengono verificati contro il relativo JSON Schema. Il `PermissionManager` autorizza o sospende l'azione richiedendo conferma all'utente. Il risultato ottenuto viene troncato a dimensione di sicurezza (`capForContext`).
6. **Re-iniezione e prosecuzione**: I risultati dei tool vengono aggiunti alla cronologia con ruolo `tool`, riavviando il ciclo fino all'emissione di una risposta testuale finale o all'esaurimento dei round massimi.

---

## 4. Sistema Dichiarativo: Ruoli, Tratti, Personaggi e Team

L'identità e il comportamento di tutti gli agenti sono definiti esclusivamente tramite file JSON dichiarativi esterni al codice sorgente:

```
┌─────────────────────────┐     ┌────────────────────────┐
│     RUOLO (roles/)      │  ×  │    TRATTO (traits/)    │  ──►  PERSONAGGIO / AGENTE
│ (Cosa fa + tool ammessi)│     │(Come parla + carattere)│      (es. @geordi, @worf, @pike)
└─────────────────────────┘     └────────────────────────┘
```

| Componente | Directory | Contenuto e Funzione |
|---|---|---|
| **Ruolo** | `roles/*.json` | Definisce le competenze operative: istruzioni di sistema (`systemPrompt`), elenco dei tool autorizzati (`allowedTools`) e livello di `reasoningEffort` predefinito. |
| **Tratto** | `traits/*.json` | Stabilisce il registro espressivo, la propensione alla sintesi o al dettaglio, e la postura critica (es. `professional`, `creative`, `grumpy`, `uncompromising`). |
| **Personaggio (Agente)** | `characters/*.json` | Istanzia un agente operativo collegando un nome proprio (`aiName`), una descrizione funzionale, uno o più ruoli (`roles: [...]`, con `activeRole`) e un tratto comunicativo. |
| **Team** | `teams/*.json` | Configura una squadra collaborativa fissa, definendone i membri, la strategia di coordinamento (`mode`), l'eventuale orchestratore e i criteri di accettazione (`acceptance`). |

### Il ruolo della `description` del Personaggio
All'interno dell'orchestratore di obiettivi ([`/goal`](multi-agent-it.md)), l'LLM di pianificazione seleziona gli agenti basandosi primariamente sul campo `description` presente nei file personaggio in `characters/`. Una descrizione accurata e orientata ai risultati permette all'orchestratore di assegnare i task in base al *mestiere* e alle reali capacità operative.

---

## 5. Il Sistema dei Tool e il Tier Pruning

Il catalogo comprende **30 tool integrati**, sviluppati secondo il principio della separazione tra contratto ed esecuzione:
* **Schema dichiarativo (`tools_schemas/<nome>.json`)**: definisce nome, descrizione per il modello, parametri in formato JSON Schema, livello di rischio (`riskLevel`) e tier minimo richiesto (`requiredTier`).
* **Implementazione operativa (`src/tools/impl/<nome>.ts`)**: esporta la logica esecutiva conforme all'interfaccia TypeScript `Tool`.

```
                  ┌──────────────────────────────┐
                  │       27 Tool nel Core       │
                  └──────────────┬───────────────┘
                                 │
           Filtro 1: Ruolo       ▼
        ┌─────────────────────────────────────────────────┐
        │  allowedTools del Ruolo attivo (roles/*.json)   │
        └────────────────────────┬────────────────────────┘
                                 │
           Filtro 2: Tier        ▼
        ┌─────────────────────────────────────────────────┐
        │  Tier del Modello (SMALL / MEDIUM / LARGE)      │
        │  da Capability Fingerprinting o Euristica Nome  │
        └────────────────────────┬────────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ Tool effettivamente offerti  │
                  │        all'LLM nel turno     │
                  └──────────────────────────────┘
```

### Classificazione dei Tool per Categoria
1. **Manipolazione Filesystem**: `read_file`, `write_file` (con supporto append e limite di 16.000 caratteri per chiamata per prevenire troncamenti JSON), `edit_file`, `delete_file`, `list_dir`, `grep_search`.
2. **Controllo di Sistema**: `execute_command` (esecuzione shell con timeout configurabile), `get_ps_info` (diagnostica processi e risorse).
3. **Ricerca Web e Rete**: `web_search`, `browse_url` (con modalità Reader View e rimozione di elementi superflui), `download_file`.
4. **Persistenza e Memoria**: `save_memory`, `recall_memory`.
5. **Coordinamento Multi-Agente**: `report_status`, `route_next`, `cast_vote`, `post_note`, `read_notes`, `send_message`.
6. **Estendibilità ed Escalation**: `spawn_agent`, `switch_skill`, `create_role`, `create_tool`, `request_goal`, `request_team`, `request_call`.
7. **Sicurezza e Analisi Statica**: `audit_code` (scansione vulnerabilità OWASP, pattern insicuri e leak di segreti).

---

## 6. Architettura della Memoria e Gestione dello Stato

TSUKA implementa una netta separazione tra i tre livelli di stato dell'applicazione:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. CRONOLOGIA DI TURNO (RAM)                                                │
│    Ambito: singolo agente nel turno corrente                                │
│    Contenuto: scambi puntuali di messaggi e output grezzi dei tool          │
│    Persistenza: volatile (prunata a fine turno o per superamento budget)    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. BLACKBOARD DI RUN (AsyncLocalStorage / blackboard.ts)                     │
│    Ambito: condivisa tra tutti i membri di uno specifico workflow /team o /goal │
│    Contenuto: decisioni intermedie, note e artefatti di sessione (post_note)│
│    Persistenza: vive solo per la durata del run; snapshot esportato nei log │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. MEMORIA PERSISTENTE A LUNGO TERMINE (memory/memory.json)                 │
│    Ambito: cross-sessione e condivisa tra tutti gli agenti                  │
│    Contenuto: convenzioni, decisioni architetturali, lezioni apprese        │
│    Persistenza: permanente su disco, con eviction pesata a punteggio        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Caratteristiche avanzate della Memoria Persistente:
* **Scoping flessibile**: ogni fatto appartiene a un workspace specifico o allo scope `globale`, consentendo la coesistenza di progetti multipli senza interferenze.
* **Tipizzazione dei record**: ogni voce possiede una tipologia (`fatto`, `decisione`, `lezione`, `run`). In fase di saturazione del database (`memoryMaxFacts`, default 200), l'algoritmo di eviction elimina prioritariamente i log di esecuzione temporanei (`run`), preservando le lezioni e proteggendo in modo assoluto i record contrassegnati come `pinned`.
* **Recupero semantico per rilevanza**: l'estrazione automatica nel prompt (`formatRelevant`) impiega una ricerca con scoring ponderato (OR logico sulle keyword e normalizzazione morfologica dei lemmi).

---

## 7. Governo del Contesto e Prevenzione della Saturazione

Per garantire l'efficacia operativa anche su modelli con context window contenute (8k–32k token), TSUKA applica tre livelli progressivi di difesa:

1. **Limitazione preventiva dell'output dei tool (`capForContext`)**: Qualsiasi output generato da un tool che eccede `maxToolResultTokens` (default 4.000 token) viene troncato restituendo le porzioni iniziale e finale, unite da un messaggio che indica come paginare il contenuto residuo (es. tramite i parametri `offset` e `limit` di `read_file`).
2. **Potatura token-driven della cronologia (`pruneHistory`)**: La riduzione della cronologia si orienta primariamente sul consumo reale di token (`maxHistoryTokens`), calcolato tramite stima calibrata a runtime sui metadati `usage.prompt_tokens`. Il conteggio dei messaggi (`maxHistoryMessages = 500`) agisce solo come soglia di sicurezza secondaria.
3. **Rilevamento dinamico della finestra del server**: All'avvio, l'harness interroga il server locale attivo (llama-server `/props`, Ollama `/api/show`, OpenRouter `context_length`) per impostare automaticamente il budget massimo di token in base all'effettiva capacità del modello allocato.

---

## 8. Governo dei Tempi e del Reasoning Effort

Nei modelli di reasoning (es. DeepSeek R1, Qwen QwQ), il tempo di elaborazione del pensiero può superare ampiamente quello di generazione del testo. Il parametro `reasoning_effort` (`none`, `low`, `medium`, `xhigh`) viene determinato attraverso una gerarchia di risoluzione a cinque livelli:

```
┌────────────────────────────────────────────────────────┐
│ 1. Pin Globale da Terminale (/effort)                  │
└───────────────────────────┬────────────────────────────┘
                            ▼ (se assente)
┌────────────────────────────────────────────────────────┐
│ 2. Override Esplicito del Chiamante                   │
└───────────────────────────┬────────────────────────────┘
                            ▼ (se assente)
┌────────────────────────────────────────────────────────┐
│ 3. Configurazione del Personaggio (characters/*.json)  │
└───────────────────────────┬────────────────────────────┘
                            ▼ (se assente)
┌────────────────────────────────────────────────────────┐
│ 4. Configurazione del Ruolo Attivo (roles/*.json)      │
└───────────────────────────┬────────────────────────────┘
                            ▼ (se assente)
┌────────────────────────────────────────────────────────┐
│ 5. Default Globale (tsuka.config.json)                 │
└────────────────────────────────────────────────────────┘
```

* **Accoppiamento Tier-Effort**: La profilazione dei modelli (`/benchmark`) valuta le prestazioni su ciascuno dei quattro livelli di effort. Cambiare effort a runtime tramite `/effort` può modificare il tier assegnato al modello, abilitando o disabilitando coerentemente i tool associati.
* **Doppio controllo di timeout**: Il provider applica `FIRST_TOKEN_TIMEOUT_MS` (attesa massima per l'avvio della risposta) e `MAX_GENERATION_MS` (`llmTimeoutMs`, tempo massimo complessivo per l'intero output).

---

## 9. Le Cinque Modalità di Esecuzione

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MODALITÀ DI ESECUZIONE                           │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│ 1. Chat Singola │ 2. Dibattito    │ 3. Team         │ 4. Goal Orchestrator  │
│    (/agent)     │    (/call)      │    (/team)      │    (/goal)            │
│                 │                 │                 │                       │
│ Singolo agente  │ Discussione     │ Squadra fissa   │ Pianificazione        │
│ interattivo con │ collegiale a    │ collaborativa   │ dinamica su tutti     │
│ accesso ai tool │ turni (no tool) │ con 4 strategie │ i personaggi e step   │
│ del suo ruolo   │                 │ di workflow     │ paralleli             │
├─────────────────┴─────────────────┴─────────────────┴───────────────────────┤
│ 5. Sub-Agente Autonomo (spawn_agent): delega isolata su task secondari      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Le quattro strategie collaborative di `/team`:
* **`orchestrated` (consigliata)**: un agente supervisore valuta i progressi turno per turno e assegna dinamicamente l'intervento al membro più idoneo tramite il tool `route_next`.
* **`round-robin`**: rotazione ciclica sequenziale tra tutti i membri del team fino alla risoluzione del task.
* **`pipeline`**: catena di montaggio a passaggio singolo in cui ogni stazione perfeziona l'output della precedente, con supporto per il loop di verifica oggettiva ([`src/core/loop.ts`](../src/core/loop.ts)).
* **`hybrid`**: inserisce round periodici di discussione e votazione formale (`cast_vote`) tra i cicli di lavoro operativo.

### Concorrenza nei blocchi `PARALLELO` di `/goal`:
Quando l'orchestratore emette sotto-compiti concorrenti, l'esecuzione avviene tramite `Promise.all`. L'isolamento è garantito da:
* **Staging Filesystem Indipendente (`parallelWorkspace.ts`)**: ogni branch scrive su una directory temporanea isolata via `AsyncLocalStorage` (`withWorkspaceOverride`). La fusione finale applica un merge conservativo che evidenzia eventuali conflitti senza sovrascritture distruttive.
* **Coda Atomica dei Permessi**: le richieste di autorizzazione interattiva vengono accodate, garantendo che i prompt utente non si sovrappongano mai a video.

---

## 10. Connettività Provider e Auto-Discovery

TSUKA adotta un client unificato basato sull'SDK ufficiale **OpenAI**, interfacciando qualsiasi server locale o remoto conforme allo standard `/v1/chat/completions`:

```
┌────────────────────────────────────────────────────────┐
│              Client Unificato (LLMProvider)            │
└───────────────────────────┬────────────────────────────┘
                            │ /v1/chat/completions
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Ollama    │     │ llama.cpp /  │     │  OpenRouter  │
│ (:11434/v1)  │     │ Unsloth (:v1)│     │   (Cloud)    │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Auto-discovery dei server all'avvio (`discovery.ts`)
1. Scansiona con timeout rapido (2.5s) il provider attivo configurato.
2. In caso di mancata risposta, esegue il probe parallelo degli altri server locali configurati.
3. **Priorità di allocazione**: aggancia prioritariamente il modello già caricato nella memoria RAM/VRAM del server (rilevato tramite `/api/ps` per Ollama, o flag `loaded` per Unsloth/LM Studio), evitando ricaricamenti costosi di file GGUF.

---

## 11. Mappa dei Moduli Core

| Modulo | File sorgente | Ruolo architetturale |
|---|---|---|
| **Agent** | `src/core/agent.ts` | Ciclo ReAct, pruning token-driven, compressione e gestione degli eventi. |
| **Provider** | `src/core/provider.ts` | Client HTTP OpenAI, gestione dello streaming, parsing token e timeout. |
| **Memory Store** | `src/core/memory.ts` | Database JSON persistente, scoring per rilevanza semantica e politiche di eviction. |
| **Blackboard** | `src/core/blackboard.ts` | Lavagna di sessione isolata per workflow tramite `AsyncLocalStorage`. |
| **Context Budget** | `src/core/contextBudget.ts` | Algoritmi di stima dei token, calibrazione a runtime e troncamento `capForContext`. |
| **Model Profile** | `src/core/modelProfile.ts` | Gestione dei profili di capability fingerprinting e classificazione dei tier. |
| **Discovery** | `src/core/discovery.ts` | Rilevamento automatico server locali, stato VRAM e context window effettiva. |
| **Parallel Workspace** | `src/core/parallelWorkspace.ts` | Staging isolato del filesystem per task concorrenti e algoritmo di merge con rilevamento conflitti. |
| **Loop Controller** | `src/core/loop.ts` | Ciclo di esecuzione iterativa guidato da criteri di accettazione oggettivi (`acceptance`). |
| **Log Sink** | `src/core/logSink.ts` | Astrazione di logging iniettabile per disaccoppiare il core dal terminale TTY. |
| **App Home** | `src/core/apphome.ts` | Risoluzione gerarchica dei percorsi tra cartella globale e directory di lavoro locale. |
| **Platform** | `src/core/platform.ts` | Astrazione cross-platform per l'esecuzione comandi (PowerShell su Windows, `/bin/sh` su Unix). |

---

## 12. Architettura della Dashboard Terminale (TUI) (`src/tui/`)

TSUKA include una dashboard terminale grafica interattiva a componenti puri:

```
                  ┌──────────────────────────────┐
                  │    TuiScreen (Double-Buffer) │
                  └──────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │       TuiStore (Flux/Stato)   │
                 └───────┬───────────────▲───────┘
                         │               │
      ┌──────────────────┴──┐         ┌──┴──────────────────┐
      │  Viste Pure (Views) │         │  Adapter TuiBridge  │
      │  (Header, Sidebar,  │         │  (Si aggancia agli  │
      │   Files, Chat, etc.)│         │   eventi del Core)  │
      └─────────────────────┘         └─────────────────────┘
```

* **`TuiScreen` (`screen.ts`)**: Motore a basso livello con rendering differenziale a riga singola (0ms di latenza visiva, zero flickering) e slicing ANSI sicuro con `slice-ansi` e `string-width`.
* **`TuiStore` (`store.ts`)**: Gestione reattiva dello stato unificato (messaggi, token, file explorer, reasoning streaming, modali).
* **`TuiBridge` (`bridge.ts`)**: Adapter che converte gli eventi del core (`AgentEvents`, `PermissionManager`) in mutazioni dello stato TUI.
* **Componenti Grafici Puri (`src/tui/views/`)**:
  * `HeaderView`: Schede di navigazione e barra grafica di consumo del context window.
  * `SidebarView`: Profilo agente attivo, ruolo, tratto e statistiche token.
  * `FilesView`: File explorer del workspace con icone per estensione, scrollbar e click per incollare il file nel prompt.
  * `ChatView`: Rendering Markdown formattato, blocchi di codice evidenziati e box di reasoning `<think>`.
  * `ToolsView`: Catalogo e cronologia dei 30 tool nativi.
  * `InputView`: Buffer di input multi-riga con cursore e spinner di caricamento.
  * `ModalView`: Finestre modali di conferma sicurezza, selezione modelli, estensione timeout e cheatsheet comandi (`F12`). Ogni tipo di modale fornisce solo il proprio box (`BOX_BUILDERS`); centratura e composizione sullo schermo sono condivise.
* **Tabelle di Dispatch Data-Driven**: il comportamento sta in liste, non in catene di condizioni; estendere la TUI significa aggiungere una riga.
  * `src/tui/commands/`: tabella dei comandi slash (`registry.ts`) — nome, alias, descrizione e handler per ciascun comando, raggruppati in `sessionCommands` / `workflowCommands` / `configCommands`. `TuiCommandController` si limita a fare il parsing della riga e la lookup; `assertMenuCoverage()` impedisce che tabella e menu slash (`commands/menu.json`) divergano.
  * `src/tui/navigation.ts`: tabella delle schede — tasto funzione, etichette per larghezza e modale associata. Riga dell'header, zone di click del mouse e cheatsheet dell'help derivano tutte da qui: una scheda rinominata non può perdere la propria area cliccabile.
  * `src/tui/layoutConfig.ts`: preset di layout, temi e ordine dei widget (`tui.layout.json`).
  * `src/tui/keybindings.json`: sequenze di escape grezze mappate sui nomi dei tasti.

---

## 13. Sicurezza e Modello dei Permessi

* **Tre livelli di rischio**: `SAFE` (esecuzione immediata), `RESTRICTED` (richiede conferma con facoltà di autorizzazione per l'intera sessione), `DANGEROUS` (richiede sempre autorizzazione puntuale esplicita).
* **Workspace Jail**: tutte le operazioni su filesystem sono confinate all'interno del percorso `workspaceRoot`.
* **Protezione Credenziali**: censura preventiva automatica delle variabili d'ambiente riservate (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `AUTH`).
* **Sandbox Dinamica**: il codice generato a runtime dal tool `create_tool` viene validato in un contesto `node:vm` isolato dotato di blocklist sui moduli di sistema.

---

## 14. Roadmap Architetturale e Visione Futura

1. **Disaccoppiamento completato**: il motore agentico comunica esclusivamente tramite stream di eventi (`AgentEvents`) e sink sostituibili (`logSink`).
2. **Doppia Interfaccia Operativa**: supporto trasparente sia per CLI REPL tradizionale che per la Dashboard TUI a schermo intero.
3. **WebUI / Dashboard Locale**: l'architettura a componenti e lo stato reattivo consentono l'estensione verso una web interface locale basata su WebSocket.

---

*Per una panoramica pratica sulle modalità d'uso e sui casi concreti, consultare la [Guida Didattica](guida-didattica.md) e la documentazione sui [Workflow Multi-Agente](multi-agent-it.md).*
