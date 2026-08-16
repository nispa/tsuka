# Architettura di Tsuka

> Stato: 15 agosto 2026, a valle di FASE 3. Sostituisce la versione precedente di questo
> documento, che era ferma a "9-10 tool" e al tier dedotto dal nome del modello — entrambe cose
> non più vere.
>
> Questo file descrive **come funziona il sistema**. Per le regole di lavoro sul codice vedi
> `AGENTS.md`; per lo stato dei lavori e il debito aperto vedi `TASKS.md`.

**In numeri:** 23 tool · 22 comandi REPL · 21 moduli core · 21 ruoli · 9 tratti ·
28 personaggi · 10 team · 46 suite di test.

---

## 1. Il modello mentale, in una pagina

Tsuka è un **ciclo ReAct** con attorno un'infrastruttura che decide *cosa il modello vede*.

```
messaggio utente
   → si assembla il prompt (identità + memoria pertinente + tool ammessi)
   → il modello risponde: testo, oppure una o più chiamate a tool
   → i tool vengono eseguiti (con permessi e tetto di contesto)
   → i risultati rientrano in cronologia
   → si ripete, fino a una risposta senza tool o al limite di round
```

Il principio che governa tutto il resto: **più il flusso è deciso dal codice e meno dal modello,
meglio rende un modello locale.** Il modello sceglie il contenuto; l'harness sceglie il
contesto, i tool disponibili, quando fermarsi e quanto può costare.

Il ciclo vive in `src/core/agent.ts` (`Agent.run`), con una guardia dura:
`MAX_TOOL_ROUNDS = 15` round consecutivi di tool per singola richiesta.

---

## 2. I tre strati, e il confine che conta

| Strato | Cartella | Responsabilità |
|---|---|---|
| **core** | `src/core/` | ciclo agentico, provider, memoria, contesto, costo. Non conosce il terminale. |
| **tools** | `src/tools/` | registro, schemi, implementazioni. Non conosce l'interfaccia. |
| **cli** | `src/cli/` | REPL, comandi, rendering, menu interattivi. È **un** client, non l'unico possibile. |
| **safety** | `src/safety/` | livelli di rischio e permessi. |

Il confine è dichiarato in `src/core/agentEvents.ts`: *«Il core non stampa più direttamente:
chi invoca l'agente decide come visualizzare»*. `Agent.run` accetta infatti `onChunk`,
`onStats`, `onEvent` e un `AbortSignal` — cioè tutto ciò che serve a un'interfaccia qualunque.

**Il confine era violato in 21 punti** (i restanti 3, in `agent.ts`, sono il renderer di default
usato solo quando nessun `onEvent` è fornito — legittimo, non una violazione): restavano
`console.log`/`error`/`warn` diretti dentro `src/core/` e `src/tools/`, in classi (`MemoryStore`,
`ConfigManager`, `ToolRegistry`, `RunController`, i tool stessi) che non girano dentro un
`Agent.run()` e non hanno un `AgentEventHandler` a disposizione. Risolto instradando tutti quei
punti su `src/core/logSink.ts`, un sink iniettabile con lo stesso comportamento di default
(stampa su console) ma sostituibile da chi vuole intercettare — l'alternativa più leggera già
indicata qui accanto a `AgentEvent`, che avrebbe richiesto cambiare la firma pubblica di mezza
codebase per classi che nascono fuori dal ciclo agentico.

---

## 3. Il viaggio di una richiesta

1. **Assemblaggio del prompt** — `loadSystemPrompt` (`src/cli/shared.ts`) concatena:
   identità del personaggio → `systemPrompt` del ruolo → `prompt` del tratto → linee guida
   generali → **memoria pertinente al compito** → elenco dei tool (omesso per i modelli con
   function calling misurato affidabile, vedi §7).
2. **Selezione dei tool** — `registry.listForLLM(modello, allowedTools, effort)` filtra due
   volte: per i tool ammessi dal ruolo, e per il **tier** del modello a quel livello di effort.
