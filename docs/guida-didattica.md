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

La facade `Agent` coordina il ciclo senza possederne più tutte le invarianti: la
cronologia, il round dei tool, la calibrazione token, lo stato ReAct e la persistenza
delle trace sono moduli separati (`conversationHistory.ts`, `toolRound.ts`,
`tokenCalibration.ts`, `reactState.ts`, `reasoningTrace.ts`). Questo mantiene il
contratto pubblico stabile mentre ogni responsabilità può essere verificata in modo
isolato.

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
* **Compatibilità dei gateway**: il provider ritenta gli HTTP 429 con attesa limitata e cancellabile, rispettando `Retry-After` quando presente. I messaggi assistant privi sia di contenuto sia di tool call vengono scartati prima dell'invio: alcuni gateway rifiutano esplicitamente questa forma.

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

### Tappa 4 — Permessi e confinamento

*Riferimenti nel codice: `src/safety/permissions.ts`, `src/tools/impl/utils.ts` (`resolveSafePath`), `src/core/network.ts`, `src/core/subagentRunner.ts`, `src/tools/customToolRunner.ts`*

Un agente agisce sul mondo attraverso i tool. Le domande di sicurezza sono quindi due, e vanno tenute separate: **chi decide se un'azione può partire** (permessi) e **fin dove può arrivare un'azione una volta partita** (confinamento).

#### 4.1 Permessi: l'utente nel ciclo

Ogni tool dichiara un livello di rischio:

| Livello | Comportamento operativo | Esempi |
|---|---|---|
| `SAFE` | Esecuzione automatica trasparente senza interruzioni. | `read_file`, `list_dir`, `web_search` |
| `RESTRICTED` | Richiede la conferma esplicita dell'utente (`[y/N/always]`). `delete_file` richiede sempre conferma; `write_file` ed `edit_file` possono essere autorizzati anche con `/sudo on`. | `write_file`, `delete_file`, `edit_file` |
| `DANGEROUS` | Richiede una conferma per esecuzione per default. `execute_command` può essere autorizzato esplicitamente per la sessione con `/sudo on`, azionato dall'utente. | `execute_command` |

Il livello può dipendere dagli argomenti: `execute_command` classifica il comando richiesto (una lettura innocua pesa meno di una composizione di comandi). I tool generati dal modello non possono abbassare il proprio livello: sono sempre `DANGEROUS`.

`/sudo` è intenzionalmente un controllo della sessione, non un tool dell'agente: un modello non può abilitarlo. Espone `execute_command`, `write_file` ed `edit_file` oltre i filtri di ruolo e tier e ne bypassa i prompt all'interno della workspace jail; non eleva i privilegi del sistema operativo, non concede accesso ad altri tool e non bypassa le conferme di `delete_file`. `/sudo off`, `/reset` e un nuovo runtime revocano il controllo.

#### 4.2 Confinamento: una mappa dei confini

Una conferma dice *se* un'azione parte, non *dove* arriva. Per questo TSUKA affianca ai permessi una serie di confini, ciascuno pensato contro un rischio preciso. La cosa più utile da imparare è leggerli insieme, colonna per colonna: che cosa protegge ognuno e **dove smette di proteggere**.

