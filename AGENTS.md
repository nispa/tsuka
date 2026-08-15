# TSUKA — TypeScript Unified Kit for Agents

## Overview

Framework multi-agente CLI in TypeScript. Orchestrazione di LLM locali (Ollama/Unsloth) e cloud (OpenRouter). Ciclo agentico ReAct, tool hot-plug, character system ortogonale (ruolo × tratto), memory persistente condivisa, benchmark oggettivo per tier dei modelli.

## Architettura

```
CLI (REPL) → Agent.run() → LLMProvider.chatWithTools()
                ↓
         ToolRegistry.executeTool()  ←  Tool auto-discovery (src/tools/impl/)
                ↓
         PermissionManager (SAFE / RESTRICTED / DANGEROUS)
```

### Ciclo agentico (`src/core/agent.ts`)

`Agent.run()` implementa ReAct:
1. Invia history + tool list all'LLM
2. Se response contiene `tool_calls`, li esegue in sequenza
3. Output dei tool → history → torna al passo 1
4. Max 15 round di tool (`MAX_TOOL_ROUNDS`), poi stop di sicurezza
5. History pruning: max 40 messaggi / 65536 token stimati

### Pattern multi-agente

Tutti **sequenziali** (turn-based, non a sciame):

| Pattern | File | Tool Access | Coordination |
|---------|------|-------------|--------------|
| **Conferenza** (`/call`) | `src/cli/commands/call.ts` | Nessuno | 2 round, trascrizione condivisa |
| **Team collaborativo** (`/team`) | `src/cli/commands/team.ts` | Pieno | Round configurabili, history condivisa, protocollo `STATO: COMPLETATO/DA_CONTINUARE` |

Il pattern `/team` crea Agent freschi a ogni turno, semina la history condivisa, e verifica lo stato dichiarato dal membro per early stop. Ogni team si chiude con un membro dal ruolo `supervisor` come quality gate: il criterio è il MESTIERE, non un nome proprio (`goal.ts` innesca la rilavorazione su `rolesOf(char).includes('supervisor')`).

**Protocollo a tool call (T2.1)**: il coordinamento tra membri non si basa più solo su marker testuali liberi (`STATO: COMPLETATO`, `AGENTE: @nome`, `VOTO: APPROVO`) — con modelli piccoli quei marker falliscono su grassetto markdown, spazi extra, nomi multi-parola. Tre tool di protocollo (`riskLevel: SAFE`, disponibili solo nei contesti giusti, non nella chat normale) sostituiscono il testo libero:
- `report_status(status, summary, next_hint?)` — chiude un turno di membro/pipeline (`COMPLETATO`/`DA_CONTINUARE`/`FALLITO`);
- `route_next(agent, reason)` — decisione di routing dell'orchestrator (`@nome` o `FINE`);
- `cast_vote(vote, reason)` — voto nei round di discussione con `voting: true`.

Ordine di decisione per ogni turno, identico per i tre: **tool call → regex esistente (fallback) → default**. Ogni caduta di livello sotto `tool_call` emette una riga gialla in UI (`warnProtocolDegrade` in `strategies/common.ts`) e una voce in `ProtocolLogEntry` (confluisce in `protocolLog` nei `workflow_logs/`, scritto da `workflowLog.ts`). `STATO: FALLITO` (prima non implementato da nessuna parte) ora ferma round-robin/orchestrated/pipeline: il turno ritorna `'failed'` invece di `'completed'/'continue'`.

**Blackboard di run (T6.2)**: due tool SAFE in più, `post_note(key, value)` / `read_notes(prefix?)`, offerti nello stesso punto di `report_status` (`runMemberTurn` in `strategies/common.ts`, quindi in tutte e 4 le modalità `/team` e in ogni step di `/goal`) — non nella chat normale. Scrivono/leggono `src/core/blackboard.ts`: stato condiviso di **un solo run**, isolato dagli altri (vedi "Da sapere").

**Routing orchestrato**: se il team ha `"mode": "orchestrated"` e un `"orchestrator"`, l'orchestrator decide dinamicamente chi lavora a ogni turno invece del loop fisso, preferibilmente via `route_next` (fallback: `AGENTE: @nome` / `FINE` testuale). Fallback a round-robin se la risposta non è parseabile in nessuno dei due modi.

**Goal orchestrator (`/goal`)**: seleziona DINAMICAMENTE gli agenti da TUTTI i personaggi disponibili, assegna compiti e coordina l'esecuzione. Supporta blocchi `PARALLELO` per sotto-compiti indipendenti eseguiti con `Promise.all`.

### Tool system (`src/tools/registry.ts`)

- Auto-discovery: scansiona `src/tools/impl/*.ts` all'avvio
- Doppio filtro: **ruolo** (allowedTools) × **tier modello** (small/medium/large)
- Tier misurato da `/benchmark` (capability fingerprinting), fallback su euristica dal nome (es. 9b → small, 70b → large)
- 23 tool implementati (incluso `send_message`, `report_status`, `route_next`, `cast_vote`, `post_note`, `read_notes`, `audit_code`), schema JSON in `tools_schemas/`

### Character system

Tripla stratificazione ortogonale:
- **Role** (`roles/*.json`): competenze + tool consentiti
- **Trait** (`traits/*.json`): stile comunicativo
- **Character** (`characters/*.json`): preset nome + role + trait

**Copertura dei ruoli (T7.1)**: `/goal` sceglie fra i *character*, non fra i role — un role
senza nessun character che lo usi è un role che `/goal` non potrà mai assegnare. 28 character
coprono tutti i 21 role (contando anche le skill secondarie del multi-skill), inclusi un
`researcher` laconico e uno `compliant` (`neelix`) tenuto apposta come esempio didattico.
Verificato da `tests/test_presets.ts`: per ogni file in `roles/` deve esistere almeno un
character che lo usa.

**I nomi sono dati, i ruoli sono il contratto**: il roster in `characters/` è rinominabile
dall'utente, quindi nessun nome proprio va scritto nel codice, nei prompt o nei test. Il
prompt dell'orchestrator (`buildGoalOrchestratorPrompt`) genera catalogo ed esempi dai
character installati e i blueprint dai team installati (`buildTeamBlueprints`);
`resolveCharacter` risolve anche per mestiere (`@security_auditor` → chi lo esercita); i test
prendono gli agenti da `tests/fixtures/roster.ts` (`agentWithRole`, `distinctAgents`).

**Preset (`presets/`)**: manifest JSON che *elencano* nomi di roles/traits/characters/teams
già presenti su disco — non spostano né cancellano file, quindi comporli non rompe nulla.
Pensati per essere letti da `tsuka init` (`src/cli/initCmd.ts`, T7.2) per copiare il sottoinsieme scelto nella cartella `.tsuka/` del workspace (`tsuka init [--preset core|full] [--pack <nome,...>] [--force]`). `homePath` (`src/core/apphome.ts`) risponde con risoluzione gerarchica: predilige `.tsuka/` nel workspace corrente se presente, altrimenti ricade sull'app home predefinita.
- `presets/core.json` — set minimo di default: 14 character, uno per competenza distinta,
  nessun ruolo duplicato, più i team che quei character sanno comporre.
- `presets/packs/{osint,content,devops,security,demo}.json` — set aggiuntivi opzionali per dominio
  (`--pack <nome,...>`). I pack si installano SOPRA il core: un pack può quindi citare un
  team i cui membri arrivano dal core, ma non membri che nessuno dei due installa
  (verificato da `T7.4-install-*` in `tests/test_presets.ts`). Il pack `demo` è l'eccezione:
  raccoglie deliberatamente i tratti dannosi (`compliant`, character `neelix`) come esempio
  didattico di cosa succede a un voto (`strategies/hybrid.ts`) con un membro accondiscendente
  — non è un default consigliato, ed è documentato come tale nel campo `note` del manifest.