3. **Potatura** — `pruneHistory()` riporta la cronologia entro i limiti prima di ogni chiamata.
4. **Chiamata** — `provider.chatWithTools()`, in streaming, con `reasoning_effort` risolto e
   `max_tokens` come soffitto.
5. **Esecuzione dei tool** — validazione degli argomenti contro lo schema, verifica dei
   permessi, esecuzione, **troncamento del risultato** entro il tetto di contesto.
6. **Ritorno in cronologia** e nuovo giro, fino a una risposta senza tool.

---

## 4. I quattro assi dichiarativi

Tutta la configurazione degli agenti è in JSON, senza codice. I quattro assi sono
**ortogonali** e ricombinabili:

| Asse | Cartella | Cosa definisce |
|---|---|---|
| **Ruolo** | `roles/` | competenza: `systemPrompt`, `allowedTools`, `reasoningEffort` di base |
| **Tratto** | `traits/` | tono e stile della comunicazione |
| **Personaggio** | `characters/` | ruolo + tratto + identità (`aiName`) + `description` |
| **Team** | `teams/` | formazione fissa di personaggi per un workflow |

I **preset** (`presets/core.json` e `presets/packs/*.json`) sono manifest che elencano
sottoinsiemi installabili — `core` copre una competenza distinta per personaggio.

> **La `description` del personaggio è un campo funzionale, non decorativo.** L'orchestrator di
> `/goal` sceglie gli agenti **solo** da lì (`goal.ts:22-28`): non vede il `systemPrompt` del
> ruolo, non vede gli `allowedTools`. Una descrizione vaga rende il personaggio non
> selezionabile.

---

## 5. Il sistema dei tool

**23 tool**, con una separazione netta:

- **schema** in `tools_schemas/<nome>.json` — descrizione, parametri JSON Schema,
  `requiredTier`, `riskLevel`. Modificabile a caldo (cache invalidata su mtime).
- **implementazione** in `src/tools/impl/<nome>.ts` — solo la logica.

**Auto-discovery**: `src/tools/index.ts` scandisce `impl/`, importa i moduli dinamicamente e
registra ciò che rispetta l'interfaccia `Tool`. Aggiungere un tool = aggiungere due file.

**Tre filtri in cascata** decidono cosa il modello vede:

1. `allowedTools` del ruolo;
2. **tier** del modello (`small`/`medium`/`large`) — da profilo **misurato** se disponibile,
   altrimenti euristica sul nome;
3. `requiredTier` dello schema.

Il tier non è più dedotto solo dal nome: `/benchmark` lo **misura** (§8).

**Prima dell'esecuzione**: validazione degli argomenti contro lo schema (campi obbligatori e
tipi base) e verifica del permesso. **Dopo l'esecuzione**: `capForContext` tronca il risultato
(§7).

I tool si dividono per funzione: file (`read_file`, `write_file`, `edit_file`, `delete_file`,
`list_dir`, `grep_search`), sistema (`execute_command`, `get_ps_info`), rete (`web_search`,
`browse_url`), memoria (`save_memory`, `recall_memory`), coordinamento
(`post_note`, `read_notes`, `send_message`, `report_status`, `route_next`, `cast_vote`),
generativi (`spawn_agent`, `create_role`, `create_tool`).

> **`write_file` ha un tetto rigido di 16000 caratteri per chiamata (T9.11).** Osservato in
> produzione: un unico `write_file` con l'intero contenuto di un file multi-livello rompeva
> ripetutamente il parsing JSON della tool call lato server, con modelli locali. La descrizione
> dello schema già suggeriva di dividere i file lunghi in più chiamate con `append`, ma è
> un'istruzione che il modello può ignorare — qui il limite è **fatto rispettare**: oltre la
> soglia il tool rifiuta la chiamata con un errore che prescrive come dividerla (prima porzione
> senza `append`, successive con `append:true`), e **non tronca mai** il contenuto in silenzio.

---

## 6. Le tre memorie, e il confine fra loro

È la distinzione più importante del sistema, ed è facile confonderle.