| Confine | Protegge da | Come | Dove non arriva |
|---|---|---|---|
| **Workspace jail** | Tool sui file che escono dal progetto | `resolveSafePath` risolve il percorso reale (`realpath`, quindi anche i symlink) e lo rifiuta se è fuori da `workspaceRoot` | Vale per i tool nativi sui file, non per un comando di shell o un server MCP |
| **Policy di rete** (`safeFetch`) | Richieste verso la rete interna (SSRF), anche tramite redirect o DNS rebinding | Solo HTTP(S) su porte standard; ogni indirizzo risolto deve essere pubblico, controllato sulla stessa risposta DNS usata dal socket, a ogni redirect | Vale per `browse_url`, `download_file`, `web_search`, non per la shell |
| **Perimetro dei sub-agenti** | Un figlio che ottiene tool che il padre non ha | Sia la delega automatica sia `spawn_agent` passano al figlio il perimetro dei tool del padre: il figlio può scegliere un altro ruolo, ma non ottiene tool in più | Memoria e blackboard, che il runner dà a ogni figlio, restano sempre disponibili |
| **Processo separato per i tool generati** | Codice scritto dal modello che gira dentro TSUKA | Processo Node figlio con permission model: file solo nel workspace, niente rete né sottoprocessi, ambiente vuoto, limiti di tempo, memoria e output (vedi Tappa 9.1) | Il permission model di Node non è progettato contro codice volutamente malevolo |
| **Staging dei blocchi paralleli** | Due agenti che scrivono lo stesso file nello stesso momento | Ogni ramo scrive in una cartella propria; il merge segnala i conflitti invece di sovrascrivere | È coerenza dei dati, non sicurezza |
| **Limiti di I/O** | Saturare la memoria di TSUKA o il contesto del modello | Tetti su letture, output dei comandi e download; troncamento con paginazione | Non limitano che cosa viene letto, solo quanto |
| **Ambiente senza credenziali** | Un comando o un server MCP che legge le chiavi API di TSUKA | I processi figli partono senza le variabili dai nomi sensibili (`childEnv.ts`); le eccezioni vanno dichiarate (`commandEnvPassthrough`, `env` del server MCP); i tool generati ricevono un ambiente vuoto | Pulisce l'ambiente, non il disco: un comando può ancora leggere un `.env` nel workspace, e i risultati dei tool non sono filtrati (T24.2) |