- Schema di un manifest: `{ name, displayName?, description?, roles: string[], traits:
  string[], characters: string[], teams: string[], note?: string }`. Ogni nome deve
  corrispondere a un file esistente nella cartella omonima; per `core.json`, ogni character
  elencato deve usare un role e un trait a loro volta elencati nello stesso manifest
  (altrimenti `tsuka init --preset core` produrrebbe un'installazione con riferimenti rotti).
  Validato da `tests/test_presets.ts`.

### Memoria persistente (`src/core/memory.ts`)

- Singleton `MemoryStore`, file `memory/memory.json`
- Condivisa tra tutti gli agenti (chat, /call, /team)
- Auto-iniettata nel system prompt
- Fino a 200 fatti; scope per workspace (+ `'globale'`, T6.1), eviction a punteggio (kind/hits/recency, mai i `pinned`), ricerca keyword con scoring OR

## Project structure

```
harness/
├── src/
│   ├── cli/                         # REPL, comandi slash, UI
│   │   ├── index.ts                 # Entry point principale
│   │   ├── commands/
│   │   │   ├── types.ts             # CommandCtx interface
│   │   │   ├── call.ts              # /call — conferenza
│   │   │   ├── goal.ts              # /goal — orchestratore dinamico
│   │   │   ├── team.ts              # /team — dispatcher (carica team, sceglie strategia, delega)
│   │   │   ├── workflowLog.ts       # scrittura report JSON in workflow_logs/
│   │   │   ├── strategies/          # T4.2: le 4 modalità di /team + utility condivise
│   │   │   │   ├── common.ts        # runMemberTurn, protocollo di stato, TeamStrategy/TeamResult
│   │   │   │   ├── roundRobin.ts    # modalità round-robin
│   │   │   │   ├── orchestrated.ts  # modalità orchestrata (routing dinamico via route_next)
│   │   │   │   ├── pipeline.ts      # modalità pipeline (catena di montaggio)
│   │   │   │   └── hybrid.ts        # round di discussione + voto (cast_vote), usato da round-robin/orchestrated
│   │   │   ├── persona.ts           # /character, /role, /trait
│   │   │   ├── provider.ts          # /provider, /models, /use, /benchmark
│   │   │   ├── memory.ts            # /memory
│   │   │   └── session.ts           # /exit, /info, /reset, /context
│   │   ├── shared.ts                # loadSystemPrompt, loadRole/Trait/Character/Team
│   │   ├── stream.ts                # StreamRenderer (UI live)
│   │   ├── ui.ts                    # CLITheme, InteractiveMenu
│   │   ├── input.ts                 # Tab completion, readline
│   │   ├── interrupt.ts             # Esc key interrupt
│   │   ├── statusline.ts            # "Thinking..." animato
│   │   └── rawlock.ts               # Raw mode lock (Windows)
│   ├── core/
│   │   ├── agent.ts                 # Agent class (ciclo ReAct + compressHistory)
│   │   ├── provider.ts              # LLMProvider (OpenAI client)
│   │   ├── types.ts                 # Tipi condivisi layer protocollo (ChatMessage, TeamConfig, ...)
│   │   ├── config.ts                # ConfigManager (tsuka.config.json)
│   │   ├── contextTracker.ts        # ContextTracker (registro attività)
│   │   ├── discovery.ts             # Server auto-discovery
│   │   ├── memory.ts                # MemoryStore (memoria condivisa)
│   │   ├── modelProfile.ts          # Capability fingerprinting
│   │   ├── benchmarkTests.ts        # Benchmark runner
│   │   ├── agentEvents.ts           # Agent event types
│   │   ├── thinkParser.ts           # <think> tag parser
│   │   ├── messageQueue.ts          # Coda messaggi inter-agente (send_message)
│   │   ├── parallelWorkspace.ts     # T3.2: staging + merge/conflict per il blocco PARALLELO di /goal
│   │   ├── logBuffer.ts             # T3.2: buffer output console per branch parallelo
│   │   ├── blackboard.ts            # T6.2: stato condiviso di UN run (/team, /goal), isolato via AsyncLocalStorage
│   │   ├── apphome.ts               # App home vs workspace
│   │   └── platform.ts              # Cross-platform shell
│   ├── tools/
│   │   ├── index.ts                 # Tool auto-discoverer
│   │   ├── registry.ts              # ToolRegistry, getModelTier
│   │   └── impl/                    # 23 tool implementazioni
│   └── safety/
│       └── permissions.ts           # PermissionManager (coda prompt per esecuzione parallela)
├── characters/                      # 28 preset JSON
├── roles/                           # 21 ruoli JSON
├── traits/                          # 9 tratti JSON
├── teams/                           # 10 team JSON
├── presets/                         # T7.1: manifest core.json + packs/*.json per `tsuka init`
├── tools_schemas/                   # JSON Schema per Function Calling
├── benchmarks/                      # 5 test JSON per fingerprinting
├── memory/                          # Memoria persistente (auto-creata)
├── tests/                           # Suite di test
├── docs/                            # Documentazione tecnica
└── tsuka.config.json                # Configurazione runtime
```

## Configurazione (`tsuka.config.json`)

```json
{
  "activeProvider": "unsloth",
  "providers": {
    "ollama":     { "baseUrl": "http://localhost:11434/v1", "model": "..." },
    "openrouter": { "baseUrl": "https://openrouter.ai/api/v1", "model": "..." },
    "unsloth":    { "baseUrl": "http://127.0.0.1:8888/v1", "model": "..." }
  },
  "webSearch":      { "provider": "duckduckgo" },
  "activeRole":     "developer",
  "activeTrait":    "creative",
  "activeCharacter":"geordi"
}
```

`maxHistoryMessages` (default 40) e `maxHistoryTokens` (default 65536) in `ConfigManager`. `teamMaxRounds` default 3 nel config.

## Comandi REPL

| Comando | Descrizione |
|---------|-------------|
| `/context` | Mostra contesto usato/disponibile, messaggi per ruolo, attività recenti |
| `/call [@nome ...]` | Conferenza multi-agente |
| `/team [nome]` | Team collaborativo |
| `/goal <obiettivo>` | Goal orchestrator: sceglie agenti e coordina dinamicamente |
| `/character` | Cambia personaggio |
| `/role` | Cambia ruolo (tool) |
| `/trait` | Cambia tratto (stile) |
| `/provider` | Cambia provider LLM |
| `/models` | Lista modelli disponibili |
| `/use <modello>` | Seleziona modello |
| `/benchmark [modello\|all]` | Profila capacità modello |
| `/memory` | Mostra memoria condivisa |
| `/forget <id\|all>` | Elimina ricordi |
| `/reset` | Reset history + permessi |
| `/info` | Stato sessione |
| `/search-engine` | Cambia motore ricerca |

## Sviluppo

```powershell
npm run dev            # Avvia con tsx (dev)
npm run build          # Compila con tsc
npm start              # Esegui build
npm test               # Test suite
npm link               # Installa comando globale `tsuka`
```

TS strict, ES2022, CommonJS, `tsx` per dev.

## Convenzioni codice

- Commenti e nomi in **italiano** (codice in inglese)
- `chalk` per colori, `prompts` per input interattivi, `openai` SDK
- Tool: file in `src/tools/impl/*.ts` + schema in `tools_schemas/*.json`
- Test esistenti in `tests/`, eseguiti con `tsx`
- Eventi agente via `AgentEvent` system (disaccoppia core da UI)
- `signal?: AbortSignal` per interrupt su ogni chiamata LLM
- `GenerationInterrupt` per Esc key durante generazione

## Da sapere

- **Coda dei permessi (T3.1)**: `PermissionManager` è condiviso tra gli agenti di un blocco `PARALLELO` di `/goal` (`Promise.all`). Le richieste RESTRICTED/DANGEROUS (uniche a generare un prompt interattivo) si accodano internamente (`enqueuePrompt`): un prompt alla volta, in ordine di arrivo, con il nome dell'agente richiedente mostrato quando disponibile. I tool SAFE restano sincroni, senza coda.
- **App home vs workspace**: `apphome.ts` gestisce la separazione tra cartella d'installazione (asset, config, memoria) e cartella di lavoro (file tool). `TSUKA_HOME` env var override.
- **Streaming**: provider supporta stream con `onChunk`, `thinkParser` per `<think>` tags. StreamRenderer gestisce UI mostrando il ragionamento in grigio dimmed (stile opencode) e il contenuto in bianco.
- **Server auto-discovery**: all'avvio scansiona provider, priorità a modello già caricato in RAM. Fallback su qualsiasi server locale vivo.
- **Self-authoring tool**: agenti possono creare tool JS via `create_tool`, sandbox `vm` + blocklist, hot-registrati.
- **Orchestrated team mode**: se un team ha `"mode": "orchestrated"` e un `orchestrator` con ruolo `supervisor`, l'orchestrator decide dinamicamente chi lavora a ogni turno (`AGENTE: @nome` / `FINE`).
- **Goal orchestrator (`/goal`)**: seleziona DINAMICAMENTE gli agenti da TUTTI i personaggi disponibili, assegna compiti e coordina l'esecuzione. Supporta blocchi `PARALLELO` per sotto-compiti indipendenti eseguiti con `Promise.all`.
  - **Condensed history**: dopo ogni turno, l'output dell'agente viene condensato solo se >1500 char, mantenendo un summary significativo (non un one-liner). I dettagli vengono salvati in memoria persistente.
  - **Context bar duale**: prima dell'agente mostra stima (usa prompt tokens reali dell'agente precedente se disponibili). Dopo l'agente mostra il peak reale (`promptTokens`) misurato dall'ultimo round LLM.
  - **Nessun early break**: il piano dell'orchestrator viene eseguito completamente — tutti gli step vengono eseguiti inclusa la revisione finale del supervisore. `STATO: COMPLETATO` non interrompe il piano.
  - **Task instructions**: ogni agente riceve istruzioni esplicite di ispezionare i file del workspace creati dagli agenti precedenti (`list_dir`, `read_file`).
  - **Stats summary**: a fine goal mostra Out tok / Ctx tok / Tot tok / Tempo / Velocità per ogni agente + totali cumulativi.
  - **Workspace isolati nel blocco PARALLELO (T3.2)**: ogni branch scrive in una cartella di staging propria (`workspace/parallel-<n>/` sotto l'app home, `src/core/parallelWorkspace.ts`), attivata come jail temporanea via `withWorkspaceOverride` (AsyncLocalStorage, `src/tools/impl/utils.ts`) — non nella workspace reale. A fine blocco i file vengono uniti: stesso path con contenuto diverso tra branch → conflitto segnalato, nessuna sovrascrittura silenziosa (il file principale, anche se preesistente, resta intatto). Output console bufferizzato per branch (`src/core/logBuffer.ts`) e flushato in ordine a fine blocco, con uno spinner unico nel frattempo — le scritture concorrenti non si interfogliano più.
- **Blackboard di run (T6.2)**: `src/core/blackboard.ts` — stato condiviso di UN SOLO run `/team` o `/goal` (decisioni prese, artefatti prodotti, punti aperti), scritto/letto dagli agenti con i tool `post_note(key, value)` / `read_notes(prefix?)`, offerti nello stesso punto di `report_status` (`runMemberTurn`), quindi in tutte le modalità `/team` e in ogni step di `/goal` — non nella chat normale. Confine netto e voluto rispetto agli altri due livelli di stato del progetto: **history** = ciò che è stato detto (`teamMessages`); **memoria** = ciò che resta fra le sessioni (`MemoryStore`); **blackboard** = stato di QUESTO run, muore col run — non scrive mai in `MemoryStore`. Isolamento fra run concorrenti via `AsyncLocalStorage` (`Blackboard.withRun`, stesso meccanismo di `withWorkspaceOverride`/`logBuffer.ts`): il `runId` viaggia nel contesto asincrono, non in una variabile globale — un singolo run (incluso il blocco `PARALLELO` di `/goal`, i cui branch sono annidati nello stesso `withRun` e quindi condividono la blackboard) resta isolato da altri run distinti eseguiti in `Promise.all` nello stesso processo. `handleTeam` (`team.ts`) crea un run per workflow e include lo `snapshot()` finale nel campo `blackboard` del report JSON in `workflow_logs/` (`workflowLog.ts`); `handleGoal` (`goal.ts`) crea e propaga il run allo stesso modo (nessun workflow log per `/goal`, quindi nessuno snapshot scritto lì). La blackboard è liberata a fine run (`Blackboard.endRun`): non sopravvive, non c'è accumulo tra `/team`/`/goal` successivi in una stessa sessione REPL.
- **Inter-agent messages**: tool `send_message(agent, message)` per comunicazione diretta tra agenti nel team. La coda è in `messageQueue.ts`.
- **Hybrid mode**: se un team ha `discussionRounds > 0`, dopo ogni round di lavoro si tiene una discussione stile `/call` (senza tool). Con `voting: true` i membri votano `APPROVO/MODIFICARE/RIFIUTO` — se tutti approvano, il task è completato.
- **Sub-agent spawning**: tool `spawn_agent(task, charName?)` per creare agenti temporanei durante un turno di lavoro. Richiede tier MEDIUM.
- **Pipeline mode**: se un team ha `"mode": "pipeline"`, gli agenti lavorano in sequenza lineare (catena di montaggio), ognuno perfeziona l'output del precedente. Supporta l'integrazione di `RunController` (`src/core/loop.ts`): se una stazione o il team specifica un `acceptance` (es. exit 0 di un comando shell, file esistente, JSON valido), la stazione esegue un loop di verifica e correzione guidato dalle issue.
- **RunController & rilavorazione guidata dal supervisore (T6.3 & T6.4)**: `src/core/loop.ts` implementa il controllore di ciclo esecutivo con verifiche oggettive e detect anti-stallo (`no_progress`). In `/goal`, se il supervisore finale evidenzia difetti nel codice o nei requisiti, innesca automaticamente un ciclo di rilavorazione guidato dal suo feedback sullo step precedente, risolvendo il gap "Nessun early break".
- **maxRoundsPerMember**: limita i turni per singolo membro in modalità round-robin.
- **Workflow logs**: ogni workflow `/team` salva un report JSON in `workflow_logs/`.
- **Condensed history**: la cronologia condivisa salva solo i messaggi assistant (sintesi), non i tool output grezzi, risparmiando contesto.
- **Goal context condensation**: il goal orchestrator condensa ulteriormente la history tra un agente e l'altro: sostituisce gli assistant message con riferimenti brevi e salva i dettagli in memoria persistente (gestione automatica contesto).
- **Smart compression automatica** (`Agent.compressHistory`): quando il contesto supera il 75% del limite, i messaggi più vecchi (esclusi system + ultimi 4) vengono compattati in un riassunto generato dall'LLM. I dettagli sono salvati in MemoryStore per `recall_memory`. Attivo dopo ogni turno utente nel REPL.
- **ContextTracker** (`contextTracker.ts`): registro singleton di tutte le attività degli agenti (timestamp, personaggio, token out/ctx, azione). Usato da `/context` per mostrare la cronologia attività e da team/goal per tracciare gli interventi.
