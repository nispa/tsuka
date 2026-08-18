[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Ollama](https://img.shields.io/badge/Ollama-nativo-8A2BE2?logo=ollama)](https://ollama.com/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-pronto-FF6B35?logo=openai)](https://openrouter.ai/)
[![Licenza](https://img.shields.io/badge/Licenza-MIT-green)](LICENSE)
[![PR benvenute](https://img.shields.io/badge/PR-benvenute-brightgreen)](https://github.com/tuo-utente/tsuka/pulls)

<br />
<div align="center">

```
████████  ██████  ██    ██  ██    ██    ████
   ██    ██       ██    ██  ██   ██    ██  ██
   ██     ██████  ██    ██  ██████    ████████
   ██          ██ ██    ██  ██   ██   ██    ██
   ██    ██████    ██████   ██    ██  ██    ██
```

  <p><strong>TypeScript Unified Kit for Agents</strong></p>
  <p>Framework Multi-Agent CLI per Windows, Linux & macOS</p>
  <p>Leggi in <a href="README.md">🇬🇧 English</a></p>
</div>

**TSUKA** è un framework multi-agente didattico e ultra-leggero, e una CLI agentica, interamente scritto in TypeScript. Collegati a modelli locali via **Ollama**, **llama.cpp/llama-server** o **Unsloth Studio** (qualsiasi endpoint OpenAI-compatible), oppure a provider cloud via **OpenRouter**. Nato per **Windows + PowerShell**, supporta sperimentalmente anche **Linux** e **macOS**.

> **Il nome**: 柄 (*tsuka*) è l'impugnatura della katana — la presa a cui ogni lama si attacca. I modelli sono le lame; TSUKA è ciò che ti permette di brandirle.
>
> **Perché?** La maggior parte dei framework agentici è Python/Linux-only. TSUKA porta la potenza agentica sulla riga di comando Windows senza sacrificare la portabilità.

## ✨ Punti salienti

| Caratteristica | Descrizione |
|---------------|-------------|
| 🖥️ **TUI Interattiva v0.5.1** | Dashboard a schermo intero (`tsuka --tui`), double-buffering zero-flicker, supporto mouse SGR 1006, file viewer modal, input multilinea, ricerca live dei tool e telemetria di inferenza in tempo reale |
| 📡 **Telemetria di Inferenza in Tempo Reale** | Widget nella sidebar che monitora prefill (ingestione contesto KV Cache), TTFT (Time To First Token), velocità di decode (tok/s), confidenza del modello e logits candidati latenti |
| 💾 **Esportazione Sessione Markdown** | Comandi `/export [file]` e `/save` sia in CLI sia in TUI per salvare archivi di sessione completi con CoT collassabile ed esiti tool |
| 🧩 **Tool a caldo** | Aggiungi un file `.ts` in `src/tools/impl/` — scoperto automaticamente all'avvio |
| 📡 **Auto-discovery dei server** | All'avvio scansiona i server LLM locali (Ollama, Unsloth, …) e si aggancia a quello vivo — preferendo il modello già caricato in RAM |
| 🎭 **Sistema personaggi** | Ruoli (competenze) × Tratti (personalità) × Personaggi (agenti nominati) in JSON |
| 📊 **Capability Fingerprinting** | `/benchmark` misura oggettivamente le capacità del modello — tier *misurato, non indovinato* |
| 🛠️ **Auto-creazione tool** | Gli agenti scrivono nuovi tool JavaScript via `create_tool` — sandbox + registrazione a caldo |
| 🧠 **Memoria condivisa persistente** | I fatti sopravvivono ai riavvii, condivisi tra tutti gli agenti e le sessioni |
| 🛡️ **Permessi a 3 livelli** | SAFE / RESTRICTED / DANGEROUS — l'utente ha sempre il controllo |
| 🖥️ **Cross-platform** | Windows (PowerShell) primario; Linux/macOS (`/bin/sh`) sperimentale |
| 🤝 **Workflow multi-agente** | Dibattiti (`/call`), team collaborativi (`/team`) con 4 strategie e orchestratore dinamico di obiettivi (`/goal`) |
| 🔁 **Loop verifica → correzione** | Criteri di accettazione oggettivi (exit code, file, JSON valido) guidano i ritentativi — chi esegue non è l'unico giudice |
| ⏸️ **Generazione interrompibile** | `Esc` (o `Ctrl+X`) annulla la generazione in corso; il ragionamento parziale viene salvato, non perso |
| 🧠 **Esecuzione context-aware** | Reasoning live, statistiche per-agente token/tempo (output/context/totale), barra di contesto doppia (stimata + picco reale dall'LLM), condensazione automatica della cronologia tra un turno e l'altro |

## 📋 Indice

- [Punti salienti](#-punti-salienti)
- [Guida rapida in 60 secondi](#-guida-rapida-in-60-secondi)
- [Installazione e setup](#-installazione-e-setup)
- [TUI interattiva a schermo intero](#-tui-interattiva-a-schermo-intero-dashboard)
- [Comandi slash](#-comandi-slash-repl)
- [Workflow multi-agente](#-workflow-multi-agente)
- [Catalogo dei tool (27 tool)](#-catalogo-dei-tool-27-tool)
- [Sicurezza](#-sicurezza)
- [Funzionalità chiave](#-funzionalità-chiave)
- [Architettura](#-architettura)
- [Test](#-validazione-autonoma)
- [Documentazione](#-documentazione)
- [Roadmap](#-roadmap)
- [Contribuire](#-contribuire)
- [Licenza](#-licenza)

## ⚡ Guida Rapida in 60 Secondi

```bash
# 1. Clona, installa e builda (non ancora pubblicato su npm)
git clone https://github.com/nispa/tsuka.git
cd tsuka
npm install
npm run build
npm link        # crea il comando globale `tsuka`

# 2. Inizializza il workspace con il preset core degli agenti
tsuka init --preset core

# 3. Avvia in modalità CLI REPL
tsuka

# 4. Oppure avvia la Dashboard Interattiva a Schermo Intero (TUI)
npm run tui
# oppure: tsuka --tui
```
*Assicurati che sia avviato Unsloth Studio, llama-server o Ollama, oppure configura la tua `OPENROUTER_API_KEY` nel file `.env`.*

## 🚀 Installazione e Setup

### Prerequisiti

```powershell
# 1. Installa Ollama
#    https://ollama.com/
ollama serve

# 2. Scarica un modello
ollama pull qwen2.5-coder:7b
```

### Modalità Sviluppo

```powershell
# 1. Clona e installa
git clone https://github.com/tuo-utente/tsuka.git
cd tsuka
npm install

# 2. Avvia in modalità sviluppo
npm run dev

# 3. (Opzionale) Fai il benchmark del modello per la migliore selezione tool
/benchmark

# 4. Inizia a chattare o:
/call @tuvok, @deanna_troi
```

### Build di Produzione

```powershell
npm run build
npm start
```

### Installazione come Comando Globale (`tsuka`)

Per lanciare TSUKA da qualsiasi finestra PowerShell senza `npm run dev`:

```powershell
npm run build
npm link        # crea il comando globale `tsuka` (shim nel PATH)
tsuka           # avvialo da qualunque cartella
```

Dopo una modifica ai sorgenti, aggiorna il comando globale con `npm run build`. Per disinstallare: `npm unlink -g tsuka`.

### Inizializzare una Workspace (`tsuka init`)

```powershell
tsuka init                          # interattivo: chiede quale preset
tsuka init --preset core            # roster essenziale (14 personaggi, 4 team)
tsuka init --preset full            # tutti i ruoli, tratti, personaggi e team
tsuka init --pack osint,devops      # aggiunge pack extra sopra il preset
tsuka init --force                  # sovrascrive una `.tsuka/` esistente
```

Pack disponibili in [`presets/packs/`](presets/packs/): `osint`, `content`, `devops`, `security`, `demo` — l'ultimo raccoglie stili comunicativi volutamente estremi come esempio didattico (un votante accondiscendente rende l'unanimità priva di significato).

`tsuka init` crea una cartella `.tsuka/` nella directory corrente con `memory/`, `workflow_logs/`, `output/` e le copie di `roles/`, `traits/`, `characters/` e `teams/` scelti, poi sonda i server LLM locali per scrivere una configurazione di partenza.

**Home dell'app vs workspace** ([`src/core/apphome.ts`](src/core/apphome.ts)): le risorse sono risolte in modo gerarchico.

1. Se nella cartella da cui lanci `tsuka` esiste `.tsuka/<risorsa>`, vince quella — così un progetto inizializzato con `tsuka init` ha il suo roster e la sua memoria.
2. Altrimenti si ricade sulla **home dell'app**: la cartella di installazione, oppure `TSUKA_HOME` se quella variabile d'ambiente è impostata.

Il *workspace* è sempre la cartella da cui lanci `tsuka`: è lì che operano i file tool degli agenti (read/write/edit/grep) con i path relativi. Puoi quindi fare `cd` in qualsiasi progetto e far lavorare gli agenti su di esso — con roster e memoria condivisi di default, oppure locali al progetto dopo `tsuka init`.

## 🖥️ TUI Interattiva a Schermo Intero (Dashboard)

Oltre alla modalità classica a riga di comando REPL, TSUKA include un'interfaccia terminale grafica completa (TUI):

```bash
npm run tui
# oppure con il binario globale:
tsuka --tui
```

### ✨ Funzionalità della Dashboard TUI:
* **Double-Buffering Differenziale a Zero-Sfarfallio**: Aggiornamenti a 0ms di latenza visiva, box drawing ANSI sicuro e protezione contro l'auto-wrapping del terminale.
* **Telemetria di Inferenza in Tempo Reale (`InferenceTelemetryWidget`)**: Elimina l'attesa cieca durante l'inferenza locale monitorando:
  * `⚡ PREFILL`: Ingestione del prompt nella KV Cache; il conteggio token è marcato come stima (`~N tok est.`) finché il backend non comunica la dimensione esatta.
  * `🌊 DECODE`: Velocità di generazione misurata sulla sola finestra di decode (prefill escluso) e **TTFT** (*Time to First Token*) in millisecondi.
  * `📊 Stato Latente & Logits`: Barra di confidenza `[████████░░] 94%` e top candidati — mostrati **solo** se il backend restituisce davvero i logprobs.
* **Workspace File Explorer & Modale di Anteprima Codice**:
  * Albero dei file in tempo reale con icone per estensione (`📁`, `🟦 TS`, `🟨 JS`, `⚙️ JSON`, `📝 MD`, `🧪 Test`, `🔒 Secrets`).
  * Esplorazione dell'albero con **`→`** per entrare in una cartella e **`←`** (o la riga `.. (up)`) per tornare indietro; il titolo del pannello mostra il percorso corrente e la navigazione non può uscire dalla workspace jail.
  * Premendo **`Enter`** (o doppio clic) si apre la cartella selezionata, oppure — su un file — il **Workspace File Viewer Modal** con numeri di riga formattati, scroll fluido e scorciatoia per copiare/incollare.
  * Premendo **`i`** o **`Space`** si incolla nel prompt il percorso selezionato completo di cartelle (es. `src/tui/app.ts`).
* **Input Multi-linea & Preservazione Incollamento**:
  * **`Shift+Enter`** / **`Ctrl+J`** / **`Alt+Enter`** inserisce una nuova riga senza inviare prematuramente.
  * Box di input ad altezza elastica dinamica che si espande da 3 a 6 righe in base al contenuto.
  * Navigazione cursore 2D su più righe e supporto all'incollamento di blocchi di codice dal clipboard.
* **Filtro di Ricerca Tool Interattivo**:
  * Nella scheda **`F2`** Tools, digitando direttamente o premendo `/` è possibile filtrare in tempo reale tutti i 27 tool nativi, i tier di sicurezza (`SAFE`, `RESTRICTED`, `DANGEROUS`) e le esecuzioni passate.
* **Esportazione Sessione in Markdown**:
  * Digitando `/export` o `/save` l'intera sessione (chat, ragionamenti e chiamate tool) viene esportata in `exports/session-<timestamp>.md`.
* **Motore di Layout Configurabile (`F7` / `/layout`)**:
  * Selezione dinamica dei preset (*Default Quadrant*, *Wide Chat*, *Sidebar a Destra*, *Zen Focus*) e 5 palette colore curate (*Cyan*, *Neon*, *Amber*, *Matrix*, *Minimal*).
* **Parità Completa dei Comandi Slash nella TUI**:
  * `/goal <obiettivo>`: Esegue workflow dell'orchestratore multi-agente autonomo direttamente in chat.
  * `/team <team> "<task>"`: Esegue pipeline di team collaborativi multi-agente.
  * `/call @agente1 @agente2 "<argomento>"`: Tavola rotonda e dibattito multi-agente in conferenza.
  * `/runs` e `/blackboard`: Ispezione dei log dei workflow recenti e delle note condivise sulla lavagna di sessione.
  * `/provider`, `/models`, `/benchmark`: Cambio rapido del server LLM, selettore modelli e suite di capability fingerprinting.
  * `/copy`: Copia l'ultima risposta dell'assistente direttamente negli appunti di sistema.
* **Supporto Completo del Mouse (SGR 1006)**:
  * Scorrimento con rotellina del mouse su Chat, File Explorer e Tools.
  * Click sulle tab (`Chat` / `Tools`), click sui file per incollare il nome nel prompt, click sul box di input per mettere a fuoco.
* **Dialoghi Modali per il Ciclo di Vita**:
  * **Rinnovo Timeout**: Quando il modello riflette a lungo (es. 2 min), un modale ti chiede se concedere altro tempo (+2m, illimitato, interrompi).
  * **Estensione Round Tool**: Quando si raggiunge il limite di esecuzioni consecutive dei tool, un modale ti permette di aggiungere altri cicli (+15 round, concludi, ferma).
* **Auto-Calibrazione del Contesto del Modello**: Rileva automaticamente i limiti del context window via `detectContextWindow` all'avvio e ad ogni cambio modello (`F6` / `/models`).
* **Telemetria di Inferenza Misurata**: TTFT, velocità di decode (prefill escluso dalla finestra) e velocità di ingestione del prompt sono misurati dentro il loop di streaming, mai sintetizzati. Confidenza del token e candidati alternativi compaiono solo se il backend restituisce davvero i logprobs (`"inferenceLogprobs": true` in `tsuka.config.json`, disattivo di default); se il backend rifiuta il parametro, la degradazione viene loggata e la richiesta ripetuta senza.
* **Tasti Funzione & Guida Rapida**:
  * `F1`: Vista Chat · `F2`: Vista Tools · `F3`: Selettore Agenti · `F4`: Selettore Team · `F5`: Ispettore Memoria · `F6`: Cambio Modello · `F12`: Elenco Comandi REPL.
  * `?` apre la guida solo quando il focus non è sul prompt: nel messaggio il punto interrogativo resta un carattere digitabile.

## 🛠 Comandi Slash REPL

| Comando | Descrizione |
|---------|-------------|
| `/goal <obiettivo>` | Orchestratore dinamico di obiettivi — seleziona agenti, assegna task ed esegue |
| `/team [nome]` | Avvia un workflow di team o una pipeline predefinita |
| `/call [@agenti...]` | Avvia un dibattito/conferenza multi-agente |
| `/models [modello]` | Elenca e seleziona i modelli disponibili sul server |
| `/provider [nome]` | Cambia tra Ollama, Unsloth e OpenRouter |
| `/effort [livello]` | Gestisce lo sforzo di ragionamento (`none`\|`low`\|`medium`\|`xhigh`\|`auto`\|`ask`) |
| `/benchmark [modello\|all]` | Misura le capacità del modello (tier e tok/s) |
| `/agent [nome]` | Mostra o seleziona l'agente attivo |
| `/tools [query]` | Mostra e filtra i tool abilitati per ruolo, tier ed effort |
| `/export [file]` | Esporta la sessione completa, i ragionamenti e i log dei tool in Markdown (alias: `/save`) |
| `/stop` | Interrompe la generazione, il reasoning o l'esecuzione tool in corso (alias: `Esc` / `Ctrl+X`) |
| `/context` | Mostra il consumo di token della cronologia rispetto al budget (e da dove viene il limite) |
| `/memory [clear\|<id>]` | Gestisce, legge o svuota i ricordi persistenti |
| `/blackboard` | Mostra note e stato dell'ultimo workflow/goal |
| `/runs` | Mostra storico e report delle esecuzioni recenti |
| `/continue [traccia]` | Forza la ripresa di un ragionamento interrotto invece di ripartire da capo |
| `/info` | Mostra informazioni sessione (provider, modello, agente) |
| `/reset` | Resetta cronologia + approvazioni sicurezza |
| `/search-engine` | Cambia provider di ricerca (DuckDuckGo / Google / Tavily) |
| `/help` | Mostra l'elenco dei comandi disponibili |
| `/clear` · `/exit` | Pulisce il terminale · Esci |

**Tasti durante la generazione**: `Esc` (o `Ctrl+X`) annulla il turno in corso; `Ctrl+C` esce.

## 👥 Workflow Multi-Agente

### Orchestratore Dinamico di Obiettivi (`/goal`)

Il comando `/goal` assembla dinamicamente un team scegliendo tra **tutti i personaggi disponibili** per portare a termine un obiettivo:

```powershell
/goal Crea una sceneggiatura e per ogni scena genera il prompt Krea2. Salva in cr.txt
```

1. **Fase di pianificazione**: l'LLM orchestratore analizza l'obiettivo, seleziona gli agenti più adatti e assegna i task — opzionalmente con blocchi `PARALLELO` per i sotto-task indipendenti. Gli agenti sono presentati con firme sintetiche generate automaticamente e possono essere scelti per *mestiere*, non solo per nome: il prompt di pianificazione resta corto.
2. **Fase di esecuzione**: tutti i passi pianificati vengono eseguiti in ordine — incluso il supervisore. Le istruzioni di ogni agente gli dicono esplicitamente di **ispezionare i file del workspace** creati dagli agenti precedenti. Un verdetto negativo dell'overseer finale rimette in coda lo step fallito per un ciclo di rilavorazione, invece di chiudere e basta.
3. **Gestione del contesto**: dopo ogni turno agente, i messaggi lunghi dell'assistente vengono condensati (mantenendo un riassunto significativo di 1500 caratteri, non una riga) e un fatto viene salvato nella memoria persistente. Una **barra di contesto doppia** mostra il contesto stimato prima che l'agente parta e il **picco reale di token di prompt** misurato dalla risposta dell'LLM dopo il completamento.
4. **Riepilogo statistiche**: alla fine, un dettaglio per-agente con token di output, token di contesto, token totali, tempo e velocità:

```
📊 RIEPILOGO STATS AGENTI
  Agente             Out tok    Ctx tok   Tot tok    Tempo    Velocità
  Doctor             1234      15032     16266     12.3s   100.3 tok/s
  Krea Master            892      16780     17672      8.1s   110.1 tok/s
  Pike                   456      17500     17956      4.2s   108.6 tok/s
  TOTALE                2582      17500     51894     24.6s
```

- **Out tok**: token di output (completion) cumulativi su tutti i round LLM del turno dell'agente
- **Ctx tok**: token di prompt di picco (dimensione finestra di contesto) misurati dall'ultimo round LLM
- **Tot tok**: totale stimato (ctx + out) per quell'agente

Il planner può anche emettere blocchi `PARALLELO` per i sotto-task indipendenti. Vengono eseguiti concorrentemente via `Promise.all` solo se `parallelExecutionEnabled` è attivato in `tsuka.config.json` — il **default è `false`**, quindi su una singola GPU tutto viene eseguito in sequenza anche dentro un blocco `PARALLELO`, evitando contesa di VRAM tra agenti che condividono lo stesso modello locale. Quando il parallelismo *è* attivo, ogni branch lavora in una workspace di staging isolata (`workspace/parallel-<n>/`) unita a fine blocco: due branch che scrivono lo stesso path con contenuto diverso producono un conflitto segnalato, mai una sovrascrittura silenziosa.

### Team Collaborativi (`/team`)

Fa collaborare attivamente un gruppo organizzato di agenti su un compito, eseguendo tool di scrittura ed esecuzione:

```powershell
/team cyber_audit                        # Seleziona un team
# Poi: "Blinda la porta 22 su questo server"
```

Il campo `mode` del JSON del team seleziona la strategia ([`src/cli/commands/strategies/`](src/cli/commands/strategies/)):

| Modalità | Comportamento |
|----------|---------------|
| `round-robin` | Ogni membro lavora a turno, round dopo round, finché il compito non è dichiarato risolto |
| `pipeline` | Passata unica sui membri come catena di montaggio: la stazione 1 riceve il compito, ognuna delle successive rifinisce ciò che riceve (vedi sotto) |
| `orchestrated` | Un `orchestrator` designato decide chi lavora al turno successivo (ripiega su round-robin se la sua risposta non è parseabile) |
| *hybrid* | Non è una modalità a sé: impostare `discussionRounds > 0` inserisce un round di discussione + voto dopo ogni round della strategia scelta |

- **Round iterativi**: in `round-robin` e `orchestrated` il team lavora a round (default max 3, configurabile con `teamMaxRounds` in `tsuka.config.json`) finché il compito non è davvero risolto — non un singolo turno per membro. `pipeline` è l'eccezione: una passata sola, un turno per stazione.
- **Turni a rotazione**: ogni membro eredita la cronologia completa dei messaggi e dei tool eseguiti dai colleghi.
- **Workspace fisico comune**: i membri operano sulla **stessa cartella fisica** (il programmatore scrive il codice, l'esperto di sicurezza lo ispeziona al turno successivo).

#### Come funziona davvero `pipeline`

Le stazioni sono l'array `members`, in ordine. Alla prima viene detto *"sei il primo della pipeline, lavora sul compito iniziale"*; a ogni successiva *"ricevi il lavoro dalla stazione precedente: analizzalo, rifinisci, passalo avanti"*. Non c'è un secondo giro: quando finisce l'ultima stazione, il run è chiuso.

Cosa interrompe la catena in anticipo, per una stazione senza `acceptance` (il caso di default):

| Evento a una stazione | Risultato |
|---|---|
| Dichiara `COMPLETATO` (`report_status` o marker `STATO:`) | Si ferma l'**intera pipeline**, riportata come completata — anche alla stazione 2 su 5 |
| Dichiara `FALLITO` | La pipeline si ferma, riportata come fallita |
| Dichiara `DA_CONTINUARE` | Passa il lavoro alla stazione successiva |
| Nome del membro non trovato in `characters/` | Avviso, stazione saltata, la catena prosegue |
| L'ultima stazione finisce senza `COMPLETATO` | Il run chiude come *non completato* — il lavoro resta comunque su disco |

Quindi `COMPLETATO` qui vuol dire "il compito del gruppo è risolto", non "la mia parte è finita": una stazione che lo interpreta male taglia fuori tutte quelle a valle. Se vuoi che passino tutte, scrivilo nella descrizione del team — chiudere con `DA_CONTINUARE` a meno che l'obiettivo complessivo non sia raggiunto.

Opzionalmente una stazione può avere un controllo oggettivo, e solo allora ottiene dei ritentativi:

```jsonc
{
  "name": "dev_security",
  "members": ["geordi", "worf", "pike"],
  "mode": "pipeline",
  "maxAttempts": 3,                                  // budget di default per i ritentativi
  "acceptance": { "command": "npm test" },           // applicato SOLO all'ultima stazione
  "stations": {                                      // oppure per stazione, che ha la precedenza
    "geordi": { "acceptance": { "fileExists": "src/server.js" }, "maxAttempts": 2 }
  }
}
```

Con `acceptance` la stazione passa dal [loop verifica → correzione](#loop-verifica--correzione): se il controllo fallisce *quella stazione* viene rieseguita con le issue concrete iniettate nel prompt, fino a `maxAttempts`; esaurito il budget (o allo stallo su un tentativo identico) fallisce l'intera pipeline invece di proseguire in silenzio. Nota che in quel caso l'esito lo decide il controllo, non il marker: una stazione con `acceptance` che dichiara `COMPLETATO` non taglia più la catena.

Senza `acceptance` — il caso di tutti i team presenti oggi in [`teams/`](teams/) — ogni stazione ha esattamente un turno e le si crede sulla parola.

### Dibattito (`/call`)

Avvia una discussione a più voci su qualsiasi tema:

```powershell
/call @tuvok, @deanna_troi e @geordi     # Menzione diretta dei partecipanti
/call                                    # Checklist interattiva multiselect
```

I partecipanti parlano a turni leggendo le risposte precedenti. La trascrizione completa è iniettata nella cronologia principale.

### Protocollo di Coordinamento (tool call → regex → default)

I modelli piccoli sono inaffidabili nell'emettere marker testuali esatti, quindi il coordinamento passa prima di tutto da **tool call**: `report_status` (`COMPLETATO` / `DA_CONTINUARE` / `FALLITO`), `route_next` (chi lavora dopo, oppure `FINE`), `cast_vote` (`APPROVO` / `MODIFICARE` / `RIFIUTO`).

L'ordine di decisione è **tool call → marker testuale storico (`STATO: COMPLETATO`) → default**. Ogni caduta di livello è *visibile*: una riga gialla in UI più una voce `protocol` (`tool_call` | `regex` | `fallback`) registrata per ogni turno nel report JSON in `workflow_logs/` — nessuna degradazione silenziosa.

### Blackboard di Run

La cronologia è ciò che è stato *detto*, la memoria è ciò che resta *tra le sessioni*, la blackboard è lo stato di *questo* run: decisioni prese, artefatti prodotti, punti aperti.

- `post_note(chiave, valore)` / `read_notes(prefisso?)` sono tool SAFE disponibili solo dentro un run di `/team` o `/goal`.
- L'isolamento è per run (`AsyncLocalStorage`): run concorrenti non vedono mai le note l'uno dell'altro, mentre i branch di uno stesso blocco `PARALLELO` condividono la stessa lavagna.
- La lavagna muore col run, ma uno `snapshot()` finisce nel report del run; `/blackboard` mostra le note degli ultimi workflow.

### Loop Verifica → Correzione

Senza un criterio di uscita oggettivo, un modello piccolo si dichiara soddisfatto di qualunque output: chi esegue sarebbe anche giudice di sé stesso. [`src/core/loop.ts`](src/core/loop.ts) ne aggiunge uno, in ordine di affidabilità:

1. **Accettazione oggettiva** — `acceptance.command` (comando shell con exit code 0, che passa dalla jail del workspace *e* dal gestore dei permessi), `acceptance.fileExists`, `acceptance.jsonValid`
2. **Verdetto di un verificatore diverso dall'esecutore** (`cast_vote` / `report_status`)
3. **Auto-dichiarazione dell'esecutore**
4. **Budget esaurito** — `maxAttempts` (default 3)

Le `issues` del verificatore diventano il prompt del tentativo successivo (correzioni concrete, mai un generico "riprova"). Una **firma anti-stallo** (risposta normalizzata + insieme dei file modificati) rileva due tentativi identici e chiude con `no_progress` prima di bruciare tutto il budget.

`acceptance` e `maxAttempts` sono opzionali per membro/stazione nel JSON del team: **assenti = comportamento identico a prima**.

### Escalation su Iniziativa dell'Agente

Un singolo agente che trova il compito troppo grande può proporre di scalarlo: `request_goal`, `request_team` e `request_call` sono tool RESTRICTED, quindi è l'utente ad autorizzare l'escalation prima che parta qualsiasi cosa. Un freno di profondità (`WorkflowScope`) ritira questi tool quando un workflow padre è già in corso, così un `/goal` non può generare ricorsivamente altri `/goal`.

## 🧰 Catalogo dei tool (27 tool)

Ogni tool è un file `src/tools/impl/*.ts` più uno schema `tools_schemas/*.json`. Un ruolo vede solo ciò che gli concede la sua lista `allowedTools`, ulteriormente potata dal tier del modello.

| Gruppo | Tool |
|--------|------|
| **File** | `list_dir`, `read_file`, `write_file` (supporta la scrittura a pezzi con `append`), `edit_file`, `delete_file`, `grep_search` |
| **Sistema** | `execute_command` (con `timeout_ms` per chiamata), `get_ps_info` |
| **Web** | `web_search`, `browse_url`, `download_file` |
| **Memoria** | `save_memory`, `recall_memory` |
| **Coordinamento di team** | `report_status`, `route_next`, `cast_vote`, `post_note`, `read_notes`, `send_message` |
| **Estensione dell'agente** | `spawn_agent`, `switch_skill`, `create_role`, `create_tool` |
| **Escalation** | `request_goal`, `request_team`, `request_call` |
| **Sicurezza** | `audit_code` (analisi statica di segreti hardcoded e costrutti pericolosi) |

I tool di coordinamento sono offerti **solo** dentro un turno di `/team` o `/goal` — mai nella chat normale. `spawn_agent` scrive il resoconto completo del sub-agente in `runs/<runId>/` e restituisce solo una sintesi breve più il percorso, così un compito subordinato non può inondare il contesto del padre.

## 🛡 Sicurezza

### Livelli di Permesso

| Livello | Tool | Comportamento |
|---------|------|---------------|
| **SAFE** | `list_dir`, `read_file`, `grep_search`, `get_ps_info`, `web_search`, `browse_url`, `save_memory`, `recall_memory`, `audit_code`, `spawn_agent`, `switch_skill`, tool di coordinamento | Eseguiti immediatamente |
| **RESTRICTED** | `write_file`, `edit_file`, `delete_file`, `download_file`, `create_role`, `create_tool`, `request_goal`, `request_team`, `request_call` | Prompt `[y/N/sempre]` per azione |
| **DANGEROUS** | `execute_command` | Richiede **sempre** `[y/N]` manuale — mai bypassabile |

I prompt sono **serializzati da una coda interna**: due agenti in parallelo non possono mai sovrapporre le richieste su stdin, e ogni prompt indica quale agente sta chiedendo.

### Misure di sicurezza aggiuntive

- **Jail workspace**: `workspaceRoot` in `tsuka.config.json` vincola tutte le operazioni file a una directory specifica (di default la cartella di lavoro del processo)
- **Limiti I/O**: `read_file` rifiuta file >5MB; `grep_search` salta file >5MB; `execute_command` tronca output a 50KB
- **Validazione argomenti**: ogni chiamata tool è validata contro il suo JSON Schema prima dell'esecuzione, con riparazione automatica del JSON troncato tipico dei modelli piccoli
- **Sandbox create_tool**: il JavaScript generato passa attraverso sandbox `vm` + blocklist pattern
- **Guardia loop**: massimo di cicli consecutivi di tool per richiesta — `maxToolRounds` in `tsuka.config.json` (default 15)
- **Guardia ricorsione**: i tool di escalation sono bloccati dentro un workflow già in corso (profondità di `WorkflowScope`)

## 🔌 Funzionalità chiave

### 1. Auto-Discovery dei Tool (Plugin a caldo)

All'avvio, [registry.ts](src/tools/registry.ts) scansiona `src/tools/impl/` e importa dinamicamente ogni file `.ts`.

```ts
// Aggiungere un tool = creare 2 file:
// src/tools/impl/nuovo_tool.ts  → logica di esecuzione
// tools_schemas/nuovo_tool.json → schema compatibile OpenAI
```

### 2. Prompt Assembly Dinamico

Il system prompt di ogni agente è costruito a runtime da:
- Istruzioni del ruolo attivo (`roles/*.json`)
- Linee guida comportamentali del tratto attivo (`traits/*.json`)
- Solo i tool che il ruolo è autorizzato a usare

→ **Consumo minimo di token, zero rumore.**

Un personaggio può dichiarare **più ruoli** (`roles: [...]` più `activeRole`): vengono montati solo istruzioni e tool della skill attiva, e l'agente può cambiare skill a metà lavoro con il tool `switch_skill`, senza riavviare la sessione.

### 3. Selezione Adattiva dei Tool (Tier Pruning + Fingerprinting)

Due meccanismi decidono quali tool un modello può usare:

| Meccanismo | Metodo | Esempio |
|-----------|--------|---------|
| **Euristica nome** (fallback) | Rileva `9b`, `26b`, `70b` dal nome | `qwen-9b` → SMALL |
| **Capability Fingerprinting** 📊 | `/benchmark` esegue il set di test in `benchmarks/` | Un 4B che passa test banali non prende più LARGE |

**I test di benchmark sono file JSON in [`benchmarks/`](benchmarks/)** — si aggiungono, modificano o rimuovono al volo, senza toccare il codice. Ogni file dichiara un prompt (o passi concatenati con risultati tool dichiarati), i tool offerti al modello e una lista di check dichiarativi pesati (`word_count`, `regex`, `json_path_equals`, `tool_arg_equals`, ...). `/benchmark` enumera i test, li esegue e riporta i punteggi singoli; i punteggi di categoria (instruction / json / toolCalling) sono medie pesate. I profili salvano l'**hash del set di test**: modificare un test invalida automaticamente i profili misurati prima. Il set di default è volutamente difficile: vincoli lessicali contati, valori calcolati dentro il JSON, catena di tool a 2 passi con **id distrattori quasi identici**, e una domanda-trappola che nomina un tool senza richiederlo. Il tier LARGE richiede la catena quasi perfetta *più* precisione ≥85% su formato e JSON.

```powershell
/benchmark                     # Testa il modello corrente
/benchmark all                 # Testa tutti i modelli disponibili
```

Il profilo è salvato in `models_profile.json`, indicizzato per livello di reasoning effort. `getModelTier()` usa prima il profilo misurato, poi l'euristica.

| Tier | Tool disponibili | Esclusi |
|------|----------------|---------|
| **SMALL** | 21 tool (lettura, scrittura, diagnostica, web, memoria, protocollo) | `execute_command`, `create_tool`, `spawn_agent`, `request_goal`, `request_team`, `request_call` |
| **MEDIUM** | 27 tool | — |
| **LARGE** | 27 tool | — |

Quando un modello ha una capacità di function calling nativa *misurata* (`toolCalling ≥ 0,9`), l'elenco testuale "Available tools" viene omesso dal system prompt: bastano gli schemi, e il prompt si accorcia.

### 4. Tracciamento Oggettivo delle Fonti Web

Ogni chiamata `web_search` / `browse_url` estrae deterministicamente gli URL e li stampa in console. Il modello **non può** allucinare le fonti — vengono mostrate *dal framework*. `browse_url` passa le pagine attraverso un estrattore Reader View (scarta nav, footer, banner cookie; converte le tabelle in GFM; rende assoluti gli URL di immagini e video per i modelli Vision).

### 5. Reasoning Live e Generazione Interrompibile 🧠

Quando un modello emette tag `<think>` o `reasoning_content` nativo (es. DeepSeek R1), TSUKA mostra il ragionamento in tempo reale in **grigio attenuato** — esattamente come opencode. Il reasoning scorre live insieme al contatore token di stato, poi il contenuto continua in bianco.

La generazione non è mai una scatola nera da subire fino in fondo: premendo **`Esc`** (o `Ctrl+X`) il turno in corso viene annullato tramite un `AbortController` ([`src/cli/interrupt.ts`](src/cli/interrupt.ts)), e il ragionamento prodotto fin lì viene salvato invece che buttato — così `/continue` può riprenderlo.

### 6. Memoria Condivisa Persistente e Budget di Contesto 🧠

Tutti gli agenti condividono `memory/memory.json`, **persistente tra sessioni**:

```
Agenti → save_memory(contenuto) → memory/memory.json
Agenti ← recall_memory(query?)  ← memory/memory.json
Prompt ← formatRelevant(task)   ← memory/memory.json  (iniezione automatica)
```

```powershell
/memory                      # Elenca e gestisce i ricordi (o /memory clear per svuotare)
```

Ogni fatto ha uno `scope` (derivato dalla root della workspace), un `kind` (`fatto` / `decisione` / `lezione` / `run`), tag opzionali e un flag `pinned`. Un agente legge il proprio scope più i fatti globali; l'espulsione è a punteggio (per primi cadono gli scarti di run, i `pinned` mai) e il recupero usa uno scoring OR sulle keyword, così una query di 5 parole restituisce comunque i risultati migliori invece di nulla. Tetto: `memoryMaxFacts` (default 200).

**Budget di contesto.** La cronologia è potata a *token*, non a numero di messaggi: `maxHistoryTokens` (default 65536) è il limite primario, e la finestra di contesto reale viene rilevata all'avvio interrogando il server (llama-server `/props`, Ollama `/api/show`, OpenRouter, vLLM) — `/context` mostra sia il consumo sia da dove arriva il limite. `maxHistoryMessages` (default 500) è solo un soffitto di sicurezza. Nessuno dei due rompe mai una coppia tool_call/tool. I singoli risultati dei tool sono limitati da `maxToolResultTokens` (default 4000).

I ragionamenti lunghi vengono salvati per intero in `memory/thinking/*.md` (in `memory.json` finisce solo un puntatore corto, per non gonfiare ogni prompt futuro) — incluso il ragionamento parziale prodotto appena prima di un timeout o di un'interruzione con `Esc`. Se una sessione viene killata a metà compito, `/continue [traccia]` inietta quella traccia direttamente nel turno successivo con l'istruzione esplicita "non ripartire da capo, decidi e agisci", invece di affidarsi all'iniziativa del modello di richiamarla da solo con `recall_memory`.

### 7. Self-Authoring dei Tool (`create_tool`) 🛠️

Gli agenti possono scrivere **nuovi tool** in JavaScript a runtime estendendo le proprie capacità senza toccare il codice sorgente:

#### 📌 Prerequisiti per l'attivazione:
1. **Ruolo abilitato**: il personaggio o ruolo attivo deve includere `create_tool` nei propri `allowedTools` (es. `developer` come **Geordi**, `sysadmin` come **Scotty**/**Laan**, `game_designer` come **Paris**).
2. **Tier del modello (`MEDIUM` o `LARGE`)**: nello schema `tools_schemas/create_tool.json` il tool richiede tier `medium`. Se usi un modello 7B/8B/9B (classificato di default come `SMALL`), il tool viene nascosto per sicurezza. Per sbloccarlo:
   - Esegui `/benchmark` per misurare il modello: se supera i test, verrà promosso a `MEDIUM`/`LARGE` nel profilo `models_profile.json`.
   - Oppure verifica la disponibilità digitando `/tools` nel REPL.

#### 💬 Come usarlo:
Basta chiedere all'agente in linguaggio naturale di creare il tool:
> *"Crea un nuovo tool chiamato `conta_righe` che prende il path di un file e ne restituisce il numero di righe."*

#### ⚙️ Ciclo di vita del tool:
1. L'agente chiama `create_tool` fornendo nome, parametri JSON Schema e il codice JavaScript (`executeBody`)
2. Il codice è validato in **sandbox `vm`** contro una blocklist (`child_process`, `eval`, `process.env`, `require` arbitrari...)
3. Scritto su disco come `<cartella impl dei tool>/<nome>.js` + `tools_schemas/<nome>.json` (`src/tools/impl/` in dev e `dist/tools/impl/` in build)
4. **Registrato a caldo** → utilizzabile immediatamente nella sessione corrente
5. Al prossimo avvio viene caricato dall'auto-discovery standard
6. **Backup automatico** in `tools_backup/` prima di ogni sovrascrittura

```js
// Esempio: tool generato ed eseguito dall'agente
create_tool({
  name: "conta_righe",
  description: "Conta le righe di un file di testo",
  riskLevel: "SAFE",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  executeBody: "const c = require('fs').readFileSync(args.path, 'utf-8'); return 'Righe: ' + c.split('\n').length;"
})
```

⚠️ I tool generati non possono essere `DANGEROUS` e non possono sovrascrivere tool core `.ts`.

### 8. Auto-Discovery dei Server all'Avvio 📡

All'avvio TSUKA non si fida ciecamente del provider configurato — scansiona ([`src/core/discovery.ts`](src/core/discovery.ts)):

1. **Sonda il provider attivo** (timeout breve 2,5s, via `/v1/models` con fallback nativo Ollama `/api/tags`).
2. Se è spento, **sonda in parallelo tutti gli altri server locali configurati** e si aggancia al primo vivo (il config viene aggiornato automaticamente). I provider remoti non vengono mai sondati se non attivi: l'avvio non dipende dalla rete.
3. **Priorità del modello**: modello già caricato in RAM → modello configurato se presente sul server → primo disponibile. Agganciarsi al modello caricato evita che il server ne ricarichi un altro da zero — e garantisce che i profili di `/benchmark` siano attribuiti al modello che risponde davvero.

Il modello caricato è rilevato per famiglia di server: Unsloth Studio lo marca con `"loaded": true` in `/v1/models`, LM Studio con `"state": "loaded"`, Ollama tramite l'endpoint `/api/ps`.

Se nessun server risponde, la REPL parte comunque — cambia manualmente con `/provider`.

### 9. Cross-Platform 🖥️

Astratto da [`src/core/platform.ts`](src/core/platform.ts):

| Piattaforma | Shell | Esempi Tool |
|------------|-------|-------------|
| **Windows** 🪟 | `powershell.exe -NoProfile -Command` | `Get-Process`, `Get-Service`, `Get-Volume` |
| **Linux** 🐧 | `/bin/sh -c` | `ps`, `df -h`, `systemctl` |
| **macOS** 🍎 | `/bin/sh -c` | `ps aux -r`, `launchctl`, `df -h` |

Le variabili d'ambiente sensibili (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`...) sono filtrate su tutte le piattaforme.

## 🏗 Architettura

```
                     ┌──────────────────────┐
                     │   characters/*.json   │
                     └──────┬───────┬───────┘
                            │       │
                     ┌──────▼──┐ ┌──▼────────┐
                     │ roles/* │ │ traits/*  │
                     │ (tool)  │ │ (stile)   │
                     └──────┬──┘ └────┬──────┘
                            └────┬────┘
                                 ▼
                     ┌──────────────────────┐
                     │  Dynamic System      │
                     │  Prompt Assembly     │
                     └──────────┬───────────┘
                                ▼
                     ┌───────────────────────────────┐
                     │  Ollama / llama.cpp /         │
                     │  Unsloth Studio / OpenRouter  │
                     └──────────────┬────────────────┘
                                    ▼
                     ┌──────────────────────┐
                     │  src/tools/impl/*.ts │
                     └──────────────────────┘
```

### Componenti

| Cartella | Scopo |
|----------|-------|
| [`roles/`](roles/) | Definizioni competenze + lista tool consentiti |
| [`traits/`](traits/) | Stile comunicativo e prompt di personalità |
| [`characters/`](characters/) | Personaggi / Agenti nominati (uno o più ruoli + un tratto) |
| [`teams/`](teams/) | Configurazioni dei team (modalità, membri, orchestrator, acceptance) |
| [`presets/`](presets/) | Manifest di installazione usati da `tsuka init` (`core.json` + `packs/`) |
| [`benchmarks/`](benchmarks/) | Set di test dichiarativi usato da `/benchmark` |
| [`tools_schemas/`](tools_schemas/) | JSON Schema per ogni tool (Function Calling) |
| [`src/tools/impl/`](src/tools/impl/) | Logica di esecuzione in TypeScript puro |

## 🧪 Validazione Autonoma

```powershell
# Esegue tutte le suite
npm test

# Suite singole
npx tsx tests/test_roles.ts
npx tsx tests/test_memory.ts
npx tsx tests/test_fingerprinting.ts
npx tsx tests/test_self_authoring.ts
npx tsx tests/test_platform.ts
```

Stato attuale: **64 suite di test, 1200+ assertion — tutte verdi**. Ogni suite gira senza rete e senza un LLM vivo (`MockLLMProvider`) e su un file di memoria temporaneo, così `npm test` non tocca mai i ricordi reali.

## 📚 Documentazione

| Risorsa | Descrizione |
|---------|-------------|
| [Documentazione tecnica](docs/README-it.md) | Portale: indice di tutta la documentazione tecnica |
| [Architettura](docs/architecture-it.md) | Registry, tier pruning, assemblaggio dinamico del prompt |
| [Workflow multi-agente](docs/multi-agent-it.md) | Meccanica di `/call`, `/team` e `/goal` in dettaglio |
| [Sicurezza](docs/security-it.md) | Gestore dei permessi, jail del workspace, tracciamento deterministico delle fonti |
| [Casi d'uso](docs/use-cases-it.md) | Ricette concrete con personaggi, ruoli e team |
| [Guida didattica](docs/guida-didattica.md) | Tappa per tappa: come si costruisce un harness agentico come questo |

## 🗺 Roadmap

L'interfaccia da terminale è ANSI scritto a mano (niente Ink, niente React): un vincolo scelto apposta mentre si costruiva il core, non il punto d'arrivo. **TSUKA andrà verso una TUI vera** — pannelli, aree che si aggiornano da sole, uno scrollback che non litiga con l'output degli agenti — e serve soprattutto quando parlano più agenti insieme. Il lavoro di preparazione è già in corso: ogni stampa passa da un sink sostituibile (`src/core/logSink.ts`) e da uno `StreamRenderer` condiviso, così l'interfaccia diventa un client fra i tanti invece di *essere* l'applicazione. Dettagli in [architettura §16](docs/architecture.md).

## 🤝 Contribuire

Le PR sono benvenute! L'architettura è volutamente semplice:
- I tool vivono in `src/tools/impl/` — aggiungine uno, aggiungi il suo schema, fatto.
- Ruoli, tratti, personaggi, team sono JSON puri — estendi senza toccare TypeScript.
- I test vanno in `tests/` — guarda quelli esistenti per i pattern.

## 📄 Licenza

[MIT](LICENSE) — libero per uso educativo, personale e commerciale.
