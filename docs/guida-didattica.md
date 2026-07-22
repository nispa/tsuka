# Guida didattica — Come si costruisce un harness agentico 🎓

> Questo documento racconta **come si arriva** a costruire un harness multi-agente come TSUKA,
> quali componenti sono **comuni a tutti** gli harness (Claude Code, opencode, aider, …) e quali
> scelte sono invece **peculiari** di questo progetto. Ogni concetto rimanda al file sorgente
> che lo implementa: il codice è il vero libro di testo, questo è l'indice ragionato.

---

## 1. Cos'è un harness agentico

Un LLM, da solo, è una funzione: testo in ingresso → testo in uscita. Non può leggere un file,
eseguire un comando, ricordare qualcosa tra una sessione e l'altra. Un **harness** (letteralmente
"imbracatura") è il programma che avvolge il modello e gli dà mani, occhi e memoria:

```
┌────────────────────────── HARNESS ──────────────────────────┐
│                                                             │
│  REPL ──► Ciclo agentico ──► Provider LLM (HTTP streaming)  │
│   ▲            │                                            │
│   │            ▼                                            │
│  UI ◄── Tool Registry ──► Permessi ──► Esecuzione (fs, sh)  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

L'intuizione chiave, che vale per ogni harness esistente: **il modello non esegue nulla**.
Il modello *dichiara* di voler usare un tool (function calling); è l'harness che esegue,
raccoglie l'output e glielo rimanda come nuovo messaggio. L'intelligenza è del modello,
il potere è dell'harness — ed è per questo che i permessi vivono nell'harness (§5).

---

## 2. Il percorso di costruzione, tappa per tappa

Questo è l'ordine in cui TSUKA è effettivamente cresciuto, ed è un buon ordine per chiunque
voglia costruirne uno: ogni tappa funziona da sola ed è la base della successiva.

### Tappa 1 — Una chat REPL con streaming
*File: `src/core/provider.ts`, `src/cli/index.ts`, `src/cli/input.ts`*

Si parte da un ciclo `while (true)` che legge una riga e chiama un endpoint
**OpenAI-compatible** (`/v1/chat/completions`). Questa compatibilità è la prima decisione
architetturale gratuita ma potentissima: Ollama, OpenRouter, Unsloth Studio, LM Studio e
decine di altri server parlano lo stesso dialetto, quindi un solo `LLMProvider` li copre tutti.
Lo streaming (Server-Sent Events, gestito dall'SDK `openai`) non è un lusso estetico: senza,
l'utente fissa un cursore fermo per 30 secondi.

### Tappa 2 — Il ciclo agentico (function calling)
*File: `src/core/agent.ts`*

È il cuore di qualsiasi harness, e sta in ~40 righe: un loop che (1) invia la cronologia con
l'elenco dei tool, (2) se il modello risponde con `tool_calls` li esegue tutti, (3) appende i
risultati come messaggi `role: "tool"` e (4) ripete, finché il modello risponde con solo testo.
Due guardie imparate sul campo:
- **`MAX_TOOL_ROUNDS`**: un modello piccolo può entrare in loop di tool infiniti e bruciare
  token per sempre. Serve un limite duro con messaggio esplicito.
- **Coerenza `tool_call`/`tool`**: l'API rifiuta cronologie dove un `tool_calls` resta senza
  risposta o viceversa. Ogni manipolazione della cronologia (pruning!) deve rispettarlo.

### Tappa 3 — Tool registry con schemi dichiarativi
*File: `src/tools/registry.ts`, `src/tools/index.ts`, `tools_schemas/*.json`*

I tool sono la parte che cresce di più nel tempo, quindi conviene renderli **plugin**:
l'implementazione è un file in `src/tools/impl/` scoperto automaticamente all'avvio
(auto-discovery con `import()` dinamico), mentre descrizione e parametri vivono in JSON
esterni (`tools_schemas/`). Separare schema e codice permette di ritoccare le descrizioni
(che sono, di fatto, *prompt engineering*) senza ricompilare. Prima di eseguire, gli argomenti
del modello vengono validati contro lo schema: i modelli piccoli sbagliano spesso i tipi.

### Tappa 4 — Permessi: l'utente nel loop
*File: `src/safety/permissions.ts`*

Ogni tool dichiara un livello di rischio: `SAFE` (esegue e basta), `RESTRICTED` (chiede
conferma), `DANGEROUS` (chiede sempre, es. `execute_command`). È la stessa filosofia
"user-in-the-loop" di Claude Code. Complementi: la **jail del workspace** (i file tool possono
essere confinati in una root configurata), i **limiti di I/O** (file max 5MB, output comandi
troncato) e il **filtro delle env var sensibili** (mai far arrivare `*_API_KEY` nel contesto
del modello: finirebbe nei log del provider).

### Tappa 5 — Gestione del contesto
*File: `src/core/agent.ts` (pruneHistory), `src/core/thinkParser.ts`, `src/core/memory.ts`*

La context window è la risorsa scarsa. Tre meccanismi:
- **Pruning a doppio criterio**: massimo numero di messaggi *e* budget di token stimati
  (~3,5 caratteri/token) — il secondo protegge dal caso "3 messaggi ma uno contiene un file
  da 2MB". Il taglio non lascia mai messaggi `tool` orfani (vedi Tappa 2).
- **Reasoning fuori dalla cronologia**: i blocchi `<think>` dei modelli reasoning vengono
  separati in streaming (`ThinkTagParser`) e mostrati all'utente ma **mai rimandati al
  modello**: sarebbero token sprecati a ogni giro successivo.
- **Memoria persistente**: un archivio JSON di fatti (`memory/memory.json`) iniettato in forma
  compatta nel system prompt e interrogabile con un tool (`recall_memory`). Sopravvive al
  riavvio: è la differenza tra una sessione e un collaboratore.

### Tappa 6 — La UI: streaming, status, markdown (senza framework TUI)
*File: `src/cli/stream.ts`, `src/cli/statusline.ts`, `src/cli/markdown.ts`*

Vincolo autoimposto: niente Ink/React, solo CommonJS + chalk + sequenze ANSI. La strategia è
**stream grezzo live → erase → repaint**: durante la generazione si stampa il testo com'è;
a fine risposta si cancella la zona streammata (`\x1b[nF\x1b[0J`) e la si ridipinge come
pannello markdown renderizzato. Il markdown "live" su input incompleto è instabile, il repaint
finale no. Tutto l'ANSI è condizionato a `isTTY`: in pipe l'output resta testo pulito — regola
d'oro per qualunque CLI.

### Tappa 7 — Multi-agente: personas e collaborazione
*File: `roles/`, `traits/`, `characters/`, `teams/`, `src/cli/commands/{call,team}.ts`*

Un "agente" qui è solo un system prompt assemblato da pezzi JSON dichiarativi:
**ruolo** (competenze + tool consentiti) × **tratto** (personalità) × **personaggio**
(preset nominato). Sopra si costruiscono i workflow: `/call` (conferenza-dibattito tra
personaggi) e `/team` (round iterativi con cronologia condivisa). La lezione più importante
del `/team`: non fidarsi mai della *sensazione* di completamento — serve un **protocollo
deterministico** (ogni membro chiude con `STATO: COMPLETATO` o `STATO: DA_CONTINUARE`,
rilevato via regex ancorata a inizio riga) per decidere se fermarsi.

### Tappa 8 — Adattività al modello: tier misurato, non indovinato
*File: `src/core/modelProfile.ts`, `getModelTier` in `src/tools/registry.ts`*

Un harness per modelli locali ha un problema che Claude Code non ha: i modelli variano da 1B
a 70B e un 9B sommerso da 20 tool sbaglia tutto. Primo approccio: euristica sul nome
("9b" → small → meno tool). Ma le euristiche mentono: il **capability fingerprinting**
(`/benchmark`) esegue 3 test oggettivi (instruction following, JSON, function calling) e
salva un profilo *misurato* — un caso reale: un 9B stimato "small" dall'euristica è risultato
"large" ai test. Regola generale: **misura, non indovinare**.

### Tappa 9 — Self-extension: l'agente scrive i propri tool
*File: `src/tools/impl/createTool.ts`*

Il passo più "meta": un tool (`create_tool`) con cui l'agente genera nuovi tool JavaScript,
validati in una sandbox `vm` con blocklist, mai a livello `DANGEROUS`, mai in sovrascrittura
di tool core, con backup automatico e registrazione a caldo. È anche il punto più delicato
del progetto: il confine tra "l'agente si estende" e "l'agente fa quello che vuole" è tutto
nelle validazioni.

### Tappa 10 — Distribuzione: home vs workspace
*File: `src/core/apphome.ts`, campo `bin` in `package.json`*

Finché si lancia con `npm run dev` dalla cartella del progetto, tutto può essere risolto da
`process.cwd()`. Ma un comando globale (`tsuka` da qualsiasi cartella) impone la distinzione
finale: la **home dell'app** (asset, config, memoria — risolta da `__dirname` o `TSUKA_HOME`)
è *dove l'harness vive*; il **workspace** (`cwd`) è *dove l'agente lavora*. Confonderle
significa config duplicati e memoria persa a ogni cartella.

---

## 3. Caratteristiche comuni vs peculiari

### Comuni a (quasi) tutti gli harness — se ne costruisci uno, ti servono
| Componente | In TSUKA | Nota |
|---|---|---|
| Ciclo agentico con function calling | `src/core/agent.ts` | Il pattern è identico ovunque |
| Astrazione provider OpenAI-compatible | `src/core/provider.ts` | Un client, molti server |
| Tool con schema JSON + validazione | `src/tools/` | Lo schema È il prompt del tool |
| Permessi user-in-the-loop a livelli | `src/safety/permissions.ts` | SAFE/RESTRICTED/DANGEROUS |
| Streaming + UI reattiva in terminale | `src/cli/stream.ts` | Feedback continuo o l'utente pensa sia morto |
| Gestione context window (pruning) | `agent.pruneHistory()` | Doppio criterio: messaggi + token |
| REPL con comandi slash | `src/cli/index.ts` | Dispatch map, comandi in moduli |
| Config dichiarativa esterna al codice | `*.json` in root | Comportamento modificabile senza ricompilare |

### Peculiari di TSUKA — le scelte che lo distinguono
| Caratteristica | Perché è particolare |
|---|---|
| **Capability fingerprinting** (`/benchmark`) | Il tier dei tool è *misurato* con test oggettivi, non stimato dal nome del modello |
| **Tier gating dei tool** | I modelli piccoli vedono solo i tool che possono gestire: meno confusione, meno errori |
| **Self-authoring** (`create_tool`) | L'agente estende l'harness a runtime, in sandbox e con versioning |
| **Personas componibili** (ruolo × tratto × personaggio) | Identità degli agenti interamente dichiarativa in JSON |
| **Protocollo STATO nei team** | Completamento dei workflow deciso da un marker deterministico, non dalla prosa |
| **Memoria condivisa cross-agente** | Tutti gli agenti (chat, /call, /team) leggono/scrivono lo stesso archivio persistente |
| **UI streaming senza framework TUI** | Erase/repaint ANSI a mano, vincolo CommonJS: dimostra che non serve Ink |
| **Windows-first, cross-platform** | PowerShell nativo primario, `/bin/sh` POSIX come porting (`src/core/platform.ts`) — l'opposto della norma |

---

## 4. Trappole reali incontrate (e perché ti capiteranno anche a te)

Tutte documentate con data e fix in [`HISTORY.md`](../HISTORY.md) — qui le più istruttive:

1. **`String.replace` interpreta `$` nel rimpiazzo** (`$&`, `` $` ``…): un tool `edit_file`
   ingenuo corrompe silenziosamente i file. Fix: replacer function `() => replacement`.
2. **`import()` traspilato in CommonJS non accetta URL `file://`**: l'auto-discovery
   funzionava in dev (tsx) ed era rotto nella build compilata — scoperto solo creando il
   comando globale. Morale: testa *entrambe* le modalità di esecuzione.
3. **Statistiche token contando i chunk di stream**: i tok/s erano fantasiosi. I token veri
   arrivano con `stream_options: { include_usage: true }`.
4. **Pruning che sposta gli indici**: estrarre "i messaggi nuovi" con `slice(lunghezzaPrima)`
   si rompe appena il pruning rimuove messaggi a metà run. Serve un riferimento a oggetto,
   non un indice.
5. **Entità HTML nel renderer markdown**: `marked` produce HTML (`po'` → `po&#39;`);
   togliere i tag non basta, bisogna decodificare le entità.
6. **Env var sensibili nel contesto**: un tool "innocuo" che elenca le variabili d'ambiente
   è un canale di esfiltrazione delle API key verso il provider del modello.
7. **Il modello che "si blocca"** spesso non è bloccato: è in coda su un server locale che
   serve una richiesta alla volta. Prima di debuggare l'harness, guarda il server — e dai
   comunque all'utente un tasto per interrompere (Esc + `AbortController`).

---

## 5. Da dove partire per rifarlo da zero

Percorso minimo consigliato (~ordine delle tappe di §2):

1. REPL + provider streaming (tappe 1): già utile come chat.
2. Ciclo agentico + 3 tool (`read_file`, `write_file`, `list_dir`) + permessi (tappe 2–4):
   a questo punto hai *un harness*, tutto il resto è raffinamento.
3. Pruning e memoria (tappa 5), poi UI (tappa 6).
4. Multi-agente e adattività (tappe 7–8) solo quando il singolo agente è solido.
5. Self-extension e distribuzione (tappe 9–10) per ultime: dipendono da tutto il resto.

Documentazione di approfondimento: [architettura](architecture.md) ·
[multi-agente](multi-agent.md) · [sicurezza](security.md) · [casi d'uso](use-cases.md).
