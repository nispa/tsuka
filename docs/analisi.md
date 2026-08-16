# Analisi architetturale di TSUKA

> **TSUKA** (TypeScript Unified Kit for Agents) — framework multi-agente CLI in TypeScript.
> Documento di analisi generato da Geordi, basato sull'ispezione diretta del codice sorgente.

## Architettura generale

```
CLI (src/cli/) → Agent (src/core/agent.ts) → Provider LLM (Ollama/OpenRouter/llama-server)
                    ↓
        ToolRegistry (src/tools/registry.ts) → src/tools/impl/*.ts
                    ↓
        PermissionManager (src/safety/permissions.ts)
```

## Componenti principali

### 1. Persona = Ruolo × Tratto × Personaggio (tutto JSON, senza codice)

- `roles/*.json` — competenze + elenco `allowedTools` (es. `developer`, `security_auditor`)
- `traits/*.json` — stile comunicativo
- `characters/*.json` — preset nominati che collegano ruolo+tratto (es. `geordi.json`)
- Il system prompt viene assemblato a runtime con solo i tool consentiti dal ruolo → minimo overhead di token

### 2. Ciclo agentico (ReAct loop) — `src/core/agent.ts` (~700 righe, il cuore)

- `run()`: loop `while (!isDone)` che invia messaggi+tool all'API, esegue le tool call richieste, reinserisce gli output come messaggi `role: 'tool'`, e ripete
- `MAX_TOOL_ROUNDS = 15` come guardia anti loop-infinito
- Gestione contesto:
  - `pruneHistory()` — taglio per numero messaggi + budget token stimati, con punto di taglio che non orfana mai un messaggio `tool` dal suo `tool_call`
  - `compressHistory()` — riassunto LLM dei messaggi vecchi al 75% del budget (con fallback di troncamento se la chiamata LLM fallisce)
- Calibrazione dinamica del rapporto caratteri/token su `promptTokens` reali dell'API (media mobile, smoothing 0.2)
- Persistenza dei ragionamenti lunghi su `memory/thinking/` (T9.12): il pensiero completo va su file, in memoria resta solo un puntatore corto
- Nudge anti "vicolo cieco" (T9.10): se un turno di team produce solo testo senza tool call né marker di stato, una sola volta il modello viene spinto ad agire (con `reasoningEffort: 'none'` per il retry, CoT Recovery T11.10)
- Cascata del reasoning effort (T8.10): override chiamante → personaggio → ruolo → default config; il pin globale `/effort` (T8.14) vince sopra la cascata

### 3. Tool e tier di capacità — `src/tools/registry.ts`

