# 📜 History — TSUKA

> **Nota di rebranding (2026-07-19)**: il progetto precedentemente chiamato *PowerHarness* è stato rinominato **TSUKA — TypeScript Unified Kit for Agents**. Le voci storiche precedenti mantengono il vecchio nome per fedeltà cronologica.

Registro cronologico degli interventi effettuati sulla codebase.

---

## 2026-07-19 — Code review completa e piano di ottimizzazione

### Analisi effettuata
Lettura integrale della codebase (~2.500 righe TypeScript in 20 file sotto `src/`), verifica compilazione (`tsc --noEmit` pulito), controllo di coerenza tra tool (`src/tools/impl/`), schemi (`tools_schemas/`), configurazioni JSON (`roles/`, `traits/`, `characters/`, `teams/`) e documentazione.

### Esito
Codebase **ben strutturata ma non ottimizzata**. Individuati:
- **7 bug reali** (di cui 2 con impatto sicurezza/integrità dati)
- **4 problemi di performance** (I/O ridondante su hot-path, statistiche token errate, nessuna gestione context window)
- **3 lacune di sicurezza/robustezza** (path assoluti non confinati, I/O illimitato, nessuna validazione argomenti tool)
- **Migliorie di qualità** (duplicazioni, monolite CLI da 1023 righe, dotenv ripetuto, mojibake negli schemi)

### Deliverable
Creato **`OPTIMIZATION_PLAN.md`**: piano in 4 fasi / 18 task, con file e righe esatte, effort stimati e criteri di completamento per fase.

---

## 2026-07-19 — FASE 1: Bug fix critici ✅ (7/7 task)

| ID | File modificato | Intervento |
|----|-----------------|-----------|
| T1.1 | `src/tools/impl/editFile.ts` | Fix corruzione silenziosa: `String.replace` con stringa interpretava i pattern speciali (`$&`, `$1`, `` $` ``) nel `replacementContent`. Sostituito con replacer function `() => args.replacementContent`. |
| T1.2 | `src/cli/index.ts` | Rimosso hack hardcoded `memberName === "lola" ? "sensual_diva"` nel comando `/team`. Aggiunto helper `resolveCharacter()` che risolve un personaggio per nome file **o** per `aiName` (case-insensitive), come già fatto in `/call`. |
| T1.3 | `src/core/config.ts`, `src/tools/impl/webSearch.ts` | Stop riscritture spurie di `harness.config.json`: `load()` ora salva **solo** quando applica default mancanti (flag `dirty`). `webSearch` usa un singleton `ConfigManager` con invalidazione su mtime, invece di istanziare (e riscrivere) a ogni ricerca. |
| T1.4 | `src/tools/impl/executeCommand.ts`, `src/tools/impl/browseUrl.ts` | Aggiunti timeout: watchdog 120s con `child.kill()` per i comandi PowerShell (prima potevano bloccare l'agente all'infinito); `AbortController` 30s su `fetch` in `browse_url` con messaggio di timeout dedicato. |
| T1.5 | `src/core/agent.ts` | Aggiunta guardia anti loop-infinito: `MAX_TOOL_ROUNDS = 15` cicli di tool per richiesta. Al superamento: stop con messaggio esplicito; la cronologia resta coerente (ogni `tool_call` ha già ricevuto il suo messaggio `tool`). |
| T1.6 | `src/tools/impl/getPsInfo.ts` | Categoria `env`: escluse dal dump le variabili sensibili via regex PowerShell `KEY\|SECRET\|TOKEN\|PASSWORD\|PASSWD\|PWD\|CREDENTIAL\|AUTH` (case-insensitive) — prima le API key finivano nel contesto del modello. |
| T1.7 | root | Eliminato `leaks.txt` (artefatto di sessione precedente, non pertinente al progetto). |

### Verifica
- `npx tsc --noEmit` → **pulito**
- Nuovo `test_phase1_fixes.ts` (convenzione `test_*.ts` del progetto): **5/5 test passati**
  - replacement con `$&_$1_$\`_END` inserito letteralmente
  - config non riscritto su load pulito
  - `execute_command` funzionante su comando normale
  - variabile `*_KEY` di test esclusa dal dump env; dump funzionante per variabili innocue
- `test_team.ts` esistente → **passa** (nessuna regressione su `/team`)

### Note
- Al primo avvio della REPL successivo all'intervento, `harness.config.json` viene aggiornato **una tantum** con i campi `activeRole`/`activeTrait`/`activeCharacter` (self-healing previsto), poi mai più riscritto se non su modifiche reali.

### Prossimi passi (da OPTIMIZATION_PLAN.md)
- **Fase 2 — Performance**: cache schemi tool (T2.1), token reali da `usage` API (T2.2), pruning cronologia (T2.3), cache JSON ruoli/tratti/personaggi (T2.4)
- **Fase 3 — Sicurezza**: jail workspace (T3.1), limiti dimensione I/O (T3.2), validazione argomenti tool (T3.3)
- **Fase 4 — Qualità**: utility condivise (T4.1), refactoring CLI (T4.2), cleanup (T4.3), test con asserzioni (T4.4)

---

## 2026-07-19 — FASE 2: Performance ✅ (4/4 task)

| ID | File modificato | Intervento |
|----|-----------------|-----------|
| T2.1 | `src/tools/registry.ts` | Cache degli schemi JSON con invalidazione su **mtime**: `loadToolSchema()` non rilegge più dal disco a ogni chiamata (prima: ~20 letture+parse per iterazione del loop agentico). Rileva comunque le modifiche a caldo dei file. Riscritto `listForLLM` con ciclo singolo (prima chiamava `loadToolSchema` 2 volte per tool: in `filter` e in `map`). |
| T2.2 | `src/core/provider.ts` | Statistiche token **reali**: richiesto `stream_options: { include_usage: true }` nello streaming e letto `usage.completion_tokens` (chunk finale / risposta non-stream). Fallback alla stima precedente se il provider non fornisce usage. Validato live su Ollama: `{"tokenCount":95,"tokensPerSecond":2.6}` reali dall'API. |
| T2.3 | `src/core/agent.ts`, `src/core/config.ts`, `src/cli/index.ts` | **Pruning cronologia**: nuovo `Agent.pruneHistory()` invocato prima di ogni chiamata API — conserva system prompt + ultimi N-1 messaggi con **taglio sicuro** (mai un messaggio `tool` orfano del suo `tool_call`, altrimenti l'API rifiuterebbe la richiesta). Limite configurabile via `maxHistoryMessages` in `harness.config.json` (default 40, min 4), cablato in `recreateAgent()` e negli agenti temporanei di `/team`. |
| T2.4 | `src/cli/index.ts` | Cache generica `loadJsonFile<T>()` con invalidazione su mtime applicata a `loadRole`/`loadTrait`/`loadCharacter`/`loadTeam` (prima rilette dal disco a ogni comando slash e a ogni messaggio utente). Compatibile con `/rename-char` e `create_role` (la scrittura cambia mtime → invalidazione automatica). |

### Verifica
- `npx tsc --noEmit` → **pulito**
- Nuovo `test_phase2_fixes.ts`: **7/7 test passati** (cache hit/invaligazione schemi, tier pruning intatto, pruning con coppie tool_call-tool integre, system prompt preservato)
- Test esistenti `test_tier_pruning.ts` e `test_roles.ts` → **passano** (nessuna regressione)
- Sonda live Ollama → statistiche token reali confermate

### Prossimi passi
- **Fase 3 — Sicurezza**: jail workspace (T3.1), limiti dimensione I/O (T3.2), validazione argomenti tool (T3.3)
- **Fase 4 — Qualità**: utility condivise (T4.1), refactoring CLI (T4.2), cleanup (T4.3), test con asserzioni (T4.4)

---

## 2026-07-19 — FASE 3: Sicurezza & robustezza ✅ (3/3 task)

| ID | File modificato | Intervento |
|----|-----------------|-----------|
| T3.1 | `src/core/config.ts`, `src/tools/impl/utils.ts` (nuovo), `writeFile.ts`, `editFile.ts`, `deleteFile.ts`, `readFile.ts`, `listDir.ts`, `grepSearch.ts` | **Jail workspace** opzionale: nuova proprietà `workspaceRoot` in `harness.config.json` → se impostata, tutti i path dei file tool (write/edit/delete/read/list/grep) sono vincolati a quella directory e alle sue sottocartelle. Nuova funzione `resolveSafePath()` in `utils.ts` centralizza il controllo e lancia un errore descrittivo per path fuori jail. Se non configurata: comportamento immutato (nessuna restrizione). Le funzioni duplicate `resolvePath` e `isBinaryFile` sono state **centralizzate** in `utils.ts` e rimosse dai 6 tool (primo passo verso T4.1). |
| T3.2 | `src/tools/impl/executeCommand.ts`, `readFile.ts`, `grepSearch.ts` | **Limiti dimensione I/O**: `read_file` rifiuta file >5MB con messaggio che suggerisce di usare `startLine`/`endLine`; `grep_search` salta file >5MB senza interrompere la scansione; `execute_command` tronca l'output restituito al modello a 50KB (lo streaming su console rimane illimitato), preservando l'ultima porzione significativa. |
| T3.3 | `src/tools/registry.ts` | **Validazione argomenti** contro JSON schema all'esecuzione: nuova funzione `validateToolArgs()` verifica che tutti i campi `required` siano presenti e che i tipi base (`string`, `integer`, `number`) corrispondano. Il controllo è applicato in `executeTool()` prima della verifica dei permessi, così il modello riceve un errore chiaro e può autocorreggersi invece di causare eccezioni JS oscure. |

### Verifica
- `npx tsc --noEmit` → **pulito**
- Nuovo `test_phase3_fixes.ts`: **9/9 test passati** (path dentro/fuori jail, limite dimensione file, output comando intatto dopo troncamento, validazione required/tipi/args-non-oggetto)
- Regressione completa: **tutti i test esistenti passano** (Fase1 5/5, Fase2 7/7, memoria 8/8, Fase3 9/9, roles, tier_pruning, characters, traits)

### Prossimi passi
- **Fase 4 — Qualità**: utility condivise già parzialmente anticipata in T3.1 (`utils.ts` con `resolvePath`, `isBinaryFile`, `resolveSafePath`); restano: refactoring CLI monolite (T4.2), cleanup finale (T4.3), test con asserzioni node:test (T4.4)

---

## 2026-07-19 — FASE 4: Qualità & manutenibilità ✅ (4/4 task)

| ID | Area | Intervento |
|----|------|-----------|
| T4.1 | Utility condivise | Estratto `listAvailableCharacters()` e `listAvailableItems<T>()` da 3 scansioni duplicate di `characters/`. Centralizzati in `cli/shared.ts` con tutti i loader JSON (`loadRole`, `loadTrait`, `loadCharacter`, `loadTeam`, `loadJsonFile`), le interfacce (`RoleConfig`, `TraitConfig`, `CharacterConfig`, `TeamConfig`) e il builder `loadSystemPrompt`. Eliminate tutte le definizioni duplicate da `cli/index.ts`. |
| T4.2 | Refactoring CLI | **Monolite** `cli/index.ts` ridotto da ~1098 a ~440 righe. Switch statement sostituito con dispatch map: 6 comandi inline (exit, clear, help, reset, info, memory, forget) + 10 handler estratti in moduli `cli/commands/`: `session.ts` (info, reset), `provider.ts` (provider, models, use, searchEngine), `persona.ts` (character, renameChar, role, trait), `call.ts`, `team.ts`. Nuovo tipo `CommandCtx` e `CommandHandler` in `commands/types.ts`. Zero circular dependencies grazie a `cli/shared.ts`. |
| T4.3 | Cleanup | **4 chiamate duplicate** `dotenv.config()` ridotte a 1 sola in `cli/index.ts`. `registry?: any` → tipizzato con `ToolRegistry`. Aggiunto `.gitignore` (node_modules, dist, .env, *.log, memory/). File `test_*.ts` spostati dalla root a `tests/` con path import aggiornati (14 file). Package.json: nuovi script `test`, `test:roles`, `test:memory`. |
| T4.4 | Test runner | Nuovo `tests/run_tests.ts` esegue 8 suite come child process e riporta risultati aggregati (PASS/FAIL + conteggio test + tempo). Eseguibile via `npm test` (~2s su tutte le suite). |

### Verifica
- `npx tsc --noEmit` → **pulito**
- `npm test` → **8/8 suite OK** (phase1 5, phase2 7, memory 8, phase3 9, roles, tier_pruning, characters, traits)
- `npx tsx src/cli/index.ts` → REPL avviabile normalmente

### Riepilogo complessivo interventi
- **4 Fasi completate** (Fase 1 bug fix, Fase 2 performance, Fase 3 sicurezza, Fase 4 qualità)
- **1 Feature nuova** (memoria condivisa persistente tra sessioni)
- **File modificati**: 18 file TypeScript esistenti modificati, 7 nuovi file creati
- **File eliminati**: `leaks.txt`
- **Totale righe TS**: ~3.100 → ~2.700 (eliminazione duplicazioni, refactoring)
- **Test totali**: 37 regression test passati in tutte le suite
- **Bug risolti**: 7 (Fase 1)
- **Miglioramenti performance**: 4 (Fase 2)
- **Miglioramenti sicurezza**: 3 (Fase 3)
- **Miglioramenti qualità**: 4 (Fase 4)
- **Nuova feature in valutazione**: memoria condivisa persistente tra sessioni (design proposto in discussione)

---

## 2026-07-19 — FEATURE: Memoria Condivisa Persistente ✅ (richiesta utente)

Memoria comune a tutti gli agenti (chat principale, `/call`, `/team`), salvata su disco in `memory/memory.json` e **preservata tra le sessioni**. Decisioni progettuali concordate: salvataggio **solo via tool** (nessun auto-riassunto a `/exit`), `save_memory` con livello **SAFE**.

| Componente | File | Dettaglio |
|-----------|------|-----------|
| MemoryStore | `src/core/memory.ts` (nuovo) | Singleton con cache mtime (pattern Fase 2), cap FIFO configurabile (default 200), ricerca keyword (AND, case-insensitive), `formatForPrompt()` compatto (max 600 char) per l'iniezione nel system prompt. Fix in corso: rimosso floor arbitrario di 10 sul cap che impediva trimming sotto soglia. |
| Tool `save_memory` | `src/tools/impl/saveMemory.ts` + `tools_schemas/save_memory.json` | SAFE, max 500 caratteri, auto-scoperto dal registry (zero modifiche al core). |
| Tool `recall_memory` | `src/tools/impl/recallMemory.ts` + `tools_schemas/recall_memory.json` | SAFE, query keyword o ultimi N (default 10, max 50). |
| Iniezione prompt | `src/cli/index.ts` | Sezione "Memoria condivisa persistente" in `loadSystemPrompt()` → automaticamente condivisa da chat, `/call` e `/team`. Hint d'uso dei tool di memoria solo se il ruolo li ha in `allowedTools`. |
| Comandi REPL | `src/cli/index.ts`, `src/cli/ui.ts` | `/memory` (ultimi 20 con id/data/sorgente), `/forget <id\|all>` (con conferma per `all`), voci aggiunte a `/help`. |
| Ruoli | `roles/*.json` (4 file) | Aggiunti `save_memory` e `recall_memory` a developer, researcher, entertainer, sysadmin. |
| Documentazione | `README.md` | Nuova sezione feature #5 + comandi slash. |

### Verifica
- `npx tsc --noEmit` → **pulito**
- Nuovo `test_memory.ts`: **8/8 test passati** (persistenza tra istanze, ricerca keyword, cap FIFO, rimozione, sezione prompt compatta, auto-discovery dei tool, end-to-end save+recall, rifiuto contenuto vuoto)
- Regressioni: `test_phase1_fixes.ts` 5/5, `test_phase2_fixes.ts` 7/7, `test_roles.ts` → **tutti verdi**

---

## 2026-07-19 — FASE 5: Innovazione ✅ (Fingerprinting + Self-Authoring + Cross-Platform)

Su richiesta dell'utente, implementate le due direzioni innovative scelte (1+2) più il supporto multi-sistema.

### X1 — Cross-Platform (Windows primario, Linux/macOS supportati)

| File | Intervento |
|------|-----------|
| `src/core/platform.ts` (nuovo) | Astrazione shell: `getShellConfig()` restituisce eseguibile/argomenti/opzioni/kill per la piattaforma corrente. Windows → `powershell.exe -NoProfile -Command`; POSIX → `/bin/sh -c` con `detached: true` e kill dell'intero process group (`process.kill(-pid, 'SIGKILL')`). |
| `src/tools/impl/executeCommand.ts` | Riscritto su `getShellConfig()`: stesso codice per tutte le piattaforme; timeout 120s e troncamento 50KB preservati. |
| `src/tools/impl/getPsInfo.ts` | Comandi per piattaforma: Windows invariato (cmdlet PS); Linux → `ps aux --sort=-%mem`, `systemctl`, `df -h`, `printenv`; macOS → `ps aux -r`, `launchctl`, `df -h`. Filtro env sensibili lato PowerShell su Windows e lato JS su POSIX. |

### X2 — Capability Fingerprinting (tier MISURATO, non indovinato)

| File | Intervento |
|------|-----------|
| `src/core/modelProfile.ts` (nuovo) | `runBenchmark()`: 3 micro-test oggettivi per modello — instruction following (risponde esattamente "PONG"), output JSON (parse + tipi), function calling (tool call + argomenti validi, punteggio 0/0.5/1) — più misura tok/s reali. `computeTier()` mappa i punteggi in small/medium/large. Profili persistiti in `models_profile.json` con cache mtime. |
| `src/tools/registry.ts` | `getModelTier()` ora controlla prima il profilo misurato, poi ricade sull'euristica del nome. |
| `src/cli/commands/provider.ts` | Nuovo handler `/benchmark [modello\|all]` con spinner di progresso per i 3 test, stampa profilo (tier, 3 punteggi, tok/s), ricreazione agente col nuovo tier. |
| `src/cli/index.ts`, `ui.ts` | `/benchmark` registrato nel dispatch; `/info` mostra il tier misurato se presente; voce in `/help`. |

**Validazione live su Ollama** (`satgeze/qwenpaw-9b-heretic-1m`): instruction 1, JSON 1, toolCalling 1, 4.7 tok/s → **tier LARGE misurato**. L'euristica per nome lo classificava SMALL (9b): il fingerprinting ha corretto un errore reale dell'euristica, sbloccando `execute_command` e `create_tool` per un modello che li gestisce perfettamente.

### X4 — Self-Authoring dei Tool (`create_tool`)

| File | Intervento |
|------|-----------|
| `src/tools/impl/createTool.ts` (nuovo) + `tools_schemas/create_tool.json` | L'agente genera il corpo `execute(args)` in JS; l'harness lo incapsula in un modulo CommonJS, lo **valida in sandbox `vm`** prima di scrivere su disco, e applica una **blocklist** (`child_process`, `eval`, `Function`, `process.exit`, `process.env`, `require`). Tool generati: mai DANGEROUS, mai sopra tool core (conflitto nome normalizzato camelCase↔snake_case + registry). File in `impl/<nome>.js` + schema JSON, **backup** in `tools_backup/` prima di ogni sovrascrittura. |
| `src/tools/registry.ts` | Nuovo `ToolExecutionContext` passato a `execute()` (backward compatible); `register(tool, { alwaysAllow })` per i tool approvati a runtime (bypassano il filtro ruolo); `unregister()` per la sostituzione a caldo. |
| Registrazione a caldo | Il tool creato è **subito eseguibile** nella sessione; al riavvio entra nell'auto-discovery standard (soggetto ad `allowedTools`). |
| `roles/developer.json`, `roles/sysadmin.json` | Aggiunto `create_tool` agli allowedTools. |

**Bug trovato e risolto in corso d'opera**: il controllo anti-sovrascrittura confrontava `read_file` con il file `read_file.ts`, ma il file core è `readFile.ts` (camelCase) → un test creò un `read_file.js` avvelenato che entrava in conflitto col tool core all'avvio. Fix: controllo normalizzato dei basename + ripristino manuale dei file core (schema `read_file.json`).

### Verifica
- `npx tsc --noEmit` → **pulito**
- Nuovi test: `test_fingerprinting.ts` 7/7, `test_self_authoring.ts` 9/9, `test_platform.ts` 5/5
- Suite completa `npm test` → **11/11 suite OK** (50+ assertion individuali)
- Benchmark live Ollama → profilo reale salvato e tier applicato

### Riepilogo complessivo aggiornato
- **5 Fasi completate** (bug fix, performance, sicurezza, qualità, innovazione)
- **2 Feature nuove** (memoria condivisa persistente, self-authoring tool)
- **1 Capacità distintiva**: capability fingerprinting — tier dei tool *misurato*, raro negli harness locali
- **Piattaforme**: Windows (primario) + Linux/macOS (sperimentale)

---

## 2026-07-19 — REBRANDING: PowerHarness → TSUKA ✅

Il nome "PowerHarness" era già occupato (pettorina per cani). Nuovo nome scelto: **TSUKA — TypeScript Unified Kit for Agents**, da 柄 (*tsuka*, l'impugnatura della katana: la presa a cui si attacca la lama — i modelli sono le lame, TSUKA è ciò che permette di brandirle). Verificata disponibilità: `tsuka-cli` libero su npm (`tsuka` occupato da un pacchetto abbandonato del 2022).

| Area | Intervento |
|------|-----------|
| `package.json`, `package-lock.json` | `name` → `tsuka`, `description` → "TSUKA — TypeScript Unified Kit for Agents: multi-agent CLI harness" |
| `src/cli/ui.ts` | Nuova ASCII art del banner (TSUKA) + tagline con il kanji 柄 |
| Stringhe CLI | `agent.ts`, `index.ts`, `registry.ts`, `tests/run_tests.ts`: "PowerHarness" → "Tsuka" |
| **Config** | `harness.config.json` → **`tsuka.config.json`** con migrazione automatica legacy in `config.ts` (rename al primo avvio); `CONFIG_PATH` esportato e usato da `webSearch.ts`; test aggiornati |
| Documentazione | `README.md` (EN) e `README-it.md` (IT) rebrandizzati con backronym e spiegazione del nome; `docs/*.md` (4 file) aggiornati; `LICENSE` copyright → TSUKA; `OPTIMIZATION_PLAN.md` header |
| Artefatti | `dist/` escluso (rigenerato da `npm run build`) |

### Verifica
- `npx tsc --noEmit` → pulito; suite `npm test` completa dopo il rename

---

## 2026-07-19 — FIX: Gap nei tool dei personaggi (report utente) ✅

**Sintomo**: chiedendo a Falco di controllare un sito web, rispondeva con uno *script PowerShell testuale* senza usare alcun tool.

**Diagnosi** (3 cause combinate):
1. Il ruolo `sysadmin` (Falco, Salvo, Piccione) **non aveva `browse_url`** tra gli allowedTools — impossibile aprire URL specifici, solo `web_search` per ricerche.
2. Il ruolo `developer` (Pippo) non aveva `web_search` (aveva solo `browse_url`).
3. Il prompt di `sysadmin` spingeva PowerShell come strumento primario, e i modelli piccoli tendono a rispondere con codice testuale invece di tool call.

**Fix applicati**:
| File | Intervento |
|------|-----------|
| `roles/sysadmin.json` | Aggiunto `browse_url` agli allowedTools |
| `roles/developer.json` | Aggiunto `web_search` agli allowedTools |
| `src/cli/shared.ts` | Nuova regola nelle linee guida generali: *"se esiste un tool adatto al compito, usalo SEMPRE; non rispondere MAI con script o codice testuale per compiti che un tool può svolgere"* |

**Validazione live** (`tests/test_falco_live.ts`, non inclusa nel runner perché richiede Ollama): Falco interpellato su `https://example.com` → chiama **`browse_url` correttamente** e risponde col contenuto reale della pagina ✔

**Lezione**: i personaggi erano "fatti male" solo nell'assegnazione dei tool — il check sistematico dei 4 ruoli ha confermato che researcher ed entertainer erano già corretti; solo sysadmin e developer avevano gap speculari (uno senza browse, l'altro senza search).

---

## 2026-07-19 — FIX: Loop di completamento per /team (report utente) ✅

**Sintomo**: i workflow `/team` facevano un solo giro (un turno per membro) e si fermavano senza risolvere il compito.

**Diagnosi** (3 problemi):
1. **Single pass**: un turno per membro, nessuna iterazione verso la soluzione.
2. **Nessun controllo di completamento**: il workflow terminava senza verificare se il compito era risolto.
3. **Bug latente da pruning**: l'estrazione dei messaggi di fine turno usava `slice(currentHistoryLength)`; se `pruneHistory()` (Fase 2) interveniva durante il run, gli indici slittavano e messaggi di lavoro andavano persi dalla cronologia condivisa.

**Fix applicati** (`src/cli/commands/team.ts` riscritto):
| Modifica | Dettaglio |
|----------|-----------|
| **Round iterativi** | Loop `for round in 1..maxRounds` con round completi di tutti i membri; `teamMaxRounds` configurabile in `tsuka.config.json` (default 3, getter `getTeamMaxRounds()` in `ConfigManager`) |
| **Protocollo STATO** | Ogni membro deve chiudere il turno con `STATO: COMPLETATO` (solo se verificato con i tool) o `STATO: DA_CONTINUARE`; rilevamento deterministico via regex sui messaggi assistant (`hasCompletionMarker()`, esportata per i test) → stop anticipato |
| **Prompt round-aware** | Round 1: attivazione normale; round 2+: *"il compito non è ancora completato, riprendi da dove è arrivato il team"* |
| **Fix slicing** | Estrazione messaggi via riferimento oggetto `lastSeeded` + `indexOf` (immune allo slittamento da pruning) |
| **Report finale** | Riflette lo stato reale: completato al round X (success) oppure limite round senza completamento (warning) |

**Verifica**: `tsc --noEmit` pulito; nuovo `tests/test_team_loop.ts` **8/8** (marker rilevato/ignorato correttamente, config default/custom, invariante indexOf dopo pruning); suite completa **12/12**.

---

## 2026-07-20 — UI CLI responsiva stile Claude Code (streaming live, reasoning, tool compatti) ✅

**Obiettivo** (richiesta utente): la CLI non dava alcun feedback durante la generazione — nessuno spinner, nessuno streaming visibile, nessuna indicazione di quando il modello "ragiona". Overhaul in stile Claude Code / opencode **senza migrare a Ink/ESM** (vincolo: restare su CommonJS + chalk 4 + ora 5 + ANSI).

**Strategia di rendering**: stream grezzo live → a fine risposta erase ANSI (`\x1b[nF\x1b[0J`) e repaint come pannello markdown definitivo. Niente markdown live (parse instabile su input incompleto); tutto l'ANSI è gated su `isTTY` (output in pipe resta pulito).

### Nuovi moduli
| File | Responsabilità |
|------|----------------|
| `src/core/thinkParser.ts` | `ThinkTagParser`: parser push stateful che separa lo stream nei canali `content`/`reasoning`, gestendo i tag `<think>` spezzati tra chunk (hold-back dei prefissi di tag) e i tag mai chiusi. `stripThinkBlocks()` per il path non-streaming. |
| `src/cli/statusline.ts` | `StatusLine`: riga di stato animata `◐ Thinking… (2.4s · 87 tok) · coda reasoning` fatta a mano (non ora: l'interval interno confligge con write interleaved). Cursore nascosto/ripristinato, `emergencyReset()` per SIGINT, no-op senza TTY. |
| `src/cli/stream.ts` | `StreamRenderer`: orchestratore condiviso da chat/`/call`/`/team`. Status → stream live → erase+repaint pannello + stats. Rendering tool compatto `● nome(args)` / `└ esito` con summarizer (fonti web_search, URL browse_url). |
| `src/core/agentEvents.ts` | Tipi `AgentEvent` (`tool_start`/`tool_end`/`round_continue`/`max_rounds`): il core emette eventi, non stampa più. |

### Modifiche
| File | Intervento |
|------|-----------|
| `src/core/provider.ts` | `onChunk` allargato a `(chunk, channel?)`; lettura di `delta.reasoning`/`reasoning_content` (OpenRouter); contenuto instradato nel `ThinkTagParser` → **la cronologia non contiene più i blocchi `<think>`** (prima venivano rimandati al modello nel contesto); strip anche nel path non-streaming. |
| `src/core/agent.ts` | Nuovo 4° parametro opzionale `onEvent`; display tool sostituito da emissione eventi; **rimosso l'import di CLITheme** (core disaccoppiato dalla CLI); fallback `plainEventRenderer` per test/usi programmatici. |
| `src/cli/index.ts` | REPL ricablata su `StreamRenderer`; handler `SIGINT` che ripristina il terminale (riga di stato, cursore) prima di uscire. |
| `src/cli/commands/call.ts`, `team.ts` | Sostituito lo streaming grezzo bianco con `StreamRenderer` per speaker: status "Thinking…", pannello markdown e stile coerente con la chat principale. |
| `tsuka.config.json` | Provider `unsloth`: modello aggiornato a `satgeze-qwenpaw-9b-heretic-1m-latest-Q8_0` (l'unico caricato in Unsloth Studio; il precedente non era caricato). |

### Verifica
- `tsc --noEmit` pulito; nuova suite `tests/test_think_parser.ts` **13/13** (tag spezzati a chunk di 1 char, think non chiuso, `<` letterale, blocchi multipli).
- Simulazione TTY (script scratchpad): status line, erase/repaint, eventi tool, cursore — tutti gli assert passano; non-TTY senza garbage ANSI.
- **Test live su Unsloth Studio** (qwenpaw-9b-heretic-1m): reasoning `<think>` separato correttamente nella status line, streaming ~51 tok/s, pannello finale senza `<think>`, cronologia pulita.

**Follow-up noto (fuori scope)**: interruzione della generazione con AbortController verso l'SDK senza uscire dalla REPL.

---

## 2026-07-20 — FIX renderer markdown: entità HTML, elenchi rotti, codice hljs (report utente) ✅

**Sintomo**: la CLI scriveva `po&#39;` invece di `po'`.

**Diagnosi**: `marked` converte il markdown in HTML (apostrofo → entità `&#39;`); `stripTags()` toglieva i tag ma non decodificava le entità. Indagando emersi altri 2 bug latenti nella stessa area, mascherati dal try/catch di `agentPanel` che degradava silenziosamente il pannello a testo piano.

**Fix** (`src/cli/markdown.ts`):
| Bug | Fix |
|-----|-----|
| Entità HTML a schermo (`&#39;`, `&amp;`, `&quot;`, …) | Nuova `decodeEntities()` (numeriche + nominali, `&amp;` per ultima) applicata a paragrafi, titoli, elenchi, citazioni via helper `htmlToText()`. |
| **Elenchi puntati rotti da sempre**: il caso `list` passava un token `list_item` a `marked.parser` → throw → fallback testo piano (per questo si vedevano `-` grezzi invece di `•`) | Parse dei token interni dell'item (`marked.parser(it.tokens)`). |
| Blocchi codice stampavano l'HTML grezzo di highlight.js (`<span class="hljs-…">` + entità) | Nuovo convertitore `hljsHtmlToAnsi()`: span (anche annidati, stack-based) → colori chalk, entità decodificate. Syntax highlighting ora effettivo nel terminale. |
| (già nel round precedente) `lang.length` su fence senza linguaggio → TypeError | `(lang || 'code').length`. |

**Verifica**: nuova suite `tests/test_markdown_render.ts` **6/6** (entità, span residui, fence senza linguaggio, colori ANSI); suite completa **14/14**; test live col modello: apostrofi corretti, bullet `•`, codice colorato senza tag residui.

---

## 2026-07-20 — History del prompt con frecce su/giù ✅

**Richiesta utente**: navigare i prompt precedenti/successivi con le frecce, come in una shell.

**Implementazione**: `prompts` non supporta la history; il readline nativo di Node sì (opzione `history` + navigazione integrata con terminal mode).
| File | Intervento |
|------|-----------|
| `src/cli/input.ts` (nuovo) | `askInput()`: input principale su readline nativo con history navigabile (↑/↓), **persistita in `.tsuka_history`** (max 100 voci, dedup consecutivi) e condivisa tra sessioni. Un'istanza per domanda, chiusa subito: nessun conflitto con i menu `prompts`. Ctrl+C/Ctrl+D → `undefined` (stessa semantica di prima). Senza TTY degrada a lettura riga semplice. |
| `src/cli/index.ts` | Input della REPL migrato da `prompts` ad `askInput`. I menu (`/character`, `/team`, …) restano su `prompts`. |
| `.gitignore` | Aggiunto `.tsuka_history`. |

**Verifica**: `tsc --noEmit` pulito; e2e in pipe (risposta renderizzata, exit 0 a EOF, history salvata su file); suite completa **14/14**.

---

## 2026-07-20 — Interruzione della generazione con Esc ✅

**Richiesta utente**: poter fermare il modello mentre ragiona o se resta bloccato, senza chiudere l'applicazione.

**Implementazione**: AbortController collegato all'SDK OpenAI — l'abort annulla il fetch in corso, quindi è efficace anche a server bloccato o in coda (prompt processing a 0 token).
| File | Intervento |
|------|-----------|
| `src/cli/interrupt.ts` (nuovo) | `GenerationInterrupt`: durante la generazione stdin va in raw mode e intercetta i tasti — **Esc** abortisce la richiesta, **Ctrl+C** esce (in raw mode il SIGINT va emulato). `arm()`/`disarm()` per richiesta; no-op senza TTY. |
| `src/core/provider.ts` | `chatWithTools` accetta `signal?: AbortSignal` e lo passa alle request options dell'SDK. |
| `src/core/agent.ts` | `run` accetta `signal`; su abort il ciclo agentico termina in modo pulito (nessuna eccezione propagata). |
| `src/cli/index.ts` | Chat: Esc → warning "Generazione interrotta", l'eventuale risposta parziale streammata viene conservata in cronologia con marcatore `[risposta interrotta dall'utente]`; si torna al prompt. |
| `src/cli/commands/call.ts`, `team.ts` | Esc interrompe l'intera conferenza / workflow (break del loop round, `disarm` a fine comando). |
| `src/cli/statusline.ts` | La status line ora mostra l'hint: `◐ Thinking… (2.4s · 87 tok · esc interrompe)`. |

**Verifica**: `tsc --noEmit` pulito; test live con abort simulato a metà generazione → `agent.run` torna in **2ms** senza eccezioni; suite completa **14/14**; e2e REPL in pipe invariato.

**Nota diagnostica** (segnalazione "si ferma su Elaborazione risultati" con web_search): non riprodotto — sia il ciclo agentico diretto sia la REPL completa rispondono correttamente alla stessa domanda (2 round di tool, risposta in ~18s). Causa più probabile: contesa del server Unsloth Studio (una richiesta alla volta: altre generazioni concorrenti mettono in coda la chiamata, che resta a 0 token visibili). Con Esc ora il caso è comunque gestibile dall'utente.

---

## 2026-07-20 — Avviso all'avvio per modello non profilato ✅

**Richiesta utente**: suggerire di lanciare `/benchmark` se il modello attivo non è mai stato profilato.

**Contesto**: senza profilo in `models_profile.json` il tier dei tool viene stimato dall'euristica sul nome (es. "9b" → small), che può nascondere tool al modello (`execute_command`, `create_tool` sono tier medium). Caso reale: il passaggio a Unsloth Studio ha cambiato l'id del modello (`satgeze-qwenpaw-…-Q8_0`), orfano del profilo misurato "large" del vecchio id Ollama.

| File | Intervento |
|------|-----------|
| `src/cli/shared.ts` | Nuovo helper `notifyIfUnprofiled(model)`: se manca il profilo, warning con il tier stimato e suggerimento `/benchmark`. |
| `src/cli/index.ts` | Chiamata all'avvio, dopo la conferma del modello attivo (anche in caso di fallback). |
| `src/cli/commands/provider.ts` | Chiamata dopo ogni cambio modello (`/models`, `/use`, incluso il set forzato) e dopo `/provider`. |

**Verifica**: `tsc --noEmit` pulito; avvio REPL → warning e hint mostrati per il modello Unsloth non profilato; suite completa **14/14**.

---

## 2026-07-20 — Rifiniture post-valutazione: log duplicato, provider swap pulito, pruning a token, marker STATO ✅

**Contesto**: valutazione generale del progetto (richiesta utente) a piano di ottimizzazione già completato. Emersi 4 punti residui, tutti sistemati. Nota: il sospetto problema sui caratteri wide in `stream.ts` si è rivelato infondato (`trackText` usa già `CLITheme.cleanLen`, che conta emoji/CJK come 2 colonne).

| Problema | File | Fix |
|----------|------|-----|
| `console.log('[Esecuzione Tool: …]')` residuo nel core: duplicava la riga `● nome(args)` dello StreamRenderer e inseriva una riga non tracciata nella zona erase/repaint ANSI | `src/tools/registry.ts` | Rimosso (l'evento `tool_start` copre già il feedback); eliminato l'import di chalk ormai inutilizzato |
| Swap provider via `Object.assign(ctx.provider, newProvider)`: copiava campi privati, richiedeva `provider as any` in `index.ts` | `src/core/provider.ts`, `src/cli/commands/provider.ts`, `src/cli/index.ts` | Nuovo metodo `LLMProvider.reconfigure(baseUrl, apiKey, model)` che muta l'istanza condivisa ricreando il client; rimosso il cast `as any` dal CommandCtx |
| Pruning solo a conteggio messaggi: 40 messaggi con output tool enormi potevano comunque sforare la context window | `src/core/agent.ts`, `src/core/config.ts`, `src/cli/index.ts`, `src/cli/commands/team.ts` | Secondo criterio di taglio a budget di token stimati (~3,5 char/token, `tool_calls` inclusi): `maxHistoryTokens` in `tsuka.config.json` (default 65536, min 1024), getter `getMaxHistoryTokens()`, 7° parametro di `Agent`. Restano sempre system + ultimi 3 messaggi; taglio sicuro tool_call/tool invariato |
| `hasCompletionMarker` scattava anche su citazioni a metà frase ("non scriverò STATO: COMPLETATO") | `src/cli/commands/team.ts` | Regex ancorata a inizio riga: `/(^|\n)\s*STATO:\s*COMPLETATO/i` (coerente col protocollo, che richiede una riga finale dedicata) |

**Verifica**: `tsc --noEmit` pulito; +4 test di regressione (TM.1e/TM.1f marker a inizio riga vs citazione; T2.3d/T2.3e budget token rispettato con system + ultimi 3 preservati); suite completa **14/14** (test_phase2 9 test, test_team_loop 10 test).

---

## 2026-07-20 — Scansione server all'avvio con aggancio al volo + fix box di stato ✅ (report utente)

**Sintomi segnalati**: (1) il box blu "Stato Sessione" non chiudeva bene sul bordo destro; (2) all'avvio la CLI cercava solo il provider configurato — se quello era spento falliva invece di scansionare gli altri server locali (Ollama, Unsloth, …) e agganciarsi al modello disponibile o già caricato.

### Fix 1 — Box di stato disallineato (`src/cli/ui.ts`)

**Diagnosi**: in `CLITheme.box` la matematica delle larghezze era incoerente — bordi alto/basso larghi `w`, riga del titolo `w-2`, righe di contenuto `w+2`. Il bordo destro non poteva mai allinearsi.

**Fix**: helper `row()` unico per titolo e contenuto con formula condivisa (`inner = w - 6`: 2 bordi + 2 spazi di margine per lato). Verificato a 80 colonne: tutte le righe esattamente 80 caratteri visivi.

### Fix 2 — Scansione server e aggancio al volo (`src/core/discovery.ts` nuovo)

| Componente | Dettaglio |
|-----------|-----------|
| `probeProvider()` | Interroga un server con timeout breve (2,5s) via `/v1/models` (fallback nativo Ollama `/api/tags`) e rileva il modello *già caricato in RAM*: flag `"loaded": true` nella risposta `/v1/models` (Unsloth Studio), `"state": "loaded"` (LM Studio), endpoint `/api/ps` (Ollama) |
| `scanProviders()` | Prova prima il provider attivo in config; se non risponde, sonda **in parallelo tutti gli altri server locali** configurati. I provider remoti non attivi non vengono interrogati (l'avvio non dipende dalla rete) |
| Avvio (`src/cli/index.ts`) | Se il provider configurato è spento ma un altro è vivo → **switch automatico** con aggiornamento del config. Priorità modello: **già caricato in RAM** > configurato se presente sul server > primo disponibile. Il pannello di stato è stampato **dopo** la scansione (prima mostrava dati potenzialmente stantii) e include la nuova riga **Modello** |
| `src/core/config.ts` | Nuovi `getApiKeyFor(name)`, `getProviderNames()`, `getProviderConfig(name)` (il vecchio `getApiKey()` delega a `getApiKeyFor`) |

**Razionale dell'aggancio al modello caricato**: agganciarsi al modello già in RAM evita che il server ne ricarichi un altro da zero (decine di secondi sui GGUF grandi).

### Fix 3 — Benchmark attribuito al modello sbagliato su Unsloth (report utente, stesso giorno)

**Sintomo**: all'avvio TSUKA si è agganciato a un modello **non caricato** e `/benchmark` ha profilato quel nome credendolo attivo, mentre il server rispondeva con un altro modello.

**Diagnosi**: la prima versione del rilevamento usava solo `/api/ps`, che è un endpoint **esclusivo di Ollama** → su Unsloth `loadedModel` restava null e la priorità ricadeva sul modello configurato, presente nella lista ma non caricato. Sondando il server reale è emerso che **Unsloth Studio marca il modello attivo** con `"loaded": true` direttamente nella risposta di `/v1/models` (12 modelli listati, 1 solo `loaded`) — il flag veniva semplicemente ignorato.

**Fix** (`src/core/discovery.ts`): `probeProvider` ora legge `loaded === true` (Unsloth Studio) e `state === 'loaded'` (LM Studio) dalle entry di `/v1/models`; `/api/ps` resta come fallback per Ollama. **Nota**: i profili in `models_profile.json` misurati su Unsloth prima di questo fix possono essere attribuiti al nome sbagliato — rifare `/benchmark` per il modello in uso.

### Verifica
- `tsc --noEmit` pulito
- Test allineamento box a 80 colonne: 7/7 righe esatte
- Test live: con tutti i server spenti la scansione fallisce in fretta con messaggio chiaro e lascia la REPL utilizzabile (`/provider`)
- Test con finto server Ollama (`/v1/models` + `/api/ps`): provider attivo `unsloth` spento → aggancio automatico al finto Ollama e scelta del modello caricato (`qwen2:7b`) invece di quello configurato ✔
- Test live su Unsloth Studio reale: 12 modelli in lista, rilevato correttamente il solo `loaded: true` (`HauhauCS/Qwen3.5-9B-Uncensored-…`) → è quello che verrebbe agganciato all'avvio, non più il configurato non caricato ✔

---

## 2026-07-20 — Autocompletamento Tab dei comandi slash ✅

**Richiesta utente**: completare i comandi `/` con Tab, come in una shell.

**Implementazione** (leggera: il readline nativo già in uso supporta l'opzione `completer`, zero dipendenze nuove):

| File | Intervento |
|------|-----------|
| `src/cli/input.ts` | Nuova `setCompletionSource({ commands, argumentsFor })` + `completeLine()` (esportata per i test): completa il nome comando sull'intera riga, oppure l'ultima parola come argomento (match case-insensitive). Il testo libero non viene mai completato. `completer` attivo solo in modalità interattiva (TTY). |
| `src/cli/index.ts` | Registrazione della sorgente all'avvio: comandi = chiavi del dispatch map + comandi inline; argomenti dinamici per `/use` e `/benchmark` (modelli disponibili, letti dal riferimento mutabile → sempre aggiornati dopo `/provider` o `/models`), `/provider` (nomi provider dal config), `/forget` (`all`). |
| `src/cli/ui.ts` | Hint dei tasti sotto il box `/help`: `Tab completa comandi e argomenti · ↑/↓ naviga la history · Esc interrompe la generazione`. |

**Verifica**: `tsc --noEmit` pulito; nuova suite `tests/test_completer.ts` **11/11** (prefissi comando, argomenti filtrati, case-insensitive, testo libero ignorato, sorgente non registrata); suite completa **15/15**.

---

## 2026-07-20 — FIX: Esc morto in "Elaborazione risultati" + Ctrl+X come interruzione ✅ (report utente)

**Sintomo**: Esc (e Ctrl+X, che non era mappato) non interrompeva la generazione nella fase "Elaborazione risultati…".

**Diagnosi** (2 cause):
1. **Raw mode spento dai prompt di autorizzazione**: quando un tool RESTRICTED/DANGEROUS chiede `[y/N]`, la libreria `prompts` alla chiusura fa `setRawMode(false)` + `pause()` su stdin → il listener keypress di `GenerationInterrupt` resta attaccato ma sordo per tutto il resto del run (round successivi inclusi).
2. **Segnale controllato solo dentro la chiamata LLM**: `agent.run` non guardava `signal.aborted` tra un round e l'altro né durante l'esecuzione dei tool — l'abort diventava effettivo solo se c'era un fetch in volo da annullare.

| File | Intervento |
|------|-----------|
| `src/cli/interrupt.ts` | Nuovo `rearm()`: riattiva raw mode + resume se un altro consumatore di stdin li ha spenti (idempotente, costo nullo). Mappato **Ctrl+X** come alternativa a Esc — essendo un byte singolo scatta subito, mentre Esc ha ~500ms di latenza intrinseca (è il prefisso delle sequenze escape). |
| `src/core/agent.ts` | `signal.aborted` controllato: a inizio round, dopo il blocco tool, e **per ogni singolo tool**: i tool rimanenti dopo l'abort non vengono eseguiti ma ricevono una risposta `tool` sintetica `[Esecuzione annullata…]` (cronologia coerente: nessun tool_call orfano). |
| `src/cli/index.ts`, `commands/team.ts` | Handler eventi: `(ev) => { renderer.onAgentEvent(ev); interrupt.rearm(); }` → il raw mode viene riasserito a ogni evento dell'agente. |
| `src/cli/commands/call.ts` | `rearm()` prima di ogni intervento dei partecipanti. |
| `src/cli/statusline.ts`, `ui.ts` | Hint aggiornati: `esc/ctrl+x interrompe`. |

**Verifica**: `tsc --noEmit` pulito; nuova suite `tests/test_interrupt.ts` **8/8** (segnale pre-abortito → nessuna chiamata LLM; abort a metà tool → secondo tool saltato con risposta sintetica, nessun tool_call orfano, nessuna seconda chiamata LLM; flusso normale invariato); suite completa **16/16**.

---

## 2026-07-20 — Menu interattivo per la memoria condivisa (/memory) ✅ (richiesta utente)

**Richiesta**: la memoria si poteva solo elencare (`/memory`) o cancellare per id (`/forget`) — nessun modo di selezionare un ricordo e "recuperarlo".

**Implementazione** (`src/cli/commands/memory.ts` nuovo, registrato nel dispatch map al posto del blocco inline):
- `/memory` apre un **menu interattivo** con gli ultimi 30 ricordi (data, fonte, anteprima; contenuto esteso nella descrizione della voce).
- Selezionando un ricordo: contenuto completo in un box + sottomenu con **Recupera nel contesto della chat** (inietta il ricordo nella cronologia dell'agente come messaggio etichettato — l'agente lo tiene presente nelle risposte successive), **Elimina** (con ritorno all'elenco aggiornato), Torna all'elenco, Chiudi.
- Senza TTY degrada all'elenco testuale semplice di prima. `/forget <id|all>` resta invariato per l'uso diretto.

**Verifica**: `tsc --noEmit` pulito; e2e REPL in pipe (fallback non-TTY corretto); suite completa **16/16**. Sistemata in corsa la descrizione di `/memory` nel box `/help` che sbordava dalla colonna (max 38 char).

---

## 2026-07-20 — Benchmark v2: test severi + invalidazione profili vecchi ✅ (report utente)

**Sintomo**: il benchmark promuoveva tutti a LARGE — anche un 4B (`unsloth/Qwen3.5-4B-GGUF` con 1/1/1 in `models_profile.json`).

**Diagnosi**: i 3 micro-test del 2024 (rispondi "PONG", JSON con 2 chiavi, una tool call singola) sono banali per qualsiasi modello moderno; in più `computeTier` guardava **solo** il punteggio toolCalling — una tool call valida bastava per LARGE, instruction e JSON non pesavano nulla.

**Riprogettazione** (`src/core/modelProfile.ts`):

| Test (5, punteggi frazionari) | Cosa misura |
|------------------------------|-------------|
| 1. Instruction multi-vincolo | 3 righe esatte (`ROSSO`/`42`/`blu`), 4 sotto-controlli da 0.25 |
| 2. JSON strutturato | validità 0.4 + schema (array utenti, tipi) 0.3 + valori e somma calcolata 0.3 |
| 3. Scelta del tool | tool giusto tra 3 (con distrattore meteo) e argomenti estratti dal testo → 0.4 |
| 4. **Catena a 2 passi** | usare l'id restituito dal primo tool nella seconda chiamata (propagazione esatta `USR-7431`) → 0.4 |
| 5. **Astensione** | richiesta senza bisogno di tool → non deve chiamarne (i modelli piccoli chiamano tool a sproposito) → 0.2 |

- **`computeTier` v2 a criteri combinati**: LARGE solo con toolCalling ≥ 0.9 **e** instruction ≥ 0.75 **e** json ≥ 0.75; MEDIUM con toolCalling ≥ 0.6 e json ≥ 0.5; altrimenti SMALL.
- **`BENCHMARK_VERSION = 2`** salvata nel profilo: `getModelProfile()` tratta i profili di versioni precedenti come assenti → i vecchi LARGE regalati (incluso quello del 4B) sono automaticamente invalidati e il warning "usa /benchmark" riappare.
- `printProfile` (`/benchmark`) aggiornato: punteggi percentuali colorati con legenda dei sotto-test.
- README EN/IT: sezione fingerprinting aggiornata (5 test, criteri v2).

**Verifica**: `tsc --noEmit` pulito; `test_fingerprinting.ts` esteso a **12 test** (tier combinati: toolCalling perfetto non basta più per LARGE; profili legacy → null e fallback euristica); suite completa **16/16**. **Benchmark v2 live** su Unsloth (`HauhauCS/Qwen3.5-9B-…`, modello caricato): 100%/100%/100% → LARGE, catena e astensione incluse — plausibilmente merito reale per un 9B del 2026; il discrimine si vedrà rimisurando i modelli piccoli.

---

## 2026-07-21 — Benchmark v3: test dichiarativi in `benchmarks/*.json` + asticella alzata ✅ (report + richiesta utente)

**Contesto**: anche il 4B (`unsloth/Qwen3.5-4B-GGUF`) passava la v2 a pieni voti. L'utente ha chiesto sia di alzare l'asticella sia di rendere i test **modificabili al volo da file JSON**, con enumerazione ed esecuzione automatica.

### Motore dichiarativo (`src/core/benchmarkTests.ts` nuovo)

- **Test = file JSON in `benchmarks/`** (home dell'app): nome, categoria (`instruction`/`json`/`toolCalling`), peso, tool offerti (schema OpenAI), prompt singolo oppure `steps` concatenati (i `toolResult` dichiarati nel file vengono restituiti alla tool call del passo precedente — catene multi-turno senza codice).
- **DSL di 17 check pesati**: testuali (`word_count`, `line_count`, `first_word`/`last_word` con strip punteggiatura, `contains`/`not_contains`, `regex`/`not_regex`, `not_empty`), JSON (`json_valid`, `json_path_equals`/`type`/`length` con percorsi tipo `economici[0].nome`), tool (`tool_called`, `tool_not_called`, `tool_arg_equals`, `tool_arg_regex`). Punteggio test = pesi superati / pesi totali; catena rotta → i check successivi valgono 0 ma pesano.
- **Hash del set** (md5 8 hex, cache su mtime) salvato nel profilo: modificare/aggiungere/rimuovere un test **invalida automaticamente** i profili misurati col set precedente. `BENCHMARK_VERSION = 3` (versione motore).
- `runBenchmark` enumera i test, li esegue in sequenza con progress (`Test i/N: nome [categoria]`), aggrega i punteggi in medie pesate per categoria, salva `testResults` per-test nel profilo; `/benchmark` li stampa uno per uno.
- **Tier ricalcolato alla lettura** (`getModelProfile`): se le soglie di `computeTier` cambiano, i profili già misurati si adeguano senza rimisurare.

### Set di default (5 test, volutamente difficili)

| File | Categoria | Contenuto |
|------|-----------|-----------|
| `10_instruction_frase.json` | instruction | Frase di **esattamente 8 parole**, prima/ultima parola imposte, niente virgole |
| `11_instruction_lista.json` | instruction | 3 colori con parola vietata, minuscolo, senza numerazione/simboli |
| `20_json_prodotti.json` | json | Selezione dei 3 più economici, ordinamento, somma calcolata (56) |
| `30_tool_catena.json` | toolCalling (peso 2) | find_user → risultato con **3 id quasi identici** (Mario Rossi/Maria Rossi/Maria Rosi) → get_orders con l'id giusto |
| `31_tool_trappola.json` | toolCalling | Il prompt **nomina** get_weather ma chiede solo di spiegarlo: non va chiamato |

### Soglie tier aggiornate

LARGE: toolCalling ≥ 0.9 **e** instruction ≥ **0.85** **e** json ≥ **0.85** (era 0.75: il 4B passava per un soffio).

### Verifica
- `tsc --noEmit` pulito; nuova suite `tests/test_benchmark_dsl.ts` **23/23** (loader/enumerazione/hash, check testuali/JSON/tool, catena con provider finto: perfetta = 1, id distrattore = 4/7, nessuna tool call = 0); `test_fingerprinting.ts` → **14 test** (hash stantio → profilo invalidato; caso reale 4B → medium); suite completa **17/17**.
- **Live sul 4B** (unico modello caricato su Unsloth): frase_8_parole **60%** (conteggio parole sbagliato), json 91%, catena e trappola 100% → instruction 0.8 ⇒ **tier MEDIUM** (prima: LARGE con 1/1/1). Il profilo salvato si è auto-corretto a medium grazie al tier ricalcolato alla lettura. Il benchmark ora discrimina.
- README EN/IT: sezione fingerprinting riscritta (test da file, hash, set di default).

---

## 2026-07-21 — /models: modello caricato in evidenza + caricamento esplicito sul server ✅ (richiesta utente)

**Richiesta**: selezionare un modello dalla lista e far sì che Unsloth lo carichi. Di fatto Unsloth Studio (e Ollama) caricano just-in-time il modello nominato nella prima richiesta — ma TSUKA non mostrava quale fosse caricato, e lo swap partiva "a sorpresa" alla prima chat, che restava appesa per minuti.

| File | Intervento |
|------|-----------|
| `src/core/discovery.ts` | Nuova `warmUpModel(baseUrl, apiKey, model)`: richiesta minima (`max_tokens: 1`, timeout 5 min) che forza il server JIT a caricare il modello subito. |
| `src/cli/commands/provider.ts` | `pickModel` e `/use` ora usano `probeProvider` (lista + modello in RAM in un colpo): il menu marca il modello caricato con `● caricato`. Nuovo helper `maybeWarmUp`: se il modello scelto su server locale non è quello in RAM, conferma `[y/N]` → spinner "Caricamento di … sul server" → esito verificato. Rifiutando, il caricamento avviene come prima alla prima richiesta. |

**Nota comportamentale**: dopo lo swap esplicito il modello scelto diventa quello caricato, quindi la scansione all'avvio (che privilegia il modello in RAM) resta coerente con la scelta dell'utente. Se invece si rifiuta il warm-up e si riavvia prima di chattare, all'avvio la scansione riaggancia il modello ancora caricato.

**Verifica**: `tsc --noEmit` pulito; suite completa **17/17**; sonda live read-only su Unsloth → rilevamento corretto del modello in RAM nel percorso usato dal menu. (Il flusso interattivo warm-up non è testato in automatico: dipende da rete e conferme utente.)

---

## 2026-07-21 — FIX: input morto dopo la generazione su Windows (raw mode lock) ✅ (report utente)

**Sintomo**: dopo una generazione (stats stampate) il prompt era vivo (cursore lampeggiante) ma **completamente sordo**: nessun carattere, niente eco, Esc morto, perfino Ctrl+C morto. Riavvio forzato del terminale come unica uscita.

**Diagnosi**: la simulazione con finto TTY (stesso identico flusso: prompts → spinner warm-up → askInput → arm/generazione/disarm → askInput) **non riproduce il problema**: la logica applicativa è corretta. Il colpevole è il layer nativo della console Windows: ogni passaggio raw→cooked (readline a ogni `close`, prompts a ogni menu, l'interrupt a ogni `disarm`) fa avviare a libuv una **ReadConsole cooked pendente che non è cancellabile in modo affidabile**; al ritorno in raw mode i tasti vengono ingoiati dalla lettura-zombie (bufferizzati in attesa di un Invio che non arriva a nessun consumatore): eco morta, niente SIGINT (raw), input defunto. Spiega anche i vecchi report "Esc non triggera".

**Fix** (`src/cli/rawlock.ts` nuovo, strategia alla Ink): `lockRawMode()` all'avvio della REPL — il raw mode viene acceso una volta e i successivi `setRawMode(false)` dei componenti vengono **ignorati** (monkey-patch sul metodo): niente più finestre cooked durante la sessione, quindi niente letture-zombie. readline e prompts funzionano comunque (sono loro stessi ad attivare il raw quando servono). La console è ripristinata (cooked) solo su `process.on('exit')`, così la shell resta pulita anche uscendo con Ctrl+C. Senza TTY: no-op.

**Verifica**: simulazione fake-TTY con lock attivo → tutti i flussi ok e sequenza toggle `true,true,…` (zero passaggi cooked in sessione); `tsc --noEmit` pulito; suite completa **17/17**; e2e in pipe non-TTY invariato. **Conferma finale possibile solo sul terminale reale dell'utente** (il wedge è nel driver console Windows, non simulabile).