Nella colonna di destra torna più volte lo stesso protagonista: **la shell e i server MCP**. Non è un caso. Un comando di shell o un server esterno è un programma con i permessi del processo che lo lancia; nessun controllo sul testo del comando lo trasforma in una sandbox. Si può togliergli ciò che non gli serve (le credenziali dall'ambiente), non limitare ciò che fa con quello che resta. Per questo `execute_command` resta `DANGEROUS`, i server MCP partono `RESTRICTED` salvo configurazione diversa, e `/sudo` è una scelta esplicita dell'utente.

#### 4.3 Un controllo non è un confine

Tutta la tappa si riassume in una distinzione che vale per qualunque harness:

* un **controllo** esamina l'azione prima che parta (un pattern vietato, un percorso validato, un DNS risolto in anticipo) e può essere aggirato da ciò che non ha previsto: un percorso scritto in un altro modo, un DNS che cambia risposta fra il controllo e la connessione, `fs['read' + 'FileSync']` invece di `readFileSync`;
* un **confine** toglie la possibilità stessa: un processo senza permesso di rete non può aprire un socket, comunque sia scritto il codice.

Diversi interventi di TSUKA sono esattamente il passaggio dal primo al secondo: la jail è passata dal confronto fra stringhe al percorso reale, la policy di rete dal DNS risolto in anticipo al DNS usato dal socket, i tool generati da `node:vm` e una blocklist a un processo separato. Quando nemmeno un confine basta, come per la shell, la risposta onesta è dichiararlo e lasciare la decisione all'utente.

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

### Tappa 6 — Disaccoppiare l'interfaccia: un motore agnostico (CLI, TUI, Web)

*Riferimenti nel codice: `src/core/logSink.ts`, `src/core/agent.ts` (`AgentEvents`), `src/tui/`, `src/cli/stream.ts`, `src/cli/interrupt.ts`*

#### 1. Il problema del `console.log` diffuso
Quando si inizia a costruire un harness, la tentazione più comune è inserire chiamate a `console.log` ovunque per monitorare l'esecuzione dei tool, il caricamento della memoria o il ciclo ReAct. Questo approccio rapido diventa però un vicolo cieco non appena si vuole far evolvere l'interfaccia:
* Se un tool stampa direttamente a video durante una risposta, rischia di spezzare il rendering del testo.
* Se si crea una **dashboard interattiva a schermo intero (TUI)**, una singola riga stampata a video dal core distrugge il layout grafico del terminale.
* Se in futuro si vuole collegare un'interfaccia Web o un server in background, quei log restano intrappolati nel processo locale anziché raggiungere l'utente.

#### 2. La soluzione: separare il motore dall'output
Per rendere l'harness davvero modulare, il motore logico (Core, Memoria, Tool) **non deve mai stampare direttamente a video**. L'output viene invece instradato attraverso due canali dedicati:

1. **Canale di conversazione (`AgentEvents`)**: durante la generazione, l'agente emette eventi tipizzati a chiunque stia ascoltando (`onChunk` per i frammenti di testo in arrivo, `onStats` per token e velocità, `onEvent` per lo stato dei tool).
2. **Canale di diagnostica (`logSink`)**: tutti i moduli di servizio inviano avvisi, errori e messaggi operativi a un sink sostituibile (`logSink.log()`, `logSink.warn()`, `logSink.error()`).

```
┌────────────────────────────────────────────────────────┐
│                  MOTORE CORE AGENTICO                  │
│       (Nessun console.log — logica pura riusabile)     │
└──────────────┬───────────────────────────┬─────────────┘
               │ Eventi stream             │ Log e warning
               ▼ (AgentEvents)             ▼ (logSink)
       ┌────────────────────────┐  ┌─────────────────────┐
       │     Dashboard TUI      │  │      CLI REPL       │
       │    a schermo intero    │  │   classica a riga   │
       │    (npm run tui)       │  │   di comando        │
       └────────────────────────┘  └─────────────────────┘
```

Lo stesso confine vale per le richieste di autorizzazione: `PermissionManager`
decide se una richiesta è ammessa e serializza i prompt concorrenti, ma non conosce
menu o terminale. CLI e TUI iniettano un `PermissionPromptHandler`; in un contesto
headless privo di renderer, le operazioni non `SAFE` vengono negate per default.
Anche i tool di escalation richiedono workflow tramite il contratto
`WorkflowDispatcher`, senza importare i command handler di una specifica interfaccia.

#### 3. La prova pratica: da CLI a TUI senza toccare il Core
Grazie a questo disaccoppiamento, TSUKA può offrire due interfacce completamente diverse usando esattamente lo stesso motore:
* **TUI a schermo intero (`src/tui/`)**: intercetta gli `AgentEvents` per aggiornare in tempo reale la chat, i blocchi di pensiero `<think>`, l'albero dei file e la telemetria, mentre reindirizza i messaggi di `logSink` nelle notifiche pop-up.
* **CLI classica (`src/cli/`)**: riceve gli stessi eventi per mostrare lo streaming continuo dei token e ridipingere il testo formattato in Markdown a fine risposta.

In entrambi i casi, l'utente può premere `Esc` o `Ctrl+X` in qualsiasi momento per interrompere la generazione: l'interruzione viene gestita tramite un segnale asincrono (`AbortController`), preservando lo stato della sessione senza dover terminare il programma.

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
| **Parallelismo** | No (sequenziale, un turno alla volta). | Sì, supporta blocchi `PARALLEL` concorrenti. |
| **Rilavorazione** | Progressiva turno dopo turno. | Verdetto del supervisore finale con riapertura mirata degli step. |

#### Protocollo di comunicazione tra agenti
Il coordinamento operativo si affida a tre tool dedicati con livello `SAFE`:
* `report_status(status, summary, next_hint)`: notifica lo stato del turno (`COMPLETED`, `CONTINUE`, `FAILED`).
* `route_next(agent, reason)`: utilizzato dall'orchestratore per designare il prossimo agente o dichiarare la fine (`END`).
* `cast_vote(vote, reason)`: impiegato nelle discussioni collegiali per approvare o richiedere modifiche (`APPROVE`, `REVISE`, `REJECT`).

La risoluzione segue una gerarchia rigorosa: **Tool call esplicita → Parsing regex del testo (fallback) → Default di sicurezza**. Qualsiasi degradazione al livello di fallback genera un avviso visibile a terminale e viene tracciata nei log del workflow.

#### Concorrenza e Blackboard di sessione
Nei blocchi `PARALLEL` di `/goal` (eseguiti tramite `Promise.all` che comunque io ho disabilitato perché uso una sola GPU locale):
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

### Tappa 9 — Estendibilità: Tool dinamici fuori processo ed ecosistema MCP

*Riferimenti nel codice: `src/tools/impl/createTool.ts`, `src/tools/customToolRunner.ts`, `src/core/mcp/` (`types.ts`, `stdioTransport.ts`, `client.ts`, `adapter.ts`, `connectMcpServers.ts`)*

Un harness completo non può rimanere vincolato al catalogo iniziale di tool statici. Per consentire all'agente di affrontare compiti imprevisti e interagire con servizi esterni, l'architettura adotta due meccanismi complementari di estensione:

#### 9.1 Estensione Interna: creazione dinamica di tool a runtime (`create_tool`)
Con `selfAuthoringEnabled: true`, un agente che possiede `create_tool` può scrivere un nuovo tool JavaScript, descriverne gli argomenti con JSON Schema e usarlo nella stessa sessione. La capability è disabilitata per default, ed è l'esempio più chiaro nel progetto di una domanda che ogni harness di agenti prima o poi incontra: **dove gira il codice scritto dal modello?**

**Il problema.** Un tool generato è codice che nessuno ha ancora rivisto, scritto da un modello che magari pochi turni prima ha letto una pagina web ostile. Caricato con `require()`, girerebbe *dentro* TSUKA, con tutto ciò che TSUKA ha: l'intero disco, la rete, le chiavi API nell'ambiente, la possibilità di lanciare processi. Una versione precedente validava i moduli con `node:vm` e una blocklist di pattern vietati; un audit esterno ha fatto notare che nessuno dei due è un confine di sicurezza. `node:vm` separa le variabili globali, non i privilegi (`({}).constructor.constructor('return process')()` ne esce), e una blocklist vede solo il testo per cui è stata scritta (`fs['read' + 'FileSync']` non contiene `readFileSync`).

**Il progetto: un altro processo, meno permessi** (`customToolRunner.ts`). La validazione e ogni chiamata avviano un processo Node figlio nuovo:

```
TSUKA ──spawn──► node --permission --allow-fs-read=<workspace> --allow-fs-write=<workspace>
  │                   --disallow-code-generation-from-strings --max-old-space-size=256 -e <runner>
  │  stdin:  { source, name, args }            env: {}      cwd: <workspace>
  └◄ stdout: { ok, result }  (una riga JSON; console.* va su stderr)
```

Ogni scelta risponde a un attacco preciso:

| Scelta | Cosa impedisce |
|---|---|
| Processo separato | Un crash, un loop infinito o una memoria che esplode chiudono il figlio, mai TSUKA; un timeout lo uccide |
| `--permission` + `--allow-fs-*` solo sul workspace | Leggere o scrivere file altrove, comunque sia scritto il percorso |
| Nessun `--allow-net`, `--allow-child-process`, `--allow-worker` | Rete, nuovi processi, worker — anche tramite `process.getBuiltinModule` |
| `--disallow-code-generation-from-strings` | `eval`, `Function` e il trucco della catena di constructor visto sopra |
| `env` vuoto | Chiavi API e token non arrivano mai al codice generato |
| Tetto all'output e protocollo JSON | Un tool non può inondare TSUKA né restituire altro che una stringa |
| Rifiuto su Node < 25 | I runtime precedenti non hanno `--allow-net`: meglio non eseguire che eseguire senza confini (**fail closed**) |

Il modulo riceve `fs` e `path` come parametri iniettati, e un `require` locale non serve nient'altro. All'avvio i moduli trovati su disco vengono solo *registrati*: il loro codice gira, confinato, quando vengono chiamati.

**Il limite dichiarato.** La documentazione di Node definisce il suo permission model una *cintura di sicurezza* per codice fidato, non una sandbox contro codice malevolo. Un contenimento vero richiederebbe una sandbox del sistema operativo o un container, che sono diversi su Windows, Linux e macOS. Il progetto ha confrontato tre opzioni — processo confinato, sandbox del sistema operativo, disabilitazione permanente — e ha scelto il processo confinato come difesa in profondità, mantenendo le altre due chiavi:
* **Opt-in**: non si carica nulla se la configurazione del progetto non lo dice;
* **Sempre DANGEROUS**: la creazione e ogni chiamata richiedono una conferma esplicita, qualunque cosa il modulo dichiari di sé;
* **Protezione del Core**: i tool nativi non si possono sovrascrivere, e la versione precedente di un tool sostituito viene salvata in backup.

La lezione va oltre questa funzione: *un controllo non è un confine*. Validazione e pattern matching descrivono il codice; solo il sistema operativo, attraverso un processo separato, può davvero togliere un privilegio. E quando nemmeno questo basta, va detto chiaramente.

#### 9.2 Estensione Esterna: Client MCP nativo (Model Context Protocol)
Per connettere l'agente a fonti dati e servizi complessi (repository GitHub, database SQLite, browser web, filesystem esterni) senza dover implementare decine di librerie dedicate in TypeScript, l'harness supporta lo standard aperto **Model Context Protocol (MCP)**.

Invece di appesantire il progetto con SDK esterni, TSUKA adotta un'implementazione **nativa e a zero dipendenze** (~400 righe in `src/core/mcp/`):
1. **Trasporto Standard I/O (`stdioTransport.ts`)**: all'avvio, l'harness legge la sezione `mcpServers` dal file `tsuka.config.json` e avvia ciascun server configurato come processo figlio comunicando via `stdin`/`stdout`.
2. **Handshake e auto-discovery (`client.ts`)**: il client comunica tramite **JSON-RPC 2.0**, esegue l'handshake iniziale (`initialize`) e scarica la lista dei tool disponibili (`tools/list`).
3. **Integrazione come Adapter (`adapter.ts`)**: i tool remoti vengono registrati nel `ToolRegistry` con il prefisso `mcp__<server>__<tool>`, usando gli schemi JSON forniti dal server per convalidare le chiamate del modello.
4. **Sicurezza e resilienza**: i tool MCP ereditano automaticamente il sistema dei permessi (`PermissionManager`, con livello `RESTRICTED` e conferma interattiva). Se un server MCP va in crash o non risponde, l'harness emette un avviso tramite `logSink` e prosegue senza bloccare l'agente. Alla chiusura, tutti i processi figli vengono terminati in modo pulito.

---

### Tappa 10 — Distribuzione e risoluzione delle configurazioni

*Riferimenti nel codice: `src/core/apphome.ts`, `package.json`*

Quando l'harness viene eseguito come comando globale di sistema (`tsuka`), è fondamentale separare due percorsi:
* **Home dell'applicazione (`appHome`)**: dove risiedono i binari di sistema, i preset nativi e le impostazioni predefinite.
* **Workspace corrente**: la cartella di lavoro in cui l'utente sta operando.

TSUKA adotta una **risoluzione gerarchica**: se nella cartella corrente è presente una directory `.tsuka/` (generata con `tsuka init`), le configurazioni, i personaggi e la memoria locali hanno la precedenza su quelli globali. In caso contrario, il sistema ricade in modo trasparente sulle risorse globali dell'applicazione.

---

### Tappa 11 — Invarianti del Core, Composition Root e Contratti Stretti (Fase 8)

*Riferimenti nel codice: `src/core/runtime.ts`, `src/core/agent.ts`, `src/core/provider/`, `src/tools/`, `src/core/memory/`*

Quando un harness agentico cresce oltre le 80 suite di test, la sfida principale diventa la **manutenibilità nel tempo** (Direttive 8, 9, 10 di `AGENTS.md`):

1. **La Composition Root Unificata (`createHarnessRuntime`)**: Inizializzare separatamente configurazioni, provider, registry e permessi nella CLI e nella TUI porta a derive silenziose. Un'unica factory nel core (`runtime.ts`) istanzia l'albero delle dipendenze e garantisce il cleanup idempotente delle risorse (chiusura processi figli MCP, flush memoria) sia su uscita normale che su segnali di interruzione (`SIGINT`, `SIGTERM`).
2. **Isolamento delle Invarianti dell'Agente**: La classe `Agent` non deve essere un monolite che calcola token, gestisce la cronologia, lancia tool e salva tracce contemporaneamente. Lo scorporo in moduli puri (`tokenCalibration.ts`, `conversationHistory.ts`, `toolRound.ts`, `reactState.ts`, `reasoningTrace.ts`) rende ogni invariante isolabile, testabile a livello unitario e priva di effetti collaterali non intenzionali.
3. **Contratti Stretti tra i Layer**: Il motore ReAct non deve conoscere la struttura su disco dei file `.json` dei tool o il protocollo HTTP di streaming del server LLM. La definizione dell'interfaccia `IToolRegistry` e l'incapsulamento del wire format OpenAI in `provider/wireFormat.ts` e `provider/streamAccumulator.ts` consentono di sostituire il backend o il formato dei messaggi senza toccare una sola riga del loop decisionale.
4. **Disaccoppiamento di Codec e Storage nella Memoria**: Nel backend di memoria JSON, la serializzazione dei fatti, la deduplica e la derivazione del summary risiedono in `codec.ts`, mentre l'I/O atomico (scrittura con file temporaneo e `renameSync`) e il recovery automatico da corruzione risiedono in `storage.ts`. `JsonMemoryBackend` orchestra unicamente lo stato RAM e l'interfaccia `MemoryBackend`.

---

## 3. Riepilogo architetturale: componenti universali e scelte di TSUKA

### Componenti comuni a qualsiasi harness agentico
| Componente | Ruolo architetturale |
|---|---|
| **Ciclo ReAct & Function Calling** | Motore ricorsivo di esecuzione tra LLM e tool. |
| **Astrazione Provider OpenAI-compatible** | Client unico per interagire con server locali e provider cloud. |
| **Tool Registry dichiarativo** | Separazione tra logica esecutiva e schemi JSON di validazione. |
| **Permessi e confinamento** | Controllo degli accessi a salvaguardia del sistema operativo (*User-in-the-Loop*). |
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
11. **Mutazioni file non ambigue**: `write_file` accetta `append` soltanto come booleano e rifiuta stringhe, numeri e `null` senza scegliere implicitamente l'overwrite; `edit_file` rifiuta target vuoti ma consente una sostituzione vuota per cancellare intenzionalmente un blocco.
12. **Recovery della configurazione**: un `tsuka.config.json` invalido viene conservato byte per byte in un backup collision-safe prima del ripristino dei default. Se il backup o la scrittura atomica falliscono, le persistenze successive vengono bloccate per evitare perdita silenziosa.
13. **Jail canonica, non lessicale**: controllare soltanto che un path normalizzato inizi con la root non blocca symlink e junction. TSUKA risolve root, target o antenato esistente con `realpath`, consente solo link interni e deduplica le directory reali nelle scansioni ricorsive bounded.

---

## 5. Da dove iniziare per implementare un harness da zero

1. **Fase 1 — REPL e client streaming** (Tappa 1): implementa l'interfaccia interattiva da riga di comando e il collegamento HTTP con il server LLM.
2. **Fase 2 — Ciclo agentico, tool essenziali e permessi** (Tappe 2–4): realizza il ciclo di *function calling* con i tre strumenti fondamentali (`read_file`, `write_file`, `list_dir`) e un controllo di autorizzazione sulle operazioni di scrittura.
3. **Fase 3 — Gestione del contesto e interfaccia** (Tappe 5–6): integra la potatura automatica dei messaggi basata sui token e il rendering Markdown a terminale.
4. **Fase 4 — Multi-agente e profilazione** (Tappe 7–8): struttura i ruoli, definisci il protocollo di coordinamento (`report_status`, `route_next`) e implementa la classificazione per tier dei modelli.
5. **Fase 5 — Estendibilità e distribuzione** (Tappe 9–10): aggiungi la creazione dinamica di tool in sandbox e la gestione gerarchica delle configurazioni di progetto (`apphome` vs `workspace`).

---

*Per ulteriori approfondimenti tecnici sull'architettura e i componenti di sistema, consulta la documentazione dedicata: [Architettura di Sistema](architecture.md) · [Workflow Multi-Agente](multi-agent.md) · [Sicurezza e Permessi](security.md) · [Casi d'Uso](use-cases.md).*