| | Dove | Vita | Contiene |
|---|---|---|---|
| **Cronologia** | in memoria, per agente | il turno | ciò che è stato **detto** |
| **Lavagna** | `src/core/blackboard.ts` | il **run** | stato condiviso del workflow in corso |
| **Memoria** | `memory/memory.json` | oltre la sessione | ciò che vale **dopo** |

**La lavagna** (`post_note` / `read_notes`) è scoped con `AsyncLocalStorage` sul `runId`, non è
un singleton: i branch di un blocco `PARALLELO` condividono la stessa lavagna perché sono lo
stesso run, run diversi no. Muore in un `finally` a fine run. È un **log ordinato**, non una
mappa: due note con la stessa chiave non si sovrascrivono.

**La memoria persistente** ha una struttura più ricca di quanto sembri:
- `scope` per workspace (più `globale`), così progetti diversi non si mescolano;
- `kind` (`fatto` / `decisione` / `lezione` / `run`) che pilota l'**eviction a punteggio**:
  gli scarti di run cadono per primi, le lezioni per ultime, i `pinned` mai;
- `source` — chi l'ha scritto — usato anche in lettura per non far entrare gli scarti di un
  agente nel prompt di un altro;
- recupero per **rilevanza al compito**, non per recenza, con normalizzazione morfologica
  (`corsi` trova `corso`, `badge` trova `badges`) e senza dipendenze esterne;
- costruire un prompt **non scrive** sulla memoria: la lettura per iniezione non altera
  `hits`/`lastUsed`, che restano il segnale degli usi voluti.

---

## 7. Il governo del contesto

Un modello locale ha una finestra piccola e degrada **molto prima** di riempirla. Tre difese, in
ordine di quando intervengono:

**All'ingresso — tetto per risultato di tool.** `src/core/contextBudget.ts`: `capForContext`
tronca ogni risultato oltre `maxToolResultTokens` (default 4000 token), restituendo testa + coda
con al centro una nota che dice **come recuperare il resto**. `read_file` ha `offset`/`limit`,
quindi il troncamento è paginazione e non un vicolo cieco. È la difesa più importante: senza,
un singolo `read_file` può saturare la finestra prima che qualunque altra cosa intervenga.

**Durante — potatura.** `pruneHistory()` ha due limiti, non equivalenti. Il **driver primario**
è il budget di token stimati (`maxHistoryTokens`): taglia i messaggi meno recenti finché la
cronologia rientra nel budget, senza mai lasciare orfana una risposta `tool` rispetto al suo
`tool_call`. Il conteggio a numero di messaggi (`maxHistoryMessages`, default 500) è solo una
**guardia estrema** — un conteggio fisso di messaggi non ha un rapporto stabile con la finestra
realmente occupata in un sistema agentico, dove un solo messaggio può portare l'output di un
tool da poche righe a decine di migliaia di caratteri. Contarlo come limite primario avrebbe
tagliato la cronologia troppo presto in un turno pieno di tool piccoli, o troppo tardi in un
turno con pochi tool enormi: da qui l'innalzamento del default da 40 a 500.

**Alla soglia — compressione.** `compressHistory()` sostituisce i messaggi vecchi con un
riassunto generato dal modello, salvandone traccia in memoria come `kind:'run'`.

La **stima** dei token è euristica (~3,5 caratteri/token) ma **calibrata a runtime** sul
`promptTokens` reale restituito dall'API, con media mobile. Include anche gli schemi dei tool,
che sono contesto inviato a ogni chiamata.

**`maxHistoryTokens` non è più solo un valore statico da tarare a mano.** All'avvio,
`discovery.ts` (`detectContextWindow`) interroga il server attivo per la finestra di contesto
**reale** del modello caricato — `/props` o `/slots` per llama-server/llama.cpp, `/api/show` per
Ollama, `/v1/models` (`context_length` / `max_model_len`) per OpenRouter e vLLM — e la usa al
posto del default. Il valore in `tsuka.config.json` (30000 su questo workspace) resta come
**fallback statico**, usato solo se il server non espone la propria finestra o non risponde entro
il timeout di rilevamento (1,5s). La sequenza di risoluzione è: finestra rilevata a runtime →
`maxHistoryTokens` di config → 65536 di default.