- Auto-discovery hot-plug: ogni `.ts` in `src/tools/impl/` + schema in `tools_schemas/*.json` (cache con invalidazione su mtime)
- `getModelTier()`: usa il profilo misurato da `/benchmark` (`models_profile.json`) o ricade sull'euristica del nome (`9b`→small, `27b`→medium, `70b`→large). I tool hanno un `requiredTier`: un modello SMALL non vede `execute_command`, `create_tool`, `spawn_agent`
- `hasNativeFunctionCalling()`: se il profilo misura toolCalling ≥ 0.9, il modello legge direttamente l'array `tools` dell'API e l'elenco testuale dei tool viene omesso dal prompt (risparmio di contesto)
- Validazione argomenti contro JSON Schema prima dell'esecuzione + `jsonRepair.ts` che ripara tool call JSON malformati dei modelli locali
- `create_tool`: gli agenti possono scrivere tool JavaScript che vengono registrati a caldo in una sandbox `vm` (con blocklist di pattern); i tool registrati a runtime sono `alwaysAllow` (bypassano il filtro allowedTools del ruolo, perché la creazione è già stata approvata dall'utente)

### 4. Sicurezza — `src/safety/permissions.ts`

- 3 tier:
  - **SAFE** — eseguito immediatamente (lettura, ricerca, memoria, web)
  - **RESTRICTED** — prompt `[y/N/always]` per scritture/modifiche file
  - **DANGEROUS** — `execute_command`, sempre manuale, mai aggirabile
- I prompt interattivi passano da una coda interna (`enqueuePrompt`) per non sovrapporsi quando più agenti girano in parallelo (blocco PARALLELO di `/goal`)
- Workspace jail opzionale (`workspaceRoot` in `tsuka.config.json`), limiti I/O (file >5MB rifiutati, output 50KB)
- `setAllowAllWrite()` per workflow autonomi (`/goal`, `/team`)

### 5. Workflow multi-agente — `src/cli/commands/`

- `/call` — dibattito in conferenza tra personaggi
- `/team` — collaborazione sequenziale a turni su workspace fisico condiviso, con protocollo `STATO: COMPLETATO/DA_CONTINUARE/FALLITO`
- `/goal` — orchestratore dinamico (~38KB): seleziona agenti, pianifica, esegue con strategie in `strategies/` (pipeline, roundRobin, orchestrated, hybrid), rami paralleli con workspace separati (`parallelWorkspace.ts`) e merge
- `runLoop()` in `src/core/loop.ts` — RunController esegui→verifica→correggi con acceptance criteria oggettivi (file esiste, JSON valido, comando exit 0) e firma SHA-256 anti-stallo (stallo se risposta+file identici al turno precedente)
- `blackboard.ts` — lavagna condivisa per note tra agenti; `messageQueue.ts` — messaggi tra membri

### 6. Memoria persistente — `src/core/memory.ts`

- `memory/memory.json` condiviso da tutti gli agenti, sopravvive ai restart
- Fatti con kind (`fatto`/`decisione`/`lezione`/`run`), scope per workspace (slug + hash del path), pinning, eviction a punteggio (i `run` cadono per primi, peso 0; le `lezione` sopravvivono per ultime, peso 3)
- Iniettata automaticamente nei prompt via `formatForPrompt()`
- `lezione` e `decisione` sono condivisibili per costruzione anche quando il filtro per source è attivo

### 7. Provider — `src/core/provider.ts`

- Client OpenAI-compatible (funziona con Ollama, llama-server, OpenRouter)
- Doppio timeout: `FIRST_TOKEN_TIMEOUT_MS` (2 min, si azzera al primo token) + `MAX_GENERATION_MS` (orologio sull'intera generazione, non si azzera mai)
- Retry (max 3) con distinzione tra errore JSON tool call (glitch di campionamento, retry immediato) e errore di rete
- Parsing live dei tag `<think>` / `reasoning_content` (streaming in grigio tenue, `thinkParser.ts`)
- `Error.partialReasoning` (T9.12): il pensiero già prodotto prima di un timeout/errore viene propagato all'agente per la persistenza

### 8. CLI e REPL — `src/cli/`

- `index.ts` — punto d'ingresso: caricamento `.env` dalla home app, lock del raw mode (anti-wedge Windows), creazione provider/registry/permission manager, ciclo REPL
- `shared.ts` — caricamento role/trait/character e assemblaggio del system prompt (`loadSystemPrompt`)
- `stream.ts` — `StreamRenderer`: rendering live dello streaming (ragionamento + contenuto)
- `statusline.ts` — barra di stato (token, tempo, t/s) con `emergencyReset()` su Ctrl+C
- `apphome.ts` — separazione tra **home app** (asset: roles, traits, config, memoria — sempre nella cartella d'installazione o in `TSUKA_HOME`) e **workspace** (cartella da cui si lancia `tsuka`, dove operano i tool file con path relativi)
- `effortControl.ts` — pin globale del reasoning effort (`/effort`)
- `contextBudget.ts` — calcolo del reasoning budget dinamico (T11.10)

### 9. Configurazione — `tsuka.config.json`

- `activeProvider` + `providers` (llamaserver, unsloth, ollama, openrouter)
- `maxHistoryTokens` (30000), `llmTimeoutMs`
- `webSearch.provider` (duckduckgo/google/tavily)
- `activeRole`, `activeTrait`, `activeCharacter`

### 10. Test

- 43 suite, 200+ asserzioni (`tests/`, runner `tests/run_tests.ts`)
- Coverage: roles, memory, fingerprinting, self-authoring, platform, generation timeout
- `prepublishOnly` esegue build + test prima di ogni publish

## Note di design rilevanti

1. **Derivazione, mai hard-coding**: i blueprint dei team per `/goal` sono letti dai `teams/*.json` realmente installati, non da elenchi fissi
2. **Profili misurati, non indovinati**: il tier di un modello viene misurato da `/benchmark` (hash del test set invalida i profili obsoleti), con fallback euristico
3. **Coppie tool_call/tool sempre coerenti**: prune, compressione e interruzione utente gestiscono tutti il rischio di orfani (l'API rifiuterebbe la richiesta)
4. **Costo fisso del prompt ridotto**: gli schemi tool sono contati nel budget di contesto (T8.9) e l'elenco testuale dei tool viene omesso per i modelli con function calling nativo affidabile
5. **Nessun loop infinito per design**: `MAX_TOOL_ROUNDS`, nudge una tantum, firma anti-stallo nel RunController, eviction della memoria