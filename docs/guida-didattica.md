# Guida didattica — Come costruire un harness agentico 🎓

<div align="right">
  <p>Read in <a href="educational-guide.md">🇬🇧 English</a></p>
</div>

> Questa guida illustra i principi architetturali e i dettagli implementativi necessari per costruire un harness multi-agente moderno come **TSUKA**. Vengono analizzati sia i componenti **universali** (presenti in strumenti come Claude Code, OpenCode o Aider), sia le **scelte specifiche** di questo progetto, evidenziando le insidie pratiche riscontrate durante lo sviluppo.
>
> 💡 **Come consultare la guida**: Le tappe della sezione [§2](#2-il-percorso-di-costruzione-tappa-per-tappa) sono ordinate per complessità crescente: ogni modulo è autonomo e costituisce il prerequisito del successivo. Se stai sviluppando il tuo harness personale, ti consigliamo di seguirle in sequenza; se invece desideri approfondire l'architettura di TSUKA, puoi passare direttamente alla tappa di tuo interesse.

---

## 1. Cos'è un harness agentico

Un Large Language Model (LLM), preso singolarmente, è una funzione pura: riceve testo in ingresso e restituisce testo in uscita. Di per sé non possiede gli strumenti per leggere file su disco, eseguire comandi shell o mantenere uno stato persistente tra sessioni distinte.

Un **harness** (letteralmente *"imbracatura"* o *"telaio di controllo"*) è l'applicazione che incapsula il modello, dotandolo di strumenti di osservazione, esecuzione e memoria:

```
┌─────────────────────────── HARNESS ───────────────────────────┐
│                                                               │
│   REPL ──► Ciclo agentico ──► Provider LLM (HTTP streaming)   │
│    ▲             │                                            │
│    │             ▼                                            │
│   UI  ◄── Tool Registry ──► Permessi ──► Esecuzione (fs, sh)  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Il principio cardine alla base di qualsiasi harness è il seguente:

> **Il modello linguistico non esegue mai direttamente le azioni.**  
> Il modello *dichiara l'intenzione* di invocare uno o più strumenti (*tool calling*). È l'harness che convalida la richiesta, esegue l'operazione in un ambiente controllato, raccoglie l'output e lo reinietta nella cronologia come nuovo messaggio per il modello.

L'intelligenza generativa appartiene al modello, ma il controllo operativo e la sicurezza risiedono interamente nell'harness. Per questo motivo la gestione dei permessi (Tappa 4) vive nell'harness: solo a questo livello è possibile intercettare, autorizzare o bloccare in sicurezza qualsiasi operazione sul sistema operativo.

### Concetti fondamentali

| Termine | Definizione |
|---|---|
| **Tool** | Una funzione o utility di sistema che il modello può richiedere di eseguire (es. lettura file, ricerca web, comandi shell). |
| **Tool Call** | La richiesta strutturata (solitamente in formato JSON) emessa dal modello contenente il nome della funzione e i relativi argomenti. |
| **Cronologia (History)** | La sequenza ordinata di messaggi scambiati tra utente, assistente e tool, inviata all'LLM a ogni richiesta per preservare il contesto operativo. |
| **Finestra di contesto (Context Window)** | Il limite massimo di token che il modello può elaborare simultaneamente in una singola richiesta. Rappresenta la risorsa più critica dell'intero sistema. |
| **Personaggio / Agente** | In TSUKA **ogni Personaggio è a tutti gli effetti un Agente**: un'identità configurata in JSON che unisce competenze operative (*Ruolo*) e stile comunicativo (*Tratto*). |

---

## 2. Il percorso di costruzione, tappa per tappa

```
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │  1. REPL &   │ ──►  │ 2. Ciclo     │ ──►  │ 3. Tool      │
  │   Streaming  │      │   Agentico   │      │   Registry   │
  └──────────────┘      └──────────────┘      └──────────────┘
                                                     │
  ┌──────────────┐      ┌──────────────┐             │
  │ 6. UI TUI &  │ ◄──  │ 5. Gestione  │ ◄──  ┌──────▼───────┐
  │   ANSI Live  │      │   Contesto   │      │ 4. Sistema   │
  └──────────────┘      └──────────────┘      │   Permessi   │
         │                                    └──────────────┘
         ▼
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │ 7. Multi-    │ ──►  │ 8. Model     │ ──►  │ 9. Self-     │ ──► 10. Packaging &
  │   Agente     │      │   Tiers      │      │   Extension  │     Distribuzione
  └──────────────┘      └──────────────┘      └──────────────┘
```

---

### Tappa 1 — Chat REPL e streaming in tempo reale

*Riferimenti nel codice: `src/core/provider.ts`, `src/cli/index.ts`, `src/cli/input.ts`*

Il punto di partenza è un ciclo di lettura interattivo (REPL) che raccoglie l'input dell'utente e lo inoltra a un endpoint compatibile con lo standard **OpenAI** (`/v1/chat/completions`).

Adottare questa interfaccia standard è una decisione architetturale strategica: server locali come Ollama, llama-server (`llama.cpp`), Unsloth Studio, vLLM e aggregatori cloud come OpenRouter espongono tutti lo stesso protocollo HTTP. In questo modo un'unica classe `LLMProvider` consente di interfacciare qualsiasi backend.

Lo streaming delle risposte (gestito tramite *Server-Sent Events* con l'SDK OpenAI) è essenziale per l'esperienza utente: senza di esso, l'operatore si troverebbe di fronte a un terminale bloccato per diversi secondi o minuti, senza alcun riscontro sull'avanzamento dell'elaborazione.

---

### Tappa 2 — Il ciclo agentico (Function Calling)

*Riferimenti nel codice: `src/core/agent.ts`*

Il nucleo operativo dell'harness segue il pattern **ReAct** (*Reason + Act*), articolato in quattro passaggi sequenziali:

1. **Invio del contesto**: la cronologia della conversazione viene trasmessa all'LLM unitamente alle definizioni dei tool abilitati.
2. **Analisi della risposta**: se il modello restituisce una o più chiamate a funzione (`tool_calls`), l'harness ne sospende l'output testuale e avvia l'esecuzione dei tool richiesti.
3. **Integrazione dei risultati**: gli output dei tool vengono aggiunti alla cronologia come messaggi con ruolo `tool`.
4. **Ciclo ricorsivo**: la cronologia aggiornata viene re-inviata al modello, ripetendo il processo fino a quando l'LLM non produce una risposta finale puramente testuale.

```
                  ┌──────────────────────┐
                  │ Input Utente/Prompt  │
                  └──────────┬───────────┘
                             │
            ┌────────────────▼────────────────┐
            │   Invia Cronologia + Tool JSON  │◄─────────────┐
            └────────────────┬────────────────┘              │
                             │                               │
                             ▼                               │
                   [ Risposta del Modello ]                  │
                             │                               │
              Ha richiesto   │                               │
              tool calls?    ├───────── No ──────────┐       │
                             │                       │       │
                            Sì                       ▼       │
                             │                 ┌───────────┐ │
                             ▼                 │ Risposta  │ │
                    ┌─────────────────┐        │  Finale   │ │
                    │ Esegui Tool     │        └─────┬─────┘ │
                    │ (Permessi + FS) │              │       │
                    └────────┬────────┘              │       │
                             │                       │       │
                             ▼                       │       │
                    ┌─────────────────┐              │       │
                    │ Aggiungi output │              │       │
                    │ con role: "tool"│──────────────┘       │
                    └────────┬────────┘                      │
                             └───────────────────────────────┘
```

#### Aspetti critici da considerare fin dall'inizio:
* **Tetto massimo ai round (`MAX_TOOL_ROUNDS`)**: i modelli linguistici (in particolare quelli più compatti) possono entrare in loop ricorsivi invocando ripetutamente gli stessi tool. È indispensabile definire un limite massimo di sicurezza (in TSUKA impostato di default a 15 round in `Agent.DEFAULT_MAX_TOOL_ROUNDS`, configurabile tramite `maxToolRounds`).
* **Integrità formale della cronologia**: le API dei provider richiedono che a ogni `tool_call` corrisponda esattamente un messaggio di risposta `tool` con il medesimo `tool_call_id`. Se la cronologia viene alterata o troncata in modo scorretto, le chiamate successive falliranno sistematicamente.

---

### Tappa 3 — Tool Registry con schemi dichiarativi

*Riferimenti nel codice: `src/tools/registry.ts`, `src/tools/index.ts`, `tools_schemas/*.json`*

I tool rappresentano l'elemento con il tasso di espansione più elevato nel ciclo di vita di un harness. Per garantire manutenibilità e scalabilità, è opportuno strutturarli come **plugin modulari**:

* **Implementazione TypeScript**: ogni file in `src/tools/impl/` esporta la logica esecutiva e viene caricato dinamicamente all'avvio (*dynamic import*).
* **Definizione dello schema JSON**: la descrizione del tool e la specifica dei parametri risiedono in file JSON dedicati all'interno della cartella `tools_schemas/`.

```
src/tools/impl/read_file.ts  ──► Logica esecutiva (TypeScript)
tools_schemas/read_file.json ──► Descrizione e parametri (JSON Schema)
```

Separare il codice dallo schema è un vantaggio notevole: **la documentazione e i parametri di un tool costituiscono una forma di prompt engineering**. Poter raffinare le descrizioni per orientare le scelte del modello senza dover ricompilare il codice velocizza notevolmente l'iterazione.

Inoltre, prima di eseguire qualsiasi funzione, gli argomenti forniti dal modello devono essere convalidati rigorosamente a runtime rispetto allo schema dichiarato.

---

### Tappa 4 — Sistema di permessi: User-in-the-Loop

*Riferimenti nel codice: `src/safety/permissions.ts`*

Per garantire la sicurezza del sistema host, ogni tool dichiara un livello di rischio predefinito:

| Livello | Comportamento operativo | Esempi |
|---|---|---|
| `SAFE` | Esecuzione automatica trasparente senza interruzioni. | `read_file`, `list_dir`, `web_search` |
| `RESTRICTED` | Richiede la conferma esplicita dell'utente (con opzione per autorizzare la sessione). | `write_file`, `delete_file`, `edit_file` |
| `DANGEROUS` | Richiede **sempre** autorizzazione esplicita ad ogni singola esecuzione. | `execute_command` |

A questo meccanismo di autorizzazione si affiancano tre ulteriori barriere di sicurezza:
1. **Workspace Sandbox (Jail)**: tutte le operazioni di lettura e scrittura su filesystem possono essere circoscritte alla cartella di lavoro configurata.
2. **Limitazione delle dimensioni di I/O**: limiti prefissati sui volumi di dati scambiati (es. massimo 5 MB per la lettura dei file, troncamento degli output da terminale a 50 KB) per non saturare la memoria dell'applicazione e il contesto del modello.
3. **Oscuramento delle variabili d'ambiente riservate**: filtraggio preventivo di credenziali e token (`KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH`) per impedire che chiavi sensibili finiscano nel contesto inviato all'LLM e nei log del provider.

---

### Tappa 5 — Gestione e ottimizzazione del contesto

*Riferimenti nel codice: `src/core/agent.ts` (`pruneHistory`), `src/core/thinkParser.ts`, `src/core/memory.ts`*

La finestra di contesto rappresenta la risorsa computazionale più critica. TSUKA implementa quattro meccanismi complementari per massimizzarne l'efficienza:

#### 1. Compattazione guidata dai token (Token-driven Pruning)
Il criterio primario di riduzione della cronologia si basa sul budget effettivo di token (`maxHistoryTokens`), non sul semplice conteggio dei messaggi. Questo approccio previene saturazioni improvvise dovute a singoli messaggi molto voluminosi (ad esempio la lettura di un file di grandi dimensioni).

Il limite di contesto viene interrogato dinamicamente dal server LLM all'avvio (tramite `/props` in llama-server, `/api/show` in Ollama, o metadati di OpenRouter). Se il server non fornisce questa informazione, viene adottato il valore di fallback configurato. Il comando `/context` mostra sempre l'origine esatta del limite applicato.

La stima interna dei token adotta un fattore iniziale di 3.5 caratteri per token e si **auto-calibra a runtime**, sincronizzandosi progressivamente con il valore reale di `usage.prompt_tokens` restituito dalle risposte delle API.

```
[System Prompt] ──► [Messaggi Iniziali] ──► [ ...Messaggi Prunati... ] ──► [Ultimi N Messaggi Intatti]
                                                    ▲
                                    (Preserva sempre coerenza tool_call / tool)
```

#### 2. Isolamento dei blocchi di reasoning
Nei modelli di tipo *reasoning* (DeepSeek R1, Qwen QwQ, o3), le sezioni di pensiero delimitate dai tag `<think>` vengono estratte e mostrate all'utente in tempo reale tramite `ThinkTagParser`, ma **vengono rimosse dalla cronologia persistente**. In questo modo si evita di sprecare token ri-inviando catene di ragionamento pregresse nei turni successivi.

#### 3. Memoria persistente condivisa
Un archivio strutturato su disco (`memory/memory.json`) registra fatti, convenzioni di progetto e preferenze dell'utente, rendendoli disponibili tra sessioni differenti e tra agenti diversi:
* **Scoping dei contesti**: ogni informazione può avere uno scope locale (relativo al workspace corrente) o `globale`, evitando interferenze tra progetti distinti.
* **Iniezione semantica e ranking**: le informazioni pertinenti vengono selezionate tramite scoring basato su corrispondenze multiple di parole chiave (logica OR ponderata) e iniettate in forma sintetica nel system prompt.
* **Politica di eviction a punteggio**: al raggiungimento della capienza massima (`memoryMaxFacts`, default a 200), i record vengono rimossi in base a frequenza d'uso, tipologia e data, garantendo la conservazione permanente dei fatti contrassegnati come `pinned`.

#### 4. Salvataggio su disco del ragionamento esteso
I blocchi di ragionamento voluminosi vengono archiviati su disco in file Markdown dedicati (`memory/thinking/*.md`), memorizzando nell'indice principale solo un puntatore sintetico. Il comando dedicato `/continue [traccia]` consente all'utente di reiniettare esplicitamente un percorso logico interrotto nei turni successivi.

---

### Tappa 6 — Interfaccia utente: streaming, rendering e reattività

*Riferimenti nel codice: `src/cli/stream.ts`, `src/cli/statusline.ts`, `src/cli/markdown.ts`, `src/cli/interrupt.ts`*

Per mantenere l'applicazione snella e senza dipendenze pesanti da framework TUI complessi, l'interfaccia adotta un'architettura basata su **stream grezzo live → cancellazione ANSI → repaint formattato**:
1. Durante la generazione, il testo grezzo viene stampato a video man mano che arrivano i chunk dallo stream.
2. Al termine della risposta, l'area interessata viene cancellata tramite sequenze di escape ANSI (`\x1b[nF\x1b[0J`).
3. Il contenuto completo viene quindi ridipinto come pannello Markdown renderizzato, con evidenziazione della sintassi e box formattati.

```
[ Generazione in corso ] ──► [ Stream grezzo a video ]
                                      │
[ Fine generazione ]     ──► [ Cancella area ANSI: \x1b[nF\x1b[0J ]
                                      │
                         ──► [ Repaint finale in Markdown stilizzato ]
```

Durante la fase di generazione, l'input da tastiera passa in modalità grezza (*raw mode*) per consentire la cancellazione immediata del turno tramite il tasto `Esc` o la combinazione `Ctrl+X` (gestita con `AbortController`), preservando lo stato della sessione senza dover terminare il processo.

Tutte le emissioni a video sono instradate attraverso un'astrazione a sink sostituibile (`src/core/logSink.ts`), disaccoppiando il motore logico dell'harness dall'interfaccia di visualizzazione.

---

### Tappa 7 — Architettura multi-agente e coordinamento

*Riferimenti nel codice: `roles/`, `traits/`, `characters/`, `teams/`, `src/cli/commands/{call.ts,team.ts,goal.ts,strategies/}`, `src/core/blackboard.ts`, `src/core/loop.ts`*

#### 7.1 L'equazione fondamentale: Personaggio = Agente

In molti framework agentici un "agente" è una complessa classe software hardcodata. In TSUKA l'approccio è puramente dichiarativo: **un agente non è altro che un personaggio composto a runtime**:

```
┌─────────────────────────┐     ┌────────────────────────┐
│     RUOLO (roles/)      │  ×  │    TRATTO (traits/)    │  ──►  PERSONAGGIO / AGENTE
│ (Cosa fa + tool ammessi)│     │(Come parla + carattere)│      (es. @geordi, @worf, @pike)
└─────────────────────────┘     └────────────────────────┘
```

* **Ruolo (`roles/*.json`)**: definisce le competenze tecniche e i tool che l'agente è autorizzato a invocare (es. `developer`, `sysadmin`, `security_auditor`, `supervisor`).
* **Tratto (`traits/*.json`)**: imposta il tono di voce e lo stile comunicativo (es. `professional`, `creative`, `grumpy`, `uncompromising`).
* **Personaggio (`characters/*.json`)**: unisce ruolo e tratto attribuendo un nome (`aiName`), una descrizione e una skill attiva (es. `Geordi` = `developer` + `professional`).

Quando nel terminale invochi `/agent geordi`, `/call @worf, @tuvok` o avvii un team con `/team`, **stai a tutti gli effetti instanziando e coordinando agenti AI autonomi e specializzati**. 

Inoltre, un personaggio può disporre di competenze multiple (`roles: [...]`), montando un ruolo alla volta per non sovraccaricare il prompt e cambiando competenza attiva a runtime con il tool `switch_skill`.

#### 7.2 Le strategie di coordinamento (`/team`)

La gestione del team collaborativo supporta tre strategie principali:

```
1. ORCHESTRATED (Consigliata)
   [ Orchestratore ] ──► decide ──► [ Agente A ] ──► [ Orchestratore ] ──► decide ──► [ Agente B ]
   
2. ROUND-ROBIN
   [ Agente A ] ───────► passa a ───────► [ Agente B ] ───────► passa a ───────► [ Agente C ]
   
3. PIPELINE
   [ Fase 1: Input ] ──► [ Fase 2: Analisi ] ──► [ Fase 3: Sintesi ] ──► [ Output Finale ]
```

| Strategia | Meccanismo di selezione del turno | Quando utilizzarla |
|---|---|---|
| **orchestrated** | Un agente supervisore decide dinamicamente a ogni turno chi deve intervenire. | **Scelta consigliata di default** per team con ruoli eterogenei e compiti articolati. |
| **round-robin** | Sequenza ciclica fissa predefinita tra i membri del team. | Team compatti con competenze equivalenti o per baseline di test. |
| **pipeline** | Esecuzione lineare sequenziale a passaggio singolo. | Flussi rigidi e unidirezionali in cui l'ordine di elaborazione è rigorosamente stabilito a priori. |

#### Perché la strategia orchestrata è la più efficace:
1. **Coinvolgimento mirato**: interviene solo l'agente le cui competenze sono richieste nello stato corrente del task, evitando turni a vuoto che saturerebbero il contesto.
2. **Decisione atomica e semplificata**: l'orchestratore riceve un digest compatto degli ultimi interventi e dispone di un unico tool (`route_next`), un compito lineare eseguibile con precisione anche da modelli compatti.
3. **Tracciabilità delle decisioni**: ogni instradamento viene registrato nei log di workflow con motivazione e metodo di decisione (tool call o fallback testuale).

#### Confronto tra `/team` (orchestrated) e `/goal`:

| Caratteristica | `/team` (orchestrated) | `/goal` (Goal Orchestrator) |
|---|---|---|
| **Momento della decisione** | Dinamica, dopo ogni singolo turno. | Globale, all'inizio del workflow. |
| **Output prodotto** | L'agente designato per il turno successivo. | Un piano di lavoro strutturato in step sequenziali/paralleli. |
| **Selezione agenti** | Limitata ai membri definiti nel team JSON. | Dinamica, selezionata tra **tutti** i personaggi installati. |
| **Parallelismo** | No (sequenziale, un turno alla volta). | Sì, supporta blocchi `PARALLELO` concorrenti. |
| **Rilavorazione** | Progressiva turno dopo turno. | Verdetto del supervisore finale con riapertura mirata degli step. |

#### Protocollo di comunicazione tra agenti
Il coordinamento operativo si affida a tre tool dedicati con livello `SAFE`:
* `report_status(status, summary, next_hint)`: notifica lo stato del turno (`COMPLETATO`, `DA_CONTINUARE`, `FALLITO`).
* `route_next(agent, reason)`: utilizzato dall'orchestratore per designare il prossimo agente o dichiarare la `FINE`.
* `cast_vote(vote, reason)`: impiegato nelle discussioni collegiali per approvare o richiedere modifiche (`APPROVO`, `MODIFICARE`, `RIFIUTO`).

La risoluzione segue una gerarchia rigorosa: **Tool call esplicita → Parsing regex del testo (fallback) → Default di sicurezza**. Qualsiasi degradazione al livello di fallback genera un avviso visibile a terminale e viene tracciata nei log del workflow.

#### Concorrenza e Blackboard di sessione
Nei blocchi `PARALLELO` di `/goal` (eseguiti tramite `Promise.all` che comunque io ho disabilitato perché uso una sola GPU locale):
* **Coda unificata dei permessi**: le richieste di autorizzazione interattiva vengono accodate ed elaborate una alla volta in modo deterministico.
* **Workspace isolati di staging**: ogni ramo parallelo opera in una cartella temporanea dedicata isolata tramite `AsyncLocalStorage` (`withWorkspaceOverride`), riconciliando le modifiche al termine e segnalando eventuali conflitti su file condivisi.
* **Blackboard di run (`blackboard.ts`)**: uno spazio condiviso temporaneo accessibile tramite i tool `post_note` e `read_notes` per consentire agli agenti dello stesso run di scambiarsi appunti, decisioni e artefatti intermedi senza inquinare la memoria a lungo termine.

---

### Tappa 8 — Adattività ai modelli: Capability Fingerprinting

*Riferimenti nel codice: `src/core/modelProfile.ts`, `src/tools/registry.ts`*

Nei contesti locali i modelli spaziano da 1B a 70B di parametri. Un modello compatto (es. 7B o 9B) rischia di fallire se esposto a un numero eccessivo di definizioni di tool complessi.

Anziché affidarsi a euristiche basate sul nome del file di modello, TSUKA adotta un sistema di **Capability Fingerprinting** (`/benchmark`):
* Esegue una serie di test oggettivi su *instruction following*, generazione JSON e *function calling* strutturato (definiti in `benchmarks/*.json`).
* Calcola e memorizza un punteggio oggettivo determinando il **tier del modello** (`small`, `medium`, `large`).
* Il registry dei tool applica automaticamente un filtro a due livelli: **Ruolo attivo × Tier misurato del modello**.
* I profili registrano l'hash del banco di prova e sono indicizzati in base al livello di *reasoning effort*, garantendo misurazioni affidabili e riproducibili.

---

### Tappa 9 — Auto-estensione: creazione dinamica di tool

*Riferimenti nel codice: `src/tools/impl/createTool.ts`*

TSUKA include una funzionalità avanzata di self-extension: tramite il tool `create_tool`, un agente con autorizzazioni adeguate (ad esempio un `developer`) può generare a runtime nuove utility JavaScript/TypeScript.

Per garantire la stabilità dell'ambiente:
* Il codice viene validato all'interno di una sandbox `node:vm` con blocco degli accessi non autorizzati.
* I tool generati a runtime possono avere al massimo livello `SAFE` o `RESTRICTED` (mai `DANGEROUS`).
* È vietata la sovrascrittura dei tool di sistema (core).
* Viene effettuato un backup preventivo automatico e la registrazione a caldo nel registro dei tool.

---

### Tappa 10 — Distribuzione e risoluzione delle configurazioni

*Riferimenti nel codice: `src/core/apphome.ts`, `package.json`*

Quando l'harness viene eseguito come comando globale di sistema (`tsuka`), è fondamentale separare due percorsi:
* **Home dell'applicazione (`appHome`)**: dove risiedono i binari di sistema, i preset nativi e le impostazioni predefinite.
* **Workspace corrente**: la cartella di lavoro in cui l'utente sta operando.

TSUKA adotta una **risoluzione gerarchica**: se nella cartella corrente è presente una directory `.tsuka/` (generata con `tsuka init`), le configurazioni, i personaggi e la memoria locali hanno la precedenza su quelli globali. In caso contrario, il sistema ricade in modo trasparente sulle risorse globali dell'applicazione.

---

## 3. Riepilogo architetturale: componenti universali e scelte di TSUKA

### Componenti comuni a qualsiasi harness agentico
| Componente | Ruolo architetturale |
|---|---|
| **Ciclo ReAct & Function Calling** | Motore ricorsivo di esecuzione tra LLM e tool. |
| **Astrazione Provider OpenAI-compatible** | Client unico per interagire con server locali e provider cloud. |
| **Tool Registry dichiarativo** | Separazione tra logica esecutiva e schemi JSON di validazione. |
| **Sistema di permessi multilivello** | Controllo degli accessi a salvaguardia del sistema operativo (*User-in-the-Loop*). |
| **Streaming e UI reattiva** | Visualizzazione progressiva e gestione degli interrupt da tastiera (`Esc`). |
| **Pruning token-driven della cronologia** | Gestione della finestra di contesto basata su token reali. |

### Caratteristiche distintive di TSUKA
| Caratteristica | Vantaggio operativo |
|---|---|
| **Capability Fingerprinting (`/benchmark`)** | Calcolo oggettivo del tier dei modelli per filtrare i tool supportati. |
| **Orchestrazione dinamica (`route_next`)** | Assegnazione dinamica del turno basata su un supervisore dedicato. |
| **Protocollo strutturato con fallback visibile** | Tool di coordinamento formali con tracciamento esplicito delle degradazioni. |
| **Verifica oggettiva e loop di correzione (`loop.ts`)** | Validazione dei risultati tramite comandi o verificatori dedicati prima della chiusura. |
| **Branch paralleli isolati** | Staging indipendente del filesystem con `AsyncLocalStorage` e merge sicuro. |
| **Blackboard di sessione isolata** | Condivisione temporanea dello stato di workflow senza inquinare la memoria globale. |
| **Architettura Windows-first & Cross-platform** | Supporto primario per PowerShell su Windows con piena compatibilità Linux/macOS. |

---

## 4. Dieci insidie pratiche nello sviluppo di un harness

1. **Interpolazione nei rimpiazzi di stringhe**: `String.prototype.replace` interpreta sequenze speciali come `$&` o `` $` `` nel testo sostitutivo. Negli strumenti di modifica file (`edit_file`) è opportuno usare sempre una funzione di rimpiazzo `() => replacement`.
2. **Import dinamici in ambienti ibridi CommonJS / ESM**: `import()` dinamico traspilato può generare comportamenti differenti tra ambienti di sviluppo (`tsx`) e pacchetti compilati. È fondamentale testare sempre entrambe le configurazioni.
3. **Misurazione inaccurata dei token in streaming**: contare i singoli frammenti di stream (*chunk*) produce stime di velocità errate; i valori corretti si ottengono abilitando `stream_options: { include_usage: true }`.
4. **Invalidazione degli indici durante la potatura**: recuperare i nuovi messaggi tramite slice basate su indici numerici fallisce se la cronologia viene accorciata a metà esecuzione; è preferibile tracciare i riferimenti agli oggetti messaggio.
5. **Entità HTML nel rendering del terminale**: i parser Markdown possono convertire caratteri in entità HTML (es. `&#39;`), che richiedono una fase esplicita di decodifica prima della stampa su terminale ANSI.
6. **Esfiltrazione involontaria di credenziali**: tool diagnostici che leggono le variabili d'ambiente possono includere inavvertitamente chiavi API nel prompt; è essenziale applicare una maschera di censura preventiva.
7. **Accodamento invisibile sui server locali**: un modello locale apparentemente bloccato potrebbe essere semplicemente in coda su un'istanza a slot singolo. È necessario fornire all'utente indicatori visivi di stato e timeout globali sull'intera generazione.
8. **Argomenti JSON sovradimensionati**: passare interi file come parametri inline può causare la generazione di JSON troncati o non validi da parte del modello. È preferibile strutturare i tool per supportare scritture incrementali (*append*) o percorsi su file.
9. **Corruzione della cronologia da JSON malformati**: una risposta con sintassi JSON errata non deve essere salvata grezza nella cronologia, altrimenti comprometterà tutte le chiamate successive; gli argomenti vanno convalidati e sanificati prima del salvataggio.
10. **Isolamento della memoria nei test automatici**: i test end-to-end non devono mai scrivere nell'archivio `memory.json` reale dell'utente; l'istanza di test deve operare su percorsi temporanei isolati tramite variabili d'ambiente dedicate.

---

## 5. Da dove iniziare per implementare un harness da zero

1. **Fase 1 — REPL e client streaming** (Tappa 1): implementa l'interfaccia interattiva da riga di comando e il collegamento HTTP con il server LLM.
2. **Fase 2 — Ciclo agentico, tool essenziali e permessi** (Tappe 2–4): realizza il ciclo di *function calling* con i tre strumenti fondamentali (`read_file`, `write_file`, `list_dir`) e un controllo di autorizzazione sulle operazioni di scrittura.
3. **Fase 3 — Gestione del contesto e interfaccia** (Tappe 5–6): integra la potatura automatica dei messaggi basata sui token e il rendering Markdown a terminale.
4. **Fase 4 — Multi-agente e profilazione** (Tappe 7–8): struttura i ruoli, definisci il protocollo di coordinamento (`report_status`, `route_next`) e implementa la classificazione per tier dei modelli.
5. **Fase 5 — Estendibilità e distribuzione** (Tappe 9–10): aggiungi la creazione dinamica di tool in sandbox e la gestione gerarchica delle configurazioni di progetto (`apphome` vs `workspace`).

---

*Per ulteriori approfondimenti tecnici sull'architettura e i componenti di sistema, consulta la documentazione dedicata: [Architettura di Sistema](architecture.md) · [Workflow Multi-Agente](multi-agent.md) · [Sicurezza e Permessi](security.md) · [Casi d'Uso](use-cases.md).*