---

## 8. Il governo del costo e del tempo

Su un modello locale il collo di bottiglia non è il contesto, è **quanto il modello pensa**.
Misura reale su questo harness: 174 secondi per una chiamata, di cui ~3.200 token di solo
ragionamento per decidere di chiamare **un** tool. Il prompt processing era il 3,5% del tempo.

**`reasoning_effort`** (`none` / `low` / `medium` / `xhigh`) è quindi una proprietà di primo
livello, risolta da una **cascata a cinque livelli**:

```
pin globale  →  override del chiamante  →  personaggio  →  ruolo  →  default di config
```

- il **ruolo** porta il valore di base (progettare vale un ragionamento alto, tradurre no);
- il **personaggio** differenzia due agenti che condividono un ruolo, ed è l'unico livello
  raggiungibile da `/goal`, il cui DSL seleziona personaggi;
- il **pin globale** (`/effort`) vive in memoria di processo e **non** è persistente;
- il **tratto** è deliberatamente fuori dalla cascata: descrive il tono, non la profondità.

**Conseguenza da conoscere:** l'effort decide anche **quali tool il modello vede**, perché il
tier viene cercato alla chiave `modello@effort`. Cambiare effort può far comparire o sparire
dei tool; `/effort` lo annuncia esplicitamente.

**`/benchmark`** non misura un livello solo: **spazza** i quattro livelli, salva un profilo per
ciascuno e raccomanda **il più economico che raggiunge il tier più alto**. Registra anche
`avgCompletionTokens`, perché i token al secondo da soli non rivelano l'over-thinking: a effort
alto la velocità può essere identica e i token emessi cinque volte tanti.

**Due soffitti** nel provider: `FIRST_TOKEN_TIMEOUT_MS` (120s fisso, attesa del primo token) e
`MAX_GENERATION_MS` (120s di default, **mai azzerato** all'arrivo del primo token, configurabile
con `llmTimeoutMs` in `tsuka.config.json`) — più `max_tokens` a 8192 come tetto generoso, non come
parametro da tarare. Su questo workspace `llmTimeoutMs` è alzato a 999999 ms: non è un
disattivamento, è un tetto volutamente largo per tollerare modelli che ragionano a lungo prima di
rispondere, invece di interromperli a metà pensiero.

---

## 9. Le cinque modalità di esecuzione

| Modalità | Comando | Come sceglie gli agenti |
|---|---|---|
| **Chat** | — | un agente, il personaggio attivo |
| **Dibattito** | `/call` | più personaggi discutono lo stesso tema |
| **Team** | `/team <nome>` | formazione **fissa** da `teams/*.json` |
| **Goal** | `/goal <obiettivo>` | formazione **dinamica**: l'orchestrator sceglie in base all'obiettivo |
| **Sub-agente** | tool `spawn_agent` | il modello stesso delega un sottocompito |

`/team` ha quattro strategie in `src/cli/commands/strategies/`: `roundRobin`, `pipeline`,
`hybrid`, `orchestrated`.

`/goal` fa produrre all'orchestrator un piano in un mini-DSL:

```
AGENTE: @nome — Task
PARALLELO:
AGENTE: @nome1 — Task indipendente
AGENTE: @nome2 — Task indipendente
FINE PARALLELO
AGENTE: @nome3 — Task successivo
FINE
```

I blocchi paralleli girano in **workspace di staging isolati** (`parallelWorkspace.ts`) e
vengono fusi solo alla fine: due branch che scrivono lo stesso file con contenuto diverso
producono un **conflitto**, e quel file non viene copiato — la workspace principale resta
intatta.

**Ogni turno è un agente nuovo.** In `/team` e `/goal` ogni membro riceve un `Agent` costruito
da zero con system prompt + compito: nessuna cronologia ereditata. Lo stesso vale per
`spawn_agent`. È il motivo per cui il sistema regge su un modello con poca finestra — e il
motivo per cui il coordinamento deve passare dalla lavagna e dai file, non dalla cronologia.

