[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Ollama](https://img.shields.io/badge/Ollama-nativo-8A2BE2?logo=ollama)](https://ollama.com/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-pronto-FF6B35?logo=openai)](https://openrouter.ai/)
[![Licenza](https://img.shields.io/badge/Licenza-MIT-green)](LICENSE)

<br />
<div align="center">
  <h1>⚡ TSUKA</h1>
  <p><strong>TypeScript Unified Kit for Agents</strong></p>
  <p>Framework Multi-Agent CLI per Windows, Linux & macOS</p>
  <p>Leggi in <a href="README.md">🇬🇧 English</a></p>
</div>

**TSUKA** è un framework multi-agente didattico e ultra-leggero, e una CLI agentica, interamente scritto in TypeScript. Collegati a modelli locali via **Ollama** o provider cloud via **OpenRouter**. Nato per **Windows + PowerShell**, supporta sperimentalmente anche **Linux** e **macOS**.

> **Il nome**: 柄 (*tsuka*) è l'impugnatura della katana — la presa a cui ogni lama si attacca. I modelli sono le lame; TSUKA è ciò che ti permette di brandirle.
>
> **Perché?** La maggior parte dei framework agentici è Python/Linux-only. TSUKA porta la potenza agentica sulla riga di comando Windows senza sacrificare la portabilità.

## ✨ Punti salienti

| Caratteristica | Descrizione |
|---------------|-------------|
| 🧩 **Tool a caldo** | Aggiungi un file `.ts` in `src/tools/impl/` — scoperto automaticamente all'avvio |
| 📡 **Auto-discovery dei server** | All'avvio scansiona i server LLM locali (Ollama, Unsloth, …) e si aggancia a quello vivo — preferendo il modello già caricato in RAM |
| 🎭 **Sistema personaggi** | Ruoli (competenze) × Tratti (personalità) × Personaggi (agenti nominati) in JSON |
| 📊 **Capability Fingerprinting** | `/benchmark` misura oggettivamente le capacità del modello — tier *misurato, non indovinato* |
| 🛠️ **Auto-creazione tool** | Gli agenti scrivono nuovi tool JavaScript via `create_tool` — sandbox + registrazione a caldo |
| 🧠 **Memoria condivisa persistente** | I fatti sopravvivono ai riavvii, condivisi tra tutti gli agenti e le sessioni |
| 🛡️ **Permessi a 3 livelli** | SAFE / RESTRICTED / DANGEROUS — l'utente ha sempre il controllo |
| 🖥️ **Cross-platform** | Windows (PowerShell) primario; Linux/macOS (`/bin/sh`) sperimentale |
| 🤝 **Workflow multi-agente** | Dibattiti (`/call`) e team collaborativi (`/team`) |

## ⚡ Guida Rapida in 60 Secondi

```bash
# 1. Installazione globale tramite npm (o clona il repository)
npm install -g tsuka

# 2. Inizializza il workspace con il preset core degli agenti
tsuka init --preset core

# 3. Avvia la CLI
tsuka
```
*Assicurati che Ollama sia avviato (`ollama serve`) oppure configura la tua `OPENROUTER_API_KEY` nel file `.env`.*

## 📋 Indice

- [Architettura](#-architettura)
- [Funzionalità chiave](#-funzionalità-chiave)
- [Workflow multi-agente](#-workflow-multi-agente)
- [Sicurezza](#-sicurezza)
- [Comandi](#-comandi-slash-repl)
- [Guida rapida](#-guida-rapida)
- [Test](#-validazione-autonoma)
- [Documentazione](#-documentazione)
- [Licenza](#licenza)

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
                     ┌──────────────────────┐
                     │  Ollama / OpenRouter │
                     └──────────┬───────────┘
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
| [`characters/`](characters/) | Personaggi nominati (ruolo + tratto) |
| [`teams/`](teams/) | Configurazioni collaborazione multi-agente |
| [`tools_schemas/`](tools_schemas/) | JSON Schema per ogni tool (Function Calling) |
| [`src/tools/impl/`](src/tools/impl/) | Logica di esecuzione in TypeScript puro |

## 🔌 Funzionalità chiave

### 1. Auto-Discovery dei Tool (Plugin a caldo)

All'avvio, [registry.ts](src/tools/registry.ts) scansione `src/tools/impl/` e importa dinamicamente ogni file `.ts`.

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

Il profilo è salvato in `models_profile.json`. `getModelTier()` usa prima il profilo misurato, poi l'euristica.

| Tier | Tool disponibili | Esclusi |
|------|----------------|---------|
| **SMALL** | 20 tool (lettura, scrittura, diagnostica, web, memoria, protocollo) | `execute_command`, `create_tool`, `spawn_agent` |
| **MEDIUM** | 27 tool | — |
| **LARGE** | 27 tool | — |

### 4. Tracciamento Oggettivo delle Fonti Web

Ogni chiamata `web_search` / `browse_url` estrae deterministicamente gli URL e li stampa in console. Il modello **non può** allucinare le fonti — vengono mostrate *dal framework*.

### 5. Memoria Condivisa Persistente 🧠

Tutti gli agenti condividono `memory/memory.json`, **persistente tra sessioni**:

```
Agenti → save_memory(contenuto) → memory/memory.json
Agenti ← recall_memory(query?)  ← memory/memory.json
Prompt ← formatForPrompt()      ← memory/memory.json  (iniezione automatica)
```

```powershell
/memory                      # Elenca e gestisce i ricordi (o /memory clear per svuotare)
```

La cronologia chat è anche potata automaticamente (`maxHistoryMessages` in `tsuka.config.json`, default 40) senza rompere le coppie tool_call/tool.

### 6. Self-Authoring dei Tool (`create_tool`) 🛠️

Gli agenti possono scrivere **nuovi tool** in JavaScript a runtime:

1. L'agente chiama `create_tool` con il codice `executeBody` in JavaScript
2. Il codice è validato in **sandbox `vm`** contro una blocklist (`child_process`, `eval`, `process.env`, `require` arbitrari...)
3. Scritto su disco come `src/tools/impl/<nome>.js` + `tools_schemas/<nome>.json`
4. **Registrato a caldo** → utilizzabile subito nella sessione corrente
5. Al prossimo avvio entra nell'auto-discovery standard
6. **Backup automatico** in `tools_backup/` prima di ogni sovrascrittura (rollback)

```js
// Esempio: tool creato dall'agente stesso
create_tool({
  name: "conta_righe",
  description: "Conta le righe di un file",
  riskLevel: "SAFE",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  executeBody: "const c = require('fs').readFileSync(args.path, 'utf-8'); return 'Righe: ' + c.split('\n').length;"
})
```

⚠️ I tool generati non possono essere `DANGEROUS` e non possono sovrascrivere tool core `.ts`.

### 7. Auto-Discovery dei Server all'Avvio 📡

All'avvio TSUKA non si fida ciecamente del provider configurato — scansiona ([`src/core/discovery.ts`](src/core/discovery.ts)):

1. **Sonda il provider attivo** (timeout breve 2,5s, via `/v1/models` con fallback nativo Ollama `/api/tags`).
2. Se è spento, **sonda in parallelo tutti gli altri server locali configurati** e si aggancia al primo vivo (il config viene aggiornato automaticamente). I provider remoti non vengono mai sondati se non attivi: l'avvio non dipende dalla rete.
3. **Priorità del modello**: modello già caricato in RAM → modello configurato se presente sul server → primo disponibile. Agganciarsi al modello caricato evita che il server ne ricarichi un altro da zero — e garantisce che i profili di `/benchmark` siano attribuiti al modello che risponde davvero.

Il modello caricato è rilevato per famiglia di server: Unsloth Studio lo marca con `"loaded": true` in `/v1/models`, LM Studio con `"state": "loaded"`, Ollama tramite l'endpoint `/api/ps`.

Se nessun server risponde, la REPL parte comunque — cambia manualmente con `/provider`.

### 8. Cross-Platform 🖥️

Astratto da [`src/core/platform.ts`](src/core/platform.ts):

| Piattaforma | Shell | Esempi Tool |
|------------|-------|-------------|
| **Windows** 🪟 | `powershell.exe -NoProfile -Command` | `Get-Process`, `Get-Service`, `Get-Volume` |
| **Linux** 🐧 | `/bin/sh -c` | `ps`, `df -h`, `systemctl` |
| **macOS** 🍎 | `/bin/sh -c` | `ps aux -r`, `launchctl`, `df -h` |

Le variabili d'ambiente sensibili (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`...) sono filtrate su tutte le piattaforme.

## 👥 Workflow Multi-Agente

### Dibattito (`/call`)

Avvia una discussione a più voci su qualsiasi tema:

```powershell
/call @laan, @deanna_troi e @geordi     # Menzione diretta dei partecipanti
/call                                    # Checklist interattiva multiselect
```

I partecipanti parlano a turni leggendo le risposte precedenti. La trascrizione completa è iniettata nella cronologia principale.

### Team Collaborativi (`/team`)

Collaborazione sequenziale su uno spazio di lavoro condiviso:

```powershell
/team cyber_audit                        # Seleziona un team
# Poi: "Blinda la porta 22 su questo server"
```

- **Round iterativi**: il team lavora a round (default max 3, configurabile con `teamMaxRounds` in `tsuka.config.json`) finché il compito non è davvero risolto — non più un singolo turno per membro.
- **Protocollo di completamento**: ogni membro deve chiudere il turno con `STATO: COMPLETATO` (compito verificato come risolto) o `STATO: DA_CONTINUARE` (il lavoro continua). L'harness rileva il completamento in modo deterministico e si ferma prima.
- **Turni a rotazione**: ogni membro eredita la cronologia completa dei messaggi e dei tool eseguiti dai colleghi.
- **Workspace fisico comune**: i membri operano sulla **stessa cartella fisica** (il programmatore scrive il codice, l'esperto di sicurezza lo ispeziona al turno successivo).

## 🛡 Sicurezza

### Livelli di Permesso

| Livello | Tool | Comportamento |
|---------|------|---------------|
| **SAFE** | `list_dir`, `read_file`, `grep_search`, `get_ps_info`, `web_search`, `browse_url`, `save_memory`, `recall_memory` | Eseguiti immediatamente |
| **RESTRICTED** | `write_file`, `edit_file`, `delete_file`, `create_role`, `create_tool` | Prompt `[y/N/sempre]` per azione |
| **DANGEROUS** | `execute_command` | Richiede **sempre** `[y/N]` manuale — mai bypassabile |

### Misure di sicurezza aggiuntive

- **Jail workspace**: `workspaceRoot` opzionale in `tsuka.config.json` vincola tutte le operazioni file a una directory specifica
- **Limiti I/O**: `read_file` rifiuta file >5MB; `grep_search` salta file >5MB; `execute_command` tronca output a 50KB
- **Validazione argomenti**: ogni chiamata tool è validata contro il suo JSON Schema prima dell'esecuzione
- **Sandbox create_tool**: il JavaScript generato passa attraverso sandbox `vm` + blocklist pattern
- **Guardia loop**: massimo 15 cicli consecutivi di tool per richiesta (`Agent.MAX_TOOL_ROUNDS`)

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
| `/tools` | Mostra i tool abilitati per ruolo, tier ed effort |
| `/context` | Mostra il consumo di token della cronologia rispetto al budget |
| `/memory [clear\|<id>]` | Gestisce, legge o svuota i ricordi persistenti |
| `/blackboard` | Mostra note e stato dell'ultimo workflow/goal |
| `/runs` | Mostra storico e report delle esecuzioni recenti |
| `/info` | Mostra informazioni sessione (provider, modello, agente) |
| `/reset` | Resetta cronologia + approvazioni sicurezza |
| `/search-engine` | Cambia provider di ricerca (DuckDuckGo / Google / Tavily) |
| `/clear` · `/exit` | Pulisce il terminale · Esci |

## 🚀 Guida Rapida

### Prerequisiti

```powershell
# 1. Installa Ollama
#    https://ollama.com/
ollama serve

# 2. Scarica un modello
ollama pull qwen2.5-coder:7b
```

### Avvio Veloce

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
/call @laan, @deanna_troi
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

**Home dell'app vs workspace** (`src/core/apphome.ts`): gli asset dell'applicazione —
`roles/`, `traits/`, `characters/`, `teams/`, `tools_schemas/`, `tsuka.config.json`, `.env`,
memoria condivisa e profili dei modelli — vivono sempre nella *cartella di installazione*
(o in `TSUKA_HOME`, se quella variabile d'ambiente è impostata). Il *workspace* è la cartella
da cui lanci `tsuka`: è lì che operano i file tool degli agenti (read/write/edit/grep) con i
path relativi. Puoi quindi fare `cd` in qualsiasi progetto e far lavorare gli agenti su di
esso, mentre personaggi, memoria e config seguono l'installazione. Dopo una modifica ai
sorgenti, aggiorna il comando globale con `npm run build`. Per disinstallare: `npm unlink -g tsuka`.

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

Stato attuale: **43 suite di test, 200+ assertion — tutti verdi**.

## 📚 Documentazione

| Risorsa | Descrizione |
|---------|-------------|
| [Documentazione tecnica](docs/README.md) | Architettura, workflow multi-agente, sicurezza |
| [HISTORY.md](archive/HISTORY.md) | Changelog cronologico completo degli interventi (archiviato) |
| [OPTIMIZATION_PLAN.md](archive/OPTIMIZATION_PLAN.md) | Il piano di ottimizzazione in 5 fasi completato (archiviato) |

## 🤝 Contribuire

Le PR sono benvenute! L'architettura è volutamente semplice:
- I tool vivono in `src/tools/impl/` — aggiungine uno, aggiungi il suo schema, fatto.
- Ruoli, tratti, personaggi, team sono JSON puri — estendi senza toccare TypeScript.
- I test vanno in `tests/` — guarda quelli esistenti per i pattern.

## 📄 Licenza

[MIT](LICENSE) — libero per uso educativo, personale e commerciale.