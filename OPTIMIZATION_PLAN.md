# 🗓️ Piano di Ottimizzazione — TSUKA

> Generato il 2026-07-19 a seguito di code review completa (~2.500 righe TS, 20 file).
> Stato compilazione al momento dell'analisi: `tsc --noEmit` pulito.
> **Tutte le 4 fasi completate il 2026-07-19** ✅ — **+ Fase 5 (Innovazione) completata lo stesso giorno** ✅

## Verdetto

Codebase **ben strutturata ma non ottimizzata**. Punti di forza: architettura modulare (auto-discovery tool, config JSON esterni), TypeScript strict, dipendenze minime, permission manager a livelli. Criticità: alcuni **bug reali** (Fase 1, quasi obbligatoria), hot-path con I/O ridondante, statistiche token errate, nessuna gestione della context window, alcune lacune di sicurezza rispetto a quanto dichiarato nel README.

---

## FASE 1 — Bug fix critici ⚡ (priorità ALTA, effort ~2-3h) ✅

| ID | Task | File | Dettaglio |
|----|------|------|-----------|
| T1.1 | Fix pattern `$` in editFile | `src/tools/impl/editFile.ts:31` | `content.replace(target, replacement)` con stringa interpreta `$&`, `$'`, `` $` `` nel replacementContent → corruzione silenziosa dei file. **Fix**: usare replacer function `content.replace(target, () => replacementContent)`. |
| T1.2 | Rimuovere hack "lola" in /team | `src/cli/index.ts:792` | `loadCharacter(memberName === "lola" ? "sensual_diva" : memberName)` rompe qualsiasi membro non mappato col nome file. **Fix**: risoluzione per `name`/`aiName` come già fatto in `/call`. |
| T1.3 | Stop riscritture config spurie | `src/core/config.ts:59`, `src/tools/impl/webSearch.ts:136` | `load()` chiama sempre `save()` → riscrittura a ogni avvio; `webSearch` istanzia `new ConfigManager()` a ogni ricerca → riscrittura del file a ogni search. **Fix**: salvare solo su setter effettivi; webSearch riceve/riusa un'istanza condivisa. |
| T1.4 | Timeout su processi e fetch | `src/tools/impl/executeCommand.ts`, `src/tools/impl/browseUrl.ts` | `execute_command` può bloccarsi all'infinito; `browse_url` senza `AbortController`. **Fix**: timeout 120s + kill processo; AbortController 30s su fetch. |
| T1.5 | Limite iterazioni loop agentico | `src/core/agent.ts:52` | `while (!isDone)` senza guardia: un modello in loop di tool brucia token all'infinito. **Fix**: `MAX_TOOL_ROUNDS = 15` con messaggio di stop esplicito. |
| T1.6 | Filtrare env var sensibili | `src/tools/impl/getPsInfo.ts:21` | Categoria `env` dumpa TUTTE le variabili (incluse `OPENROUTER_API_KEY` ecc.) nel contesto del modello → data leak. **Fix**: escludere nomi contenenti `KEY`, `SECRET`, `TOKEN`, `PASSWORD`. |
| T1.7 | Eliminare `leaks.txt` | root | Artefatto di sessione precedente, non pertinente al progetto. |

---

## FASE 2 — Performance ⚡ (priorità MEDIA-ALTA, effort ~2h) ✅

| ID | Task | File | Dettaglio |
|----|------|------|-----------|
| T2.1 | Cache schemi tool | `src/tools/registry.ts:110,126` | `loadToolSchema()` rilegge JSON da disco 2 volte per tool a ogni `listForLLM`, invocata a ogni iterazione del loop agentico (~20 letture sync/giro). **Fix**: caricare gli schemi una volta in `createDefaultRegistry()` (o lazy-map con cache), opzionale metodo `reloadSchemas()`. |
| T2.2 | Statistiche token reali | `src/core/provider.ts:89` | Oggi conta i **chunk di stream**, non i token → tok/s fuorvianti. **Fix**: richiedere `stream_options: { include_usage: true }` (OpenAI) / leggere campo `usage` del chunk finale (Ollama lo supporta), fallback su stima caratteri. |
| T2.3 | Pruning cronologia | `src/core/agent.ts` | Sessioni lunghe superano la context window → errore API. **Fix**: strategia semplice: system prompt + ultimi N messaggi (es. 40), con log di avviso; configurabile da `tsuka.config.json` (`maxHistoryMessages`). |
| T2.4 | Cache config JSON | `src/cli/index.ts` (loadRole/loadTrait/loadCharacter/loadTeam) | Rilettura da disco a ogni comando slash e a ogni messaggio utente. **Fix**: cache con invalidazione su mtime (o invalidazione esplicita su `/rename-char`, `create_role`). |

---

## FASE 3 — Sicurezza & robustezza 🛡️ (priorità MEDIA, effort ~2-3h) ✅

| ID | Task | File | Dettaglio |
|----|------|------|-----------|
| T3.1 | Jail workspace file tool | `src/tools/impl/{writeFile,editFile,deleteFile,readFile,listDir}.ts` | Il README dichiara "scrittura nel workspace" ma i path assoluti sono liberi (es. `C:\Windows\...`). **Fix**: opzione `workspaceRoot` in config; path risolti e verificati dentro la root (default: comportamento attuale con warning, o jail attivo — da decidere). |
| T3.2 | Limiti dimensione I/O | `readFile.ts`, `grepSearch.ts`, `executeCommand.ts` | File interi caricati in memoria sync, output comandi illimitato. **Fix**: max ~5MB per file, troncamento output comando a ~50KB con nota. |
| T3.3 | Validazione argomenti tool | `src/tools/registry.ts` | Oggi gli args del modello passano grezzi all'execute. **Fix**: validazione minima contro JSON schema (required + tipi primitivi) prima dell'esecuzione, con errore chiaro al modello. |

---

## FASE 4 — Qualità & manutenibilità 🧹 (priorità BASSA, effort ~2h) ✅

| ID | Task | File | Dettaglio |
|----|------|------|-----------|
| T4.1 | Estrarre utility condivise | nuovo `src/cli/shared.ts` | `resolvePath`/`isBinaryFile` duplicati in 5 file → `utils.ts`; scansione `characters/` duplicata 3 volte in `index.ts` → funzioni esportate; interfacce e loader JSON centralizzati in `shared.ts`. |
| T4.2 | Spezzare il monolite CLI | `src/cli/index.ts` (1023 righe → 440) | Comandi estratti in `src/cli/commands/` con dispatch map. `session.ts`, `provider.ts`, `persona.ts`, `call.ts`, `team.ts`. Interfaccia `CommandCtx` in `types.ts`. |
| T4.3 | Cleanup generale | vari | Un solo `dotenv.config()` all'avvio; `registry` tipizzato (`ToolRegistry`); `.gitignore` aggiunto; `test_*.ts` spostati in `tests/` con path fixati. |
| T4.4 | Test con asserzioni | `tests/` | Runner `run_tests.ts` esegue 8 suite come child process, `npm test` disponibile (~2s). |

---

## Riepilogo finale

| Metrica | Prima | Dopo |
|---------|-------|------|
| Bug noti | 7 | 0 |
| Suite di test | 0 | 8 (37 test individuali) |
| dotenv.config() chiamate | 4 | 1 |
| Righe index.ts | ~1.020 | ~440 |
| File totali src/ | 20 | 29 (+7 di comandi, +shared, +utils, +memory, +2 tool) |
| Vulnerabilità sicurezza | 3 | 0 |
| Comando test unico | ❌ | `npm test` |

## Note

- Tutte le fasi hanno superato `npx tsc --noEmit` e la suite di test completa.
- La storia completa degli interventi è in `HISTORY.md`.
- La memoria condivisa persistente è stata aggiunta come feature extra (non prevista nel piano originale).

---

## Feature extra: Memoria Condivisa Persistente 🧠

Aggiunta su richiesta del 2026-07-19:
- `src/core/memory.ts` — MemoryStore singleton, file `memory/memory.json`, cap FIFO 200, ricerca keyword
- Tool `save_memory` (SAFE) e `recall_memory` (SAFE) con auto-discovery
- Iniezione automatica nel system prompt di tutti gli agenti (chat, `/call`, `/team`)
- Comandi `/memory` e `/forget <id|all>`
- Preservata tra le sessioni (sopravvive al riavvio della REPL)

---

## FASE 5 — Innovazione 🚀 (completata 2026-07-19) ✅

Direzioni innovative scelte dall'utente (opzioni 1+2) + adattabilità multi-sistema.

| ID | Task | File | Esito |
|----|------|------|-------|
| X1 | **Cross-platform**: Windows primario, Linux/macOS supportati | `src/core/platform.ts` (nuovo), `executeCommand.ts`, `getPsInfo.ts` | Shell astratta per OS; PowerShell su Windows, `/bin/sh` POSIX con process-group kill; `get_ps_info` con equivalenti `ps`/`df`/`systemctl`/`printenv`; filtro env sensibile su entrambe. |
| X2 | **Capability Fingerprinting**: tier dei tool *misurato* | `src/core/modelProfile.ts` (nuovo), `registry.ts`, `commands/provider.ts`, `/benchmark` | Benchmark 3 test (instruction, JSON, function calling) + tok/s → `models_profile.json`; `getModelTier` usa il profilo se presente. **Live**: il 9B heretic misurato LARGE (euristica diceva SMALL) → errore dell'euristica corretto. |
| X4 | **Self-Authoring tool** (`create_tool`) | `createTool.ts` (nuovo), `create_tool.json`, `registry.ts` (ToolContext, alwaysAllow, unregister) | Agente scrive nuovi tool in JS; sandbox `vm`, blocklist pattern pericolosi, no DANGEROUS, no overwrite core, backup in `tools_backup/`, registrazione a caldo immediata. Bug camelCase↔snake_case trovato e risolto in corso. |

### Verifica Fase 5
- `tsc --noEmit` pulito · `npm test` → **11/11 suite** (fingerprinting 7, self-authoring 9, platform 5 + tutte le precedenti)
- Benchmark live su Ollama eseguito con profilo reale persistito

### Idee innovative NON ancora implementate (backlog)
- **Verifica Oggettiva** (Plan → Execute → Verify): chiusura dei workflow `/team` con controlli deterministici (test, comandi, diff) invece della fiducia nelle dichiarazioni degli agenti.
- **Routing multi-modello cost-aware**: instradare ogni sotto-task al modello *misurato* più economico capace (sfrutta X2).
- **Snapshot & Rollback di sistema**: journal dei file + restore point prima di turni con `execute_command`.