---

## 10. Provider e modelli

Un solo client, l'**SDK ufficiale OpenAI**, puntato a basi diverse: Unsloth Studio
(`http://127.0.0.1:8888/v1`), Ollama (`:11434/v1`), OpenRouter. Tutti parlano
`/v1/chat/completions`.

All'avvio `discovery.ts` sonda i provider configurati per capire quale risponde e quale modello
è **già caricato in RAM**, così da non far ricaricare un GGUF diverso senza motivo.
`warmUpModel` forza il caricamento con una richiesta da un token.

Lo streaming separa due canali: `content` e `reasoning` (i blocchi `<think>` sono estratti da
`thinkParser.ts` e mostrati distintamente). **Il ragionamento non entra in cronologia**: costa
tempo, non finestra.

---

## 11. Sicurezza

- **Tre livelli di rischio** per tool (`SAFE` / `RESTRICTED` / `DANGEROUS`), dichiarati nello
  schema; i più rischiosi chiedono conferma.
- **Coda dei permessi**: le richieste sono serializzate, perché più agenti in parallelo che
  chiedono conferma insieme romperebbero l'interfaccia e produrrebbero risposte imprevedibili.
- `checkPermission` è **asincrona** — dettaglio architetturale rilevante: rende sostituibile il
  menu locale con qualunque altro canale di conferma.
- **Jail del workspace** sui tool di file, limiti di dimensione in byte, filtro delle variabili
  d'ambiente sensibili (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`) prima che finiscano nel contesto.
- `create_tool` esegue in sandbox `vm`, con blocklist, nessun `DANGEROUS`, nessuna
  sovrascrittura dei tool core e backup automatico.

---

## 12. Mappa dei moduli core

| File | Ruolo |
|---|---|
| `agent.ts` | ciclo ReAct, potatura, compressione, cascata dell'effort |
| `provider.ts` | client LLM, streaming, timeout, statistiche |
| `memory.ts` | memoria persistente: scope, kind, eviction, ricerca |
| `blackboard.ts` | stato condiviso del run |
| `contextBudget.ts` | tetto di contesto per risultato di tool |
| `effortControl.ts` | pin globale dell'effort e modalità di segnalazione |
| `modelProfile.ts` | profili misurati per modello e livello di effort |
| `benchmarkTests.ts` | test dichiarativi del benchmark, da `benchmarks/*.json` |
| `config.ts` | configurazione, migrazione legacy, workspace root |
| `discovery.ts` | scansione dei provider, del modello caricato e della finestra di contesto reale |
| `parallelWorkspace.ts` | staging isolato e fusione con rilevamento conflitti |
| `platform.ts` | astrazione della shell per OS |
| `thinkParser.ts` | estrazione dei blocchi di ragionamento |
| `logBuffer.ts` | buffering dell'output per branch paralleli |
| `messageQueue.ts` | messaggi punto-punto fra agenti |
| `agentEvents.ts` | contratto degli eventi verso l'interfaccia |
| `logSink.ts` | sink di logging iniettabile per classi fuori dal ciclo agentico |
| `apphome.ts` | app home vs workspace |
| `contextTracker.ts` | tracciamento del contesto |
| `types.ts` | tipi condivisi |

---

## 13. Comandi

**Sessione**: `/help` `/info` `/context` `/clear` `/reset` `/exit`
**Identità**: `/role` `/trait` `/character` `/rename-char` `/use`
**Multi-agente**: `/call` `/team` `/goal`
**Modello**: `/provider` `/models` `/benchmark` `/effort`
**Memoria**: `/memory` `/forget`
**Altro**: `/search-engine`

---

## 14. Limiti noti e debito tecnico

Onestà sullo stato, perché è ciò che serve per decidere dove andare.

- **Lo stato di sessione è globale.** `activeRole`, `activeTrait` e `activeCharacter` vivono in
  `tsuka.config.json`; il pin di effort è stato di processo. Con un solo utente e una sola
  sessione va bene; con due client concorrenti si sovrascrivono. È il vincolo principale per una
  interfaccia web multi-scheda, e non ha nulla a che vedere con la grafica.
- **8 file di test non registrati** in `run_tests.ts` (`test_browser`, `test_call`,
  `test_falco_live`, `test_ollama`, `test_safe_tools`, `test_search`, `test_search_debug`,
  `test_team`): alcuni richiedono un server o la rete, ma non tutti — e nel frattempo non
  proteggono da nulla.
- **L'effort non è propagato da tutti i chiamanti** a `loadSystemPrompt`/`notifyIfUnprofiled`:
  il default prudente `xhigh` rende la cosa sicura, ma è capacità non sfruttata.
- **Attenzione ai timestamp come chiave di cache.** La risoluzione dell'orologio su Windows
  (~15 ms) ha già prodotto due difetti reali in questo codice: l'ordinamento della memoria (che
  per questo usa un contatore logico) e l'invalidazione dei profili (che ora confronta il
  contenuto). Se scrivi una cache invalidata su `mtime`, aspettati lo stesso problema.

Lo stato aggiornato dei lavori è sempre in `TASKS.md`.

---

## 15. Da implementare

Lavoro specificato ma non ancora realizzato. Ogni voce è un task in `TASKS.md` con criteri di
accettazione e fuori scope; qui c'è il perché, non il come.

| | Voce | In una riga |
|---|---|---|
| **DA IMPLEMENTARE** | **T8.15** — divergenza contro la cascata | Con un pin attivo l'effort effettivo *è* il pin, quindi la segnalazione non compare mai proprio quando serve: va confrontato il pin con ciò che la cascata avrebbe prodotto. |
| **DA IMPLEMENTARE** | **T8.16** — catalogo selezionabile | Descrizioni da ~85 caratteri su cui `/goal` sceglie fra 28 personaggi; più ruoli hanno due personaggi e nessuna descrizione dice cosa li separa. |
| **DA IMPLEMENTARE** | **T8.17** — suggeritore di modalità | Proporre chat / `/team` / `/goal` in base alla richiesta, con classificazione a `reasoning_effort: none` per non aggiungere minuti a ogni messaggio. |
| **DA DECIDERE** | Stato di sessione globale | `activeRole`/`activeTrait`/`activeCharacter` in configurazione, pin di effort di processo: con due client concorrenti si sovrascrivono. È una decisione, non un bug. |
| **DA IMPLEMENTARE** | Rifiniture | Propagare l'effort ai chiamanti mancanti; registrare gli 8 test orfani; impostare i parametri di campionamento. |

## 16. Verso una nuova interfaccia — IN STANDBY

**La decisione è sospesa: per ora l'interfaccia resta la CLI.** L'analisi è archiviata qui
perché quando la si riprenderà sia già fatta.

Tre cose renderebbero la migrazione più facile del previsto, e due sono già nel codice:
`checkPermission` è **già asincrona** (sostituire il menu locale con un altro canale è una
sostituzione dietro un confine esistente, non una riarchitettura); gli eventi ci sono già
(`onChunk`, `onStats`, `onEvent`, `AbortSignal`); e `logBuffer.ts` sa già intercettare
`console.log`, quindi può fare da ponte.

Due vincoli da ricordare: il browser **non può dare a Node un percorso locale reale**, quindi la
selezione della cartella deve avvenire lato server; e un server con filesystem e
`execute_command` esposti è una superficie RCE, da legare a `127.0.0.1` con token.

Ordine sensato, se e quando: (1) estrarre una sessione headless — la CLI ne diventa il primo
client, e se continua a funzionare identica l'estrazione è corretta; (2) chiudere i `console.*`;
(3) transport su localhost; (4) frontend; (5) sessione e selettore di cartella.

**La conclusione che conta:** non si sceglie fra web e TUI, si sceglie di fare il *transport*.
Fatto quello, ogni client parla lo stesso protocollo e la CLI resta viva. La fase 1 vale a
prescindere: rende il core testabile senza terminale, e serve anche restando sulla CLI.
