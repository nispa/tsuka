# TASKS — Piano Qualità (assegnabili ad agenti)

> Task derivati da `PLANNING-QUALITA.md`. Ogni task è autocontenuto: contesto, file da
> toccare, criteri di accettazione, cosa NON fare. Rispettare le dipendenze indicate.
>
> **Regole valide per ogni task:**
> - Leggere `AGENTS.md` prima di iniziare (architettura e convenzioni).
> - Commenti e nomi in italiano, codice in inglese. TS strict, CommonJS, no Ink.
> - Prima di dichiarare completato: `npm test` verde + `npm run build` senza errori.
> - Non modificare comportamenti non elencati nel task. Se un fix richiede di toccare
>   altro, segnalarlo nel report finale invece di farlo.
> - Ogni fallback o degradazione introdotta deve essere visibile (log UI + workflow log),
>   mai silenziosa.
> - Se il task modifica un meccanismo descritto in `docs/guida-didattica.md`, aggiornare
>   il paragrafo corrispondente nello stesso task.

## Stato

| Task | Stato | Note |
|------|-------|------|
| T0.1 | ✅ Fatto | `output/` creata + gitignorata, versione allineata a 0.2.0. `zmar3.txt` era già stato rimosso prima dell'esecuzione. |
| T0.2 | ✅ Fatto | Default di `getWorkspaceRoot()` cambiato da "nessuna restrizione" a cwd del processo (non un path fisso in config, per non rompere l'uso come comando globale). Corretto anche un bug latente: il confronto rifiutava la workspace root stessa (caso `list_dir('.')`). Test: `tests/test_workspace_jail.ts`. |
| T1.1 | ✅ Fatto | Estratta interfaccia `ILLMProvider` in `provider.ts` (zero cambi di comportamento); `Agent` accetta `ILLMProvider` invece del tipo concreto. `tests/mocks/mockProvider.ts` + `tests/test_mock_provider.ts`. `CommandCtx`/team.ts/goal.ts non toccati: iniezione per quei moduli è scope di T1.2. |
| T1.2 | ✅ Fatto | 16 scenari (11 in `test_team_modes.ts` + 5 in `test_goal_orchestrator.ts`), oltre il minimo di 10. Refactor minimo per l'iniezione: `CommandCtx.provider` tipato su `ILLMProvider` (non più `LLMProvider`), + `reconfigure` aggiunto all'interfaccia e implementato nel mock; esportate (senza spostarle) `runRoundRobin`, `runOrchestrated`, `runPipeline`, `runDiscussionRound` in team.ts. `tests/mocks/mockCtx.ts` costruisce un `CommandCtx` di test riusando i loader reali di `shared.ts` (roles/traits/characters/teams sono asset statici, non serve fingerli). **Gap reale trovato**: `STATO: FALLITO` (previsto in PLANNING.md §3.02 per la pipeline) non è implementato da nessuna parte — nessuna funzione lo controlla; lo scenario di rottura della pipeline riflette il comportamento reale (nessuna stazione completa → scorre fino in fondo, `completed:false`). |
| T1.3 | ✅ Fatto | `tests/test_protocol_parsing.ts`, 32 casi. Esportate (senza spostarle) `parseOrchestratorDecision`, `hasDoneSignal` (team.ts), `parsePlan`, `parseAgentLine` (goal.ts). 5 gap reali documentati con `// TODO T2.1`: marker in grassetto markdown, spazio prima dei due punti in `STATO :`, aiName multi-parola non risolvibile, agente non valido scartato senza log, blocco `PARALLELO` non chiuso che inghiotte gli step successivi. |
| T2.1 | ✅ Fatto | 3 tool nuovi (`report_status`, `route_next`, `cast_vote`, riskLevel SAFE) in `src/tools/impl/` + schemi in `tools_schemas/`, offerti solo nei turni di team/orchestrator/voto (non nella chat normale). Ordine di decisione in `team.ts`: tool call → regex esistente → default; ogni caduta di livello sotto `tool_call` emette una riga gialla (`warnProtocolDegrade`) + una voce `ProtocolLogEntry` inclusa in `protocolLog` nei `workflow_logs/`. Chiuso il gap T1.2 su `STATO: FALLITO`: ora rilevabile via `report_status` e ferma round-robin/orchestrated/pipeline (nuovo esito `'failed'` su `runMemberTurn`/`runRoundRobin`/`runOrchestrated`/`runPipeline`). Regex esistenti non toccate (restano fallback, incluso il gap noto: FALLITO non è riconoscibile via testo, solo via tool call). 14 scenari nuovi in `test_team_modes.ts` (2 per modalità: tool call + testo/fallback con segnalazione verificata, più FALLITO dedicato per pipeline) sopra ai 10 minimi; nessun test T1.2/T1.3 esistente modificato. `AGENTS.md` e `docs/guida-didattica.md` aggiornati. |
| T3.1 | ✅ Fatto | `PermissionManager` (`src/safety/permissions.ts`): promise-chain interna (`enqueuePrompt`) — le richieste RESTRICTED/DANGEROUS (uniche a generare un prompt) si accodano, una alla volta, in ordine di arrivo; SAFE resta sincrono, fuori dalla coda. Aggiunto `requesterLabel` opzionale a `checkPermission`, propagato da `ToolRegistry.executeTool` e da `Agent` (nuovo campo `agentLabel` nel costruttore, passato da `runMemberTurn` con `memberChar.aiName` e da `spawn_agent`), mostrato nel prompt quando presente. `tests/test_permission_queue.ts`, 9 casi: 2 richieste RESTRICTED concorrenti → prompt serializzati (verificato mockando `InteractiveMenu.select` con promise controllate a mano; test fatto fallire deliberatamente rimuovendo la coda per confermare che intercetta la regressione), etichetta richiedente nel log, caso singolo invariato, `'always'` impostato dalla prima richiesta si applica alla coda senza un secondo prompt. |
| T3.2 | ✅ Fatto | Jail temporanea per branch: `withWorkspaceOverride` in `src/tools/impl/utils.ts` (AsyncLocalStorage, non una variabile globale — branch concorrenti di `Promise.all` non si contaminano), `resolvePath`/`resolveSafePath` ora risolvono contro la root effettiva (override attivo, altrimenti `ConfigManager.getWorkspaceRoot()` come prima — nessun cambio quando non c'è override). Staging + merge in `src/core/parallelWorkspace.ts`: ogni branch scrive in `workspace/parallel-<n>/` sotto l'app home; a fine blocco `mergeParallelWorkspaces` unisce nella workspace reale, confronto byte a byte, path in conflitto tra branch → segnalato e MAI copiato (file principale, anche preesistente, intatto). Output console bufferizzato per branch in `src/core/logBuffer.ts` (monkeypatch scoped di `console.log` via AsyncLocalStorage) + flush ordinato a fine blocco + spinner unico nel frattempo. Wired nel blocco `PARALLELO` di `goal.ts`. `tests/test_parallel_workspace.ts`, 16 casi: Parte 1 unit test diretto di `mergeParallelWorkspaces` (distinti/conflitto/contenuto-identico/file-preesistente-intatto); Parte 2 end-to-end con 2 agenti mock che chiamano davvero `write_file` dentro un blocco PARALLELO di `/goal` (prova l'isolamento attraverso lo stack reale Agent→ToolRegistry→resolveSafePath, non solo la funzione di merge). Fuori scope non toccato: nessun indicatore per-agente separato (un unico spinner condiviso, come da task). |
| T4.1 | ✅ Fatto | `src/core/types.ts` nuovo: `ChatMessage`/`ChatRole`/`ToolCall`, `TurnOutcome`, `ProtocolSource`, `Vote`, `TeamConfig`, `PlanStep`. `TeamConfig` spostato qui da `cli/shared.ts` (che ora la re-esporta, zero cambi per gli importatori esistenti); `provider.ts` la usa per `ChatMessage`/`ILLMProvider`/`ChatResponse` (`ChatMessageLike` resta come alias per compatibilità coi test); `agent.ts` la usa per la history interna. In `team.ts`/`goal.ts` il `team`/`teamMessages`/`allCharacters`/`toolCalls` non sono più `any`; per le funzioni di modalità (`runRoundRobin`/`runOrchestrated`/`runPipeline`) il parametro `team` è tipato `Partial<TeamConfig> & Pick<TeamConfig,'members'>` (non `TeamConfig` pieno) apposta per restare compatibile con i team minimi usati nei test esistenti (nessun test toccato). `grep -c ": any"` team.ts+goal.ts: 46 → 4 (solo `catch (err: any)`, lasciati per idiomaticità). Build strict verde, nessun test modificato. |
| T4.2 | ✅ Fatto | `team.ts` da 900 a 128 righe: ora è un dispatcher (`handleTeam` carica il team, sceglie la `TeamStrategy` in base a `team.mode`, delega, scrive il report). Le 4 modalità in `src/cli/commands/strategies/`: `roundRobin.ts`, `orchestrated.ts`, `pipeline.ts`, `hybrid.ts` (round di discussione + voto, non un `mode` a sé — è un modificatore che roundRobin/orchestrated inseriscono dopo ogni round se `discussionRounds>0`, coerente con l'architettura esistente). Utility condivise in `strategies/common.ts` (`runMemberTurn`, protocollo di stato, `TeamRunConfig`, `TeamStrategy`/`TeamResult`/`TeamRunArgs`, `seedTeamMessages`). Scrittura del report JSON estratta in `workflowLog.ts` (necessaria per stare sotto le 150 righe). `TeamStrategy.run` prende un bundle di argomenti (non `(ctx,team,task)` puro come nello schizzo del planning: servono anche `maxRounds`/`interrupt`/`teamMessages`/`turnLog`) — le funzioni concrete (`runRoundRobin` ecc.) restano comunque esportate con la loro firma posizionale storica, usata direttamente dai test. **Zero modifiche ai test**: tutti gli export consumati da `goal.ts` e da `tests/` (`runRoundRobin`, `runOrchestrated`, `runPipeline`, `runMemberTurn`, `TurnStats`, `hasCompletionMarker`, `hasUnanimousApproval`, `parseOrchestratorDecision`, `hasDoneSignal`) sono ri-esportati da `team.ts`. Build strict verde, 23/23 suite verdi (incluse le 25 di `test_team_modes.ts` e le 32 di `test_protocol_parsing.ts`, invariate). Mappa file aggiornata in `AGENTS.md`. |
| T5.1 | ✅ Fatto | `Agent.estimateTokens`/`estimateMessagesTokens` da statici a istanza, con rapporto caratteri/token tarato via media mobile (peso 0.2) su `usage.prompt_tokens` reale. Seed invariato (3.5). `tests/test_token_calibration.ts` verifica convergenza. |
| T5.2 | ✅ Fatto | `.github/workflows/test.yml`: su push/PR, matrice `ubuntu-latest`/`windows-latest` × Node 20, `npm ci` → `npm run build` → `npm test`. Nessun segreto, nessuna rete verso LLM (tutti i test registrati in `tests/run_tests.ts` usano `MockLLMProvider` o logica pura). Verificato localmente il ciclo completo `npm ci` + `npm run build` + `npm test` da installazione pulita: verde. |
| T5.3 | ✅ Fatto | Riscritta la Tappa 7 (mantenuta la numerazione cronologica reale della guida, non spostata a posizione 6 — vedi nota nel report finale) con le 4 strategie a confronto (tabella), il protocollo a tool call vs regex, l'isolamento della concorrenza in `/goal` (T3.1+T3.2), i test col mock come documentazione eseguibile. Passata di verifica su tutta la guida (agente di ricerca dedicato, 9 claim controllati contro il codice): corretti "~40 righe" per `Agent.run()` (ora ~150), il limite di I/O (5MB lettura file / 50KB output comandi, erano presentati come un solo numero), il filtro env var (pattern reale più ampio di `*_API_KEY`), il rapporto caratteri/token (ora calibrato a runtime, non fisso), il conteggio benchmark (3 categorie ma 5 casi, non "3 test"). Aggiornata anche la riga "Protocollo STATO" → "Protocollo di coordinamento a tool call" nella tabella §3 e aggiunta una riga "Isolamento dei branch paralleli". Tutti gli altri claim controllati (Tappe 1,3,4,6,9,10, tabelle §3, esistenza file) confermati veri, nessuna modifica. |
| T11.1 | ✅ Fatto | Whitelist `files` in `package.json`, creato `.npmignore` esplicito, script `prepublishOnly`. Verificato con `npm pack --dry-run`: tarball da 180KB contenente solo codice compilato (`dist/`), preset, ruoli, tratti, character e schemi tool (zero test, zero log, zero cartelle di run). |
| T11.2 | ✅ Fatto | Boot resiliente all'avvio su provider non raggiungibili con istruzioni di avvio (Ollama/OpenRouter/tsuka init); intercettazione e formattazione contestuale per errori `ECONNREFUSED` / `401 Unauthorized` nel REPL. |
| T11.3 | ✅ Fatto | Workflow GitHub Actions `.github/workflows/test.yml` esteso alla matrice Ubuntu, Windows e macOS su Node.js 20 e 22, con step automatico di build, test e packaging dry-run. |
| T11.4 | ✅ Fatto | Sezione "⚡ Quickstart (60 seconds)" / "Guida Rapida in 60 Secondi" a 3 comandi posizionata in evidenza a inizio `README.md` e `README-it.md`. |
| T11.5 | ✅ Fatto | Dynamic Context Window Auto-Detection: implementato `detectContextWindow` per llama-server (`/props`, `/slots`), Ollama (`/api/show` model_info e num_ctx), OpenRouter e vLLM (`/models`); `ConfigManager` applica precedenza runtime con fallback statico da config; visualizzazione sorgente limite in `/context` e pannello di avvio; 10/10 check in `tests/test_context_detection.ts`. |
| T11.6 | ✅ Fatto | Token-Driven History & Dynamic Command Timeout: potatura cronologia guidata dai token effettivi con soffitto a 500 messaggi; timeout di `execute_command` reso dinamico via parametro `timeout_ms` e configurabile con `commandTimeoutMs` in `tsuka.config.json`. |
| T11.7 | ✅ Fatto | Blackboard Visibility & Goal Persistence: salvataggio report `/goal` con snapshot blackboard in `workflow_logs/`; visualizzazione note a fine goal; comando `/blackboard` per consultare gli ultimi workflow. |
| T11.8 | ✅ Fatto | Self-Healing History & Malformed Tool Call Sanitization: auto-riparazione euristica di stringhe JSON troncate e sanificazione preventiva degli argomenti salvati in `this.messages` per scongiurare crash HTTP 500 dal parser C++/Jinja di llama-server su chiamate successive; suite `tests/test_toolcall_sanitization.ts`. |
| T11.9 | ✅ Fatto | Codebase-Wide JSON Resilience & Protocol Hardening: estensione del motore `jsonRepair.ts` alle strategie di coordinamento multi-agente (`report_status`, `cast_vote`, `route_next`), al benchmark runner DSL (`extractJson`, `parseArgs`) e all'esecuzione runtime dei tool in `ToolRegistry.executeTool`. |
| T12.1 | ✅ Fatto | Evoluzione `browse_url`: Parsing HTML strutturato ad alta fedeltà con `node-html-markdown`, estrazione Reader View (scarto nav, footer, script, cookie banner), conversione tabelle GFM, estrazione immagini/video con URL assoluti per agenti Vision LLM; suite `tests/test_browser_evolution.ts` (9 check OK). |
| T12.2 | ✅ Fatto | Fix di code review pre-release v0.3.0: `characters/neelix.json` ricostruito con i campi richiesti da `CharacterConfig` (`aiName`, `creativity`, `reasoningEffort`) — la versione precedente, priva di `aiName`, avrebbe prodotto un system prompt `"You are undefined"` per quel personaggio; allineamento colonne in `/tools` (`src/cli/commands/tools.ts`) corretto sostituendo `.padEnd()` su stringhe già colorate chalk (i codici ANSI ne gonfiavano la lunghezza) con padding calcolato via `CLITheme.cleanLen()`. |
| T12.3 | ✅ Fatto | Leggibilità: split di `src/cli/commands/goal.ts` (821 righe, il file più grande del progetto) sul modello già usato da `/team` (`strategies/{common,hybrid,orchestrated}.ts`) — prompt-building (`formatAgentSignature`, `buildTeamBlueprints`, `buildGoalOrchestratorPrompt`, `rolesOf`) estratto in `goalPrompts.ts`; parsing dell'output del modello (`parsePlan`, `parseAgentLine`, normalizzazione nomi) estratto in `goalParsing.ts`; `goal.ts` ridotto a orchestrazione (`handleGoal` + helper di display, 517 righe) e ri-esporta i nomi spostati per compatibilità con `tests/test_goal_orchestrator.ts` e `tests/test_protocol_parsing.ts`, invariati. Nessuna modifica di comportamento: 55/55 suite verdi, `tsc --noEmit` pulito. |
| T12.4 | ✅ Fatto | Consolidamento post-split T12.3: `showContextBar` (era locale a `goal.ts`) diventa `CLITheme.contextBar` in `src/cli/ui.ts`, riusata anche da `/context` (`handleContext`, prima disegnava la sua barra a mano) con un `suffix` opzionale per la sorgente del limite di contesto. Deduplicata la formula caratteri→token, prima triplicata a mano (`Agent.estimateMessagesTokens`, l'helper locale di `goal.ts`, il calcolo inline di `handleContext`): estratta come `sumMessageChars`/`estimateMessagesTokens` in `src/core/contextBudget.ts` (rapporto fisso, per stime fuori da un `Agent` o su più agenti effimeri come `/goal`); `Agent` la riusa internamente passando il proprio rapporto calibrato a runtime, e lo stesso rapporto calibrato è ora usato anche da `/context` (più preciso della costante fissa, avendo un `Agent` singolo a disposizione). Migrati a `logSink` (invece di `console.log`) tutti i punti toccati in `goal.ts`, `session.ts` e il nuovo `CLITheme.contextBar` — coerente con la direzione già scritta in `docs/architecture.md` §16 (passo 2, "chiudere i `console.*`", verso un transport condiviso CLI/TUI). Il resto dei `console.*` nel resto della codebase (~24 file) resta backlog invariato, non nel perimetro di questo task. 55/55 suite verdi, `tsc --noEmit` pulito. |
| T13.1 | ✅ Fatto | Escalation Multi-Agente & Orchestrazione Proattiva con Depth Guard: implementati i tool `request_goal`, `request_team`, `request_call` (RESTRICTED) per permettere all'agente singolo di proporre l'escalation su task complessi/multidisciplinari previa autorizzazione utente; introdotto `WorkflowScope` (`AsyncLocalStorage`) come freno anti-ricorsione che esclude/blocca i tool di escalation quando un workflow padre è già attivo (`depth >= 1`); suite `tests/test_escalation_tools.ts` (13 check OK). |
| T13.2 | ✅ Fatto | Estesa la migrazione a `logSink` (T12.4) a tutta la famiglia multi-agente: `call.ts`, `team.ts`, `strategies/{common,hybrid,orchestrated,roundRobin,pipeline}.ts` e i tre tool di escalation `request_{goal,team,call}.ts` (che invocano proprio `handleGoal`/`handleTeam`/`handleCall` — lasciarli su `console.log` diretto avrebbe rotto la coerenza appena introdotta). `CLITheme` stessa (banner, box, success/error/warning/info, ecc., ~30 chiamate) resta backlog: sono le primitive di rendering di base, un cambio più ampio e a sé stante. 55/55 suite verdi, `tsc --noEmit` pulito. |
| T13.3 | ✅ Fatto | `CLITheme` (`src/cli/ui.ts`) migrata a `logSink`: banner, box, agentPanel, success/error/warning/info, badge, agentThought/agentAction, printModelChanged, printDivider, help — tutte le primitive di rendering di base ora passano dal sink, intercettabili da un `setLogSink()` futuro. Lasciati intenzionalmente fuori: `console.clear()` in `banner()` (nessun equivalente in `LogSink`, che ha solo `log/warn/error`; uno "svuota schermo" è comunque legato al terminale) e `createSpinner`/`InteractiveMenu.select` (`ora`/`prompts` fanno rendering interattivo in-place sullo stdout, non "una riga di log" — problema diverso, non nel perimetro di questo task). Console.* rimanenti nel resto della codebase (`cli/index.ts`, `initCmd.ts`, `interrupt.ts`, `shared.ts`, `stream.ts`, comandi `blackboard/effort/memory/provider`, `core/agent.ts`, `safety/permissions.ts`) restano backlog — `core/logSink.ts` e `core/logBuffer.ts` invece **non vanno toccati**: sono l'infrastruttura stessa (il sink di default e l'intercettore di `console.log` per il buffering dei branch paralleli di `/goal`). 55/55 suite verdi, `tsc --noEmit` pulito. |
| T13.4 | ✅ Fatto | Nuovo comando `/continue [traccia]` (`src/cli/commands/continueSession.ts`): colma il gap fra la persistenza passiva del ragionamento (T9.12, `Agent.persistReasoningTrace` → `memory/thinking/*.md` + puntatore in `MemoryStore`) e un agente respawnato senza history, che spesso rilegge la spec da zero invece di richiamare di sua iniziativa `recall_memory`+`read_file` sul puntatore. `/continue` inietta la traccia scelta (arg per match sul filename, menu interattivo in TTY, la più recente in non-TTY) direttamente nel turno successivo con l'istruzione esplicita "non ripartire da capo, decidi e agisci ora" — sostituendo `messageToSend` a `trimmedInput` nel loop REPL (`cli/index.ts`) invece di consumare il comando con un `continue` come gli altri. Suite `tests/test_continue_command.ts` (14 check OK, isolata via `TSUKA_HOME` temporanea). 56/56 suite verdi, `tsc --noEmit` pulito. |

Tutti i task pianificati e di backlog sono completati con 56 suite di test verdi.

---

## T0.1 — Igiene repo e output agenti

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** alta

Spostare gli output generati dagli agenti fuori dalla root del repo e proteggerla da
inquinamento futuro.

- Creare `output/` nella root; spostarci `zmar3.txt` e ogni altro file di lavoro generato.
- Aggiungere `output/` a `.gitignore`.
- Allineare la versione: `package.json` → `0.2.0`.

**Accettazione:** `git status` non mostra file di output degli agenti; build e test verdi.
**Fuori scope:** non fare commit — lo fa l'umano dopo revisione.

## T0.2 — Attivare la jail del workspace

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** alta

La jail esiste (`resolveSafePath` in `src/tools/impl/utils.ts`) ma `workspaceRoot` non è
impostato in `tsuka.config.json`, quindi i file tool scrivono ovunque.

- Impostare `workspaceRoot` in `tsuka.config.json` (valore: la cartella di lavoro corrente
  dell'utente; verificare con `apphome.ts` la distinzione app home / workspace).
- Verificare che tutti i tool file-based (`readFile`, `writeFile` ecc.) passino da
  `resolveSafePath` — se qualcuno non lo fa, correggerlo.
- Test: tentativo di scrittura fuori dal workspace → errore descrittivo, dentro → ok.

**Accettazione:** test nuovo in `tests/` che dimostra il rifiuto fuori-jail; suite verde.

## T1.1 — MockLLMProvider scriptabile

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** massima (sblocca T1.2, T2.x, T4.x)

Creare `tests/mocks/mockProvider.ts`: una classe con la stessa interfaccia pubblica di
`LLMProvider` (`src/core/provider.ts`) che risponde da un copione predefinito invece di
chiamare un endpoint.

- API proposta: `new MockLLMProvider(script)` dove `script` è un array di risposte; ogni
  risposta può contenere `content`, `toolCalls`, `stats` simulate. Metodo `callLog` per
  ispezionare a posteriori i messaggi ricevuti a ogni chiamata.
- Deve supportare `chatWithTools` (con e senza `onChunk`), `getCurrentModel`,
  `setCurrentModel`, `listModels`.
- Se il copione si esaurisce, lanciare un errore esplicito (test mal scritto, non loop).
- Scrivere una mini-suite `tests/test_mock_provider.ts` che verifica il mock stesso.

**Accettazione:** un `Agent` (`src/core/agent.ts`) costruito col mock completa un ciclo
ReAct a 2 round (tool call → tool result → risposta finale) in modo deterministico.
**Fuori scope:** non modificare `LLMProvider` reale; se serve estrarre un'interfaccia
TypeScript comune (`ILLMProvider`), farlo con zero cambi di comportamento.

## T1.2 — Suite di test per le modalità team e /goal

**Dipende da:** T1.1 · **Sforzo:** medio-alto · **Priorità:** massima

Test deterministici per l'orchestrazione in `src/cli/commands/team.ts` e `goal.ts`,
usando `MockLLMProvider`. Un file per area: `tests/test_team_modes.ts`,
`tests/test_goal_orchestrator.ts`.

Scenari minimi (felice + rottura per ciascuno):

| Modalità | Felice | Rottura |
|---|---|---|
| round-robin | `STATO: COMPLETATO` → early stop | nessun marker → stop a max round |
| orchestrated | routing seguito | risposta non parseabile → fallback round-robin |
| pipeline | catena completa | `STATO: FALLITO` → stop |
| hybrid/voting | unanimità → completato | un `MODIFICARE` → turno extra |
| /goal | piano eseguito, stats raccolte | blocco `PARALLELO` → tutti gli step eseguiti |

- Se le funzioni di team/goal non sono iniettabili col mock (istanziano il provider
  internamente), fare il refactor **minimo** per l'iniezione via `CommandCtx` — nessun
  altro cambiamento.
- Registrare le nuove suite in `tests/run_tests.ts`.

**Accettazione:** almeno 10 scenari; ogni test gira senza rete né LLM in <5s; suite verde.

## T1.3 — Test del parsing di protocollo con input sporchi

**Dipende da:** nessuno (parallelo a T1.1) · **Sforzo:** basso · **Priorità:** alta

`tests/test_protocol_parsing.ts` per le funzioni pure: `parsePlan`, `parseAgentLine`,
`parseOrchestratorDecision`, `hasDoneSignal`, `hasCompletionMarker`,
`hasUnanimousApproval` (in `src/cli/commands/goal.ts` e `team.ts` — esportarle se
necessario, senza spostarle).

Input realistici da modelli piccoli: marker dentro blocchi markdown, maiuscole/minuscole
sbagliate, `STATO : COMPLETATO` con spazi, `AGENTE: @nome` con nome inesistente, marker a
metà frase, risposta vuota, risposta in inglese (`STATUS: DONE`).

**Accettazione:** ≥15 casi; per ogni caso è documentato (commento) il comportamento
atteso: parse riuscito, fallback, o rifiuto. I casi che oggi falliscono in modo indesiderato
vanno marcati `// TODO T2.1` e NON corretti qui.

## T2.1 — Tool call di protocollo: report_status, route_next, cast_vote

**Dipende da:** T1.2, T1.3 · **Sforzo:** alto · **Priorità:** alta

Sostituire il coordinamento a stringhe con tool call strutturate; le regex restano come
fallback esplicito.

- Tre tool nuovi in `src/tools/impl/` + schemi in `tools_schemas/`:
  - `report_status(status: "COMPLETATO"|"DA_CONTINUARE"|"FALLITO", summary, next_hint?)`
  - `route_next(agent: string | "FINE", reason)`
  - `cast_vote(vote: "APPROVO"|"MODIFICARE"|"RIFIUTO", reason)`
- riskLevel `SAFE`; disponibili solo nei contesti giusti (membri team / orchestrator /
  round di voto) via `allowedTools` — non nella chat normale.
- Ordine di decisione: tool call → regex esistente → default. Ogni caduta di livello emette
  una riga gialla in UI e una voce nel workflow log.
- Aggiungere campo `protocol: "tool_call"|"regex"|"fallback"` per turno nei report di
  `workflow_logs/`.
- Aggiornare i prompt di sistema dei turni team/orchestrator perché istruiscano il modello
  a usare i tool.
- Estendere i test T1.2: per ogni modalità, scenario "modello usa il tool" + scenario
  "modello scrive solo testo" (fallback + segnalazione verificata).

**Accettazione:** tutte le suite verdi senza modificare i test di T1.2 esistenti (solo
aggiunte); nei workflow log compare `protocol` per ogni turno.
**Fuori scope:** non rimuovere le regex; aggiornare `AGENTS.md` e
`docs/guida-didattica.md` (§ pattern multi-agente) con il nuovo protocollo.

## T3.1 — Mutex sui permessi per l'esecuzione parallela

**Dipende da:** T1.2 · **Sforzo:** medio · **Priorità:** alta

Bug: in `src/cli/commands/goal.ts` (blocco `PARALLELO`, `Promise.all`) gli agenti
condividono `PermissionManager` e stdin — due richieste RESTRICTED concorrenti producono
prompt sovrapposti.

- Aggiungere una promise-chain interna a `PermissionManager` (`src/safety/permissions.ts`):
  le chiamate a `checkPermission` si accodano; l'utente vede un prompt alla volta, con
  indicazione di quale agente sta chiedendo.
- Test con mock: due agenti paralleli che chiedono permessi → prompt serializzati (mockare
  `InteractiveMenu`/`prompts` per il test).

**Accettazione:** test che dimostra la serializzazione; nessun cambio per il caso singolo.

## T3.2 — Workspace isolati e merge per i branch paralleli

**Dipende da:** T0.2, T3.1 · **Sforzo:** alto · **Priorità:** media

- Ogni step di un gruppo `PARALLELO` lavora in `workspace/parallel-<n>/` (creata al volo,
  passata come jail temporanea per quel turno).
- A fine blocco: merge dei file prodotti nella workspace principale; se due branch hanno
  scritto lo stesso path con contenuto diverso → conflitto elencato all'utente, nessuna
  sovrascrittura silenziosa.
- Output console: buffer per-agente durante il parallelo, flush ordinato a fine blocco,
  indicatore live minimale.

**Accettazione:** test con 2 agenti mock che scrivono file distinti → entrambi nel merge;
stesso file con contenuto diverso → conflitto segnalato, file principale intatto.

## T4.1 — Tipi condivisi del layer di protocollo

**Dipende da:** T2.1 · **Sforzo:** medio · **Priorità:** media

Creare `src/core/types.ts` con: `ChatMessage` (il tipo messaggi già ripetuto inline in
`agent.ts`/`provider.ts`), `TeamConfig`, `PlanStep`, `TurnOutcome`, `Vote`,
`ProtocolSource`. Sostituire gli `any` nei punti di parsing e passaggio dati di
`team.ts`, `goal.ts`, `agent.ts`, `provider.ts`.

**Accettazione:** `grep -c ": any"` su `team.ts` + `goal.ts` scende da 38 a <10; build
strict verde; nessun test modificato.
**Fuori scope:** non tipizzare tutto il repo — solo il layer di protocollo/orchestrazione.

## T4.2 — Split di team.ts in strategie

**Dipende da:** T1.2, T2.1, T4.1 · **Sforzo:** alto · **Priorità:** media

- Interfaccia `TeamStrategy { run(ctx, team, task): Promise<TeamResult> }`.
- Quattro file in `src/cli/commands/strategies/`: `roundRobin.ts`, `orchestrated.ts`,
  `pipeline.ts`, `hybrid.ts`. Utility condivise (`runMemberTurn`, marker, seeding history)
  in un modulo comune.
- `team.ts` ridotto a dispatcher (~100 righe): carica il team JSON, sceglie la strategia,
  delega.

**Accettazione:** i test di T1.2/T2.1 passano **senza alcuna modifica** (prova di
comportamento invariato); `team.ts` <150 righe; aggiornare la mappa file in `AGENTS.md`.

## T5.1 — Calibrazione dinamica della stima token

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** bassa

`Agent.estimateTokens` usa 3,5 char/token fisso (tarato sull'inglese). L'API restituisce
`usage.prompt_tokens` reale: mantenere in `Agent` una media mobile del rapporto
chars/token osservato (seed 3,5, aggiornata dopo ogni risposta con usage disponibile) e
usarla in `estimateTokens`/`estimateMessagesTokens`.

**Accettazione:** test unitario: dopo N osservazioni simulate il rapporto converge; con
zero osservazioni si comporta come oggi.

## T5.2 — CI GitHub Actions

**Dipende da:** T1.2 · **Sforzo:** basso · **Priorità:** bassa

`.github/workflows/test.yml`: su push e PR → `npm ci`, `npm run build`, `npm test`, Node
20, ubuntu + windows (il progetto è cross-platform, `platform.ts`).

**Accettazione:** workflow verde su entrambi gli OS senza segreti né rete verso LLM.

## T5.3 — Tappa 6 della guida didattica + verifica claim

**Dipende da:** T4.2 · **Sforzo:** medio · **Priorità:** media

- Scrivere in `docs/guida-didattica.md` la Tappa 6: "da un agente a N agenti coordinati" —
  le quattro strategie confrontate, il protocollo a tool call e perché le regex non bastano
  coi modelli piccoli, i test col mock come documentazione eseguibile.
- Passata di verifica su TUTTA la guida: ogni affermazione deve puntare a codice ancora
  vero (file e comportamento). Elencare nel report ogni claim corretto o aggiornato.

**Accettazione:** report finale con l'elenco dei claim verificati; nessun riferimento a
file/funzioni inesistenti.

---

## Grafo delle dipendenze

```
T0.1 ─┐                       T1.3 ──┐
T0.2 ─┼─ (indipendenti)              ├─→ T2.1 ─→ T4.1 ─→ T4.2 ─→ T5.3
T5.1 ─┘                              │      
T1.1 ─→ T1.2 ────────────────────────┤
              ├─→ T3.1 ─→ T3.2       │
              └─→ T5.2               
```

Parallelizzabili subito: T0.1, T0.2, T1.1, T1.3, T5.1.
Percorso critico: T1.1 → T1.2 → T2.1 → T4.1 → T4.2 → T5.3.

---
---

# FASE 2 — Loop di controllo, memoria a due livelli, installazione

> Stesse regole della fase 1 (vedi intestazione del file): leggere `AGENTS.md` prima di
> iniziare, italiano nei commenti, TS strict/CommonJS/no Ink, `npm test` verde + `npm run
> build` pulito prima di dichiarare completato, nessuna degradazione silenziosa, non
> toccare comportamenti fuori dal task.

## Stato

| Task | Stato | Note |
|------|-------|------|
| T6.1 | ✅ Fatto | `MemoryFact` con `scope`/`kind`/`tags`/`pinned`/`hits`/`lastUsed`; lettura scoped (proprio scope + `'globale'`, i fatti legacy senza scope normalizzati a `'globale'` in memoria, senza riscrivere il file); eviction a punteggio (kind dominante, poi rango di freschezza d'uso, poi hits) con i `pinned` mai espulsi; `search()` a scoring OR che aggiorna `hits`/`lastUsed`; `formatRelevant(taskText,…)` collegato in `shared.ts:152` con `formatForPrompt()` come fallback. `taskText` propagato nei 4 call-site dove il compito era già disponibile (call/common/hybrid/spawnAgent); `cli/index.ts` non toccato (nella chat REPL l'agente nasce prima che l'utente scriva → fallback). Taggati `kind:'run'` i due punti che inquinavano la memoria lunga (`agent.ts:239`, `goal.ts:203`). Terzo parametro `scope?` nel costruttore per testare l'isolamento senza mockare `ConfigManager`. `tests/test_memory_scope.ts`, 17 casi; `test_memory.ts` invariato e verde. Verificato che i test (c) e (d) fallissero sul codice pre-modifica. Nota: l'ordinamento per freschezza usa un contatore logico monotono, non `lastUsed`, perché la risoluzione dell'orologio Windows (~15 ms) rendeva instabile lo spareggio. Build pulito, 26 suite verdi (verifica indipendente rifatta dopo la consegna). |
| T6.5 | ✅ Fatto | Aperto dalla verifica di T6.1. Un solo punto di isolamento: `TSUKA_MEMORY_FILE` letta nel costruttore di `MemoryStore` **solo** quando il chiamante non passa un `filePath` esplicito (i test che già usano un file dedicato restano inalterati); il singleton `getInstance()` costruisce senza argomenti e quindi eredita l'override. `tests/run_tests.ts` crea la cartella con `fs.mkdtempSync(os.tmpdir())` — fuori dal repo, nessun artefatto residuo — imposta la variabile prima del loop sulle suite (ereditata dai child process di `spawnSync`) e ripulisce a fine corsa. Rimossa la toppa di backup/ripristino manuale in `test_memory.ts`. Variabile assente → comportamento di produzione identico. **Accettazione verificata due volte** (agente + verifica indipendente): hash di `memory/memory.json` identico prima e dopo un `npm test` completo, 3 fatti reali intatti; sul codice pre-fix lo stesso confronto mostrava 3 fatti `kind:'run'` in più e `hits` alterati. Build pulito, 26 suite verdi. |
| T6.2 | ✅ Fatto | `src/core/blackboard.ts` (`newRunId`/`forRun`/`withRun`/`current`/`endRun` + `post`/`read`/`list`/`snapshot`), tool SAFE `post_note`/`read_notes` con schemi, offerti solo nei turni di team/goal come i tool di protocollo di T2.1. Isolamento con `AsyncLocalStorage` sul `runId` (stesso schema di `withWorkspaceOverride`/`logBuffer`), **non** un singleton: i branch di uno stesso blocco `PARALLELO` condividono la lavagna (sono lo stesso run), run diversi no. `endRun` in `finally` sia in `team.ts` sia in `goal.ts`: la lavagna non sopravvive al run nemmeno se la strategia lancia. Snapshot nel report JSON via `workflowLog.ts`. Confine rispettato: `blackboard.ts` non importa mai `MemoryStore`, e i tool falliscono esplicitamente fuori da un run attivo invece di ripiegare in silenzio. `post()` è un log ordinato, non una mappa: chiavi ripetute non si sovrascrivono. Autore della nota via `requesterLabel` aggiunto a `ToolExecutionContext` (additivo) invece della variabile globale `currentSenderName` di `messageQueue.ts`, che non è scoped per branch. `tests/test_blackboard.ts`, 16 casi: (a) end-to-end attraverso lo stack reale Agent→ToolRegistry→tool, (b) nota nel JSON del workflow log, (c) due `runRoundRobin` reali in `Promise.all` che non si vedono. L'agente ha sabotato temporaneamente l'ALS con una variabile globale per provare che il test (c) intercetta la regressione (4 assert caduti), poi ripristinato — verificato indipendentemente: nessun residuo. Fuori perimetro, non fatto: `/goal` continua a non scrivere workflow log su disco. Build pulito, 27 suite verdi, `memory/memory.json` invariato (doppia verifica). |
| T6.3 | ✅ Fatto | Nuovo `src/core/loop.ts` (`runLoop`, `calculateAttemptSignature`, `checkAcceptance` per command/fileExists/jsonValid), gestione dello stallo su firme identiche (`no_progress`), passaggio delle issue dai tentativi precedenti nel prompt e registrazione sulla `Blackboard`. `tests/test_loop.ts` (9 check: 4 scenari minimi A, B, C, D + normalizzazione della firma). Build strict e 40 suite test OK. |
| T6.4 | ✅ Fatto | Collegato `runLoop` a `strategies/pipeline.ts` (verifica ed autocorrezione stazioni con `acceptance` configurata o team `acceptance`) ed a `goal.ts` (ciclo di rilavorazione guidato dal verdetto negativo dell'Overseer finale per la risoluzione del gap 'Nessun early break'). Test `PLT4`, `PLT5` in `test_team_modes.ts` e `G3` in `test_goal_orchestrator.ts`. Piena retro-compatibilità preservata sui team/goal privi di acceptance. `AGENTS.md` aggiornato. |
| T7.1 | ✅ Fatto | `characters/dev.json` (developer/professional) e `characters/segugio.json` (researcher/laconic) colmano i due buchi. Manifest in `presets/`: `core.json` + `packs/{osint,content,devops,demo}.json`, formato `{name, displayName, description, roles[], traits[], characters[], teams[], note?}` — liste di nomi-file, nessuno spostamento né cancellazione, pensato perché `tsuka init` (T7.2) copi solo il sottoinsieme scelto. Core: `overseer`, `dev`, `segugio`, `pipeline_pro`, `data_sage`, `wordsmith`, `piccione` (un ruolo distinto ciascuno, validato dal test). Pack `demo` con `note` che spiega il valore didattico di `compliant`/`sensual`. `tests/test_presets.ts`: copertura dei ruoli + validità dei manifest + auto-consistenza del core. Verificato il fallimento sul codice pre-task (8 FAIL, fra cui `role-coverage-developer`), poi 103 passati. Build pulito, 28 suite verdi. Scelta interpretativa dichiarata dall'agente: `blunt` resta nei traits del core pur non essendo usato da nessun character core, come tratto di scorta per la ricombinazione via `/trait`. |
| T7.3 | ✅ Fatto | Aperto dalla verifica di T7.1, e più esteso di quanto segnalato: **tre** team su sette referenziavano personaggi inesistenti — `pippo` in `dev_ops`, `dev_security` e `legal_research`, `salvo` in `dev_security`. Un membro non risolto non fa fallire il team: `resolveCharacter` torna `null`, `common.ts:155` avvisa e salta, quindi `/team dev_security` girava con 2 membri su 4. Sostituiti con i personaggi che ora esistono: `pippo` → `dev`, `salvo` → `piccione` (sysadmin/devils_advocate, coerente col ruolo di ispezione descritto nel team). Aggiornati anche `displayName` e `description`, che nominavano i personaggi fantasma. Nuova sezione 5 in `tests/test_presets.ts`: ogni membro e ogni orchestrator di ogni team esiste in `characters/`. Regressione provata rimettendo `pippo` in `dev_ops` (1 FAIL) e ripristinando (132 passati). Build pulito, 28 suite verdi, memoria invariata. |
| T7.2 | ✅ Fatto | Comando CLI `tsuka init [--preset core|full] [--pack <nome,...>] [--force]` in `src/cli/initCmd.ts`, gestito in `index.ts` prima del REPL. Creazione della struttura `.tsuka/{memory,workflow_logs,output,roles,traits,characters,teams}`, copia asset dai manifest preset/pack, discovery dei server LLM locali e scrittura di `config.json`. Risoluzione gerarchica in `src/core/apphome.ts` (`homePath` predilige `.tsuka/` della workspace). Test `tests/test_init.ts` (12 check: init pulito, re-init senza `--force` bloccato, `--force` abilitato, `--pack osint`). 41 suite test OK e TypeScript strict verificato. |

## Perché questa fase

Tre buchi reali, misurati sul codice attuale:

1. **Il loop non esiste.** Il "loop" odierno è un `for` su round con early stop
   *auto-dichiarato da chi lavora* (`report_status`): l'esecutore è anche il giudice.
   In `/goal` il piano viene eseguito fino in fondo e il verdetto finale dell'overseer
   non retroagisce (`AGENTS.md`: "Nessun early break"). Manca un criterio di uscita
   oggettivo e manca la correzione guidata dal fallimento.
2. **La memoria condivisa è un archivio piatto.** È globale a tutte le workspace
   (`homePath('memory','memory.json')`), l'eviction è FIFO cieca (`memory.ts:109`), la
   ricerca richiede che *tutte* le keyword compaiano (`memory.ts:135`, AND rigido → quasi
   sempre zero risultati) e nel prompt vengono iniettati gli *ultimi* 10 fatti, non i più
   rilevanti (`shared.ts:152`). In più `/goal` ci scarica i dettagli condensati di ogni
   turno (`goal.ts:203`), quindi la memoria lunga si riempie di scarti di run.
3. **Il catalogo personaggi ha un buco che blocca `/goal`.** Nessuno dei 21 file in
   `characters/` usa il ruolo `developer`: siccome `/goal` sceglie fra i *personaggi*,
   su un harness che scrive codice non può mai assegnare un compito a uno sviluppatore.
   Il ruolo `researcher` è coperto solo da `yes_lawyer`, che ha trait `compliant`.

## T6.1 — Memoria: scope per workspace e retrieval per rilevanza

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** alta (sblocca T7.2)

Rendere `src/core/memory.ts` utilizzabile su più progetti e far sì che ciò che finisce nel
system prompt sia *pertinente* al compito, non semplicemente recente.

- `MemoryFact` guadagna: `scope` (slug stabile derivato da `ConfigManager.getWorkspaceRoot()`,
  oppure `'globale'`), `kind` (`'fatto' | 'decisione' | 'lezione' | 'run'`, default `'fatto'`),
  `tags?`, `pinned?`, `hits`, `lastUsed`.
- **Lettura scoped**: un agente vede i fatti del proprio scope + quelli `'globale'`. I fatti
  esistenti privi di `scope` si caricano come `'globale'` (retrocompatibilità: nessun fatto
  deve sparire aprendo un `memory.json` vecchio).
- **Eviction a punteggio** al posto della FIFO: `pinned` non viene mai espulso; il punteggio
  combina recency, `hits` e `kind` (`'run'` è il primo a cadere, `'lezione'` l'ultimo).
- **`search()` con scoring OR**: oggi un fatto deve contenere *tutte* le keyword. Passare a
  punteggio per keyword trovate (più keyword → più in alto), così una query di 5 parole
  ritorna comunque i fatti migliori. Ordine a parità di punteggio: più recente prima.
  `search()` aggiorna `hits`/`lastUsed` dei fatti restituiti.
- **`formatRelevant(taskText, limit, maxChars)`**: nuova iniezione nel prompt basata sulla
  rilevanza al compito corrente; `formatForPrompt()` resta come fallback quando non c'è un
  testo di task. Collegare in `src/cli/shared.ts:152`.

**Accettazione:** `tests/test_memory_scope.ts` con almeno: (a) fatto salvato nella workspace
A non visibile dalla workspace B, un fatto `'globale'` visibile da entrambe; (b) un
`memory.json` scritto nel formato vecchio si carica senza perdere fatti; (c) query
multi-parola in cui nessun fatto contiene tutte le keyword → oggi 0 risultati, dopo il task
risultati ordinati per punteggio; (d) a `maxFacts` pieno un fatto `pinned` sopravvive e viene
espulso il meno rilevante. `tests/test_memory.ts` esistente deve passare **senza modifiche**:
se rompe è una regressione, non adattarlo.

**Fuori scope:** non spostare la posizione del file di memoria (è T7.2); niente embedding né
database vettoriale — solo scoring su keyword, zero nuove dipendenze; non cambiare la firma
dei tool `save_memory`/`recall_memory` oltre a parametri opzionali additivi.

## T6.5 — Isolare la memoria reale dalla suite di test

**Dipende da:** T6.1 · **Sforzo:** basso · **Priorità:** alta

Emerso durante la verifica di T6.1: **`npm test` sporca la memoria condivisa dell'utente.**

- `tests/test_memory.ts` chiamava `fs.rmSync` sulla cartella `memory/` reale (riga ~65):
  lanciare la suite dalla root cancellava i ricordi. Già corretto con backup/ripristino del
  file, ma è una toppa nel singolo test, non l'isolamento.
- Resta il problema vero: le suite che esercitano `/goal` e `Agent` col mock scrivono
  davvero nella memoria reale via `MemoryStore.getInstance()` (`goal.ts:203`,
  `agent.ts:239`). Dopo un `npm test` compaiono fatti `kind:'run'` con lo scope del repo,
  e `hits`/`lastUsed` dei fatti esistenti risultano alterati.

Serve un solo punto di isolamento: far sì che `MemoryStore.getInstance()` usi un file
temporaneo quando la suite è in esecuzione — per esempio una variabile d'ambiente
(`TSUKA_MEMORY_FILE`) letta in `getInstance()`, impostata da `tests/run_tests.ts` su una
cartella temporanea e ripulita alla fine. Meccanismo unico, valido per ogni test presente e
futuro, invece di backup manuali sparsi.

**Accettazione:** hash di `memory/memory.json` **identico** prima e dopo un `npm test`
completo (è la prova diretta: oggi cambia). Nessun fatto nuovo, nessun `hits` alterato.
Il backup/ripristino aggiunto a mano in `test_memory.ts` va rimosso una volta che
l'isolamento funziona: non devono coesistere due meccanismi. Suite verde.

**Fuori scope:** non cambiare la semantica della memoria in produzione — fuori dai test il
comportamento resta identico a T6.1.

## T6.2 — Blackboard di run (stato condiviso del workflow)

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** alta (sblocca T6.3)

Oggi gli agenti si passano informazione solo via history condensata (lossy) o `send_message`
(effimero, punto-punto). Manca una lavagna comune del run: decisioni prese, artefatti
prodotti, punti aperti.

- Nuovo `src/core/blackboard.ts`: `Blackboard.forRun(runId)`, `post(key, value, author)`,
  `read(prefix?)`, `list()`, `snapshot()`.
- Due tool SAFE, `post_note(key, value)` e `read_notes(prefix?)`, con schema in
  `tools_schemas/`, offerti **solo** nei turni di team/goal come già si fa per
  `report_status`/`route_next`/`cast_vote` (vedi T2.1 e `strategies/common.ts`) — non nella
  chat normale.
- Collegamento: `/team` (strategie) e `/goal` creano una blackboard per il run e la
  propagano; `workflowLog.ts` include lo `snapshot()` nel report JSON.
- Confine netto, da rispettare: **history** = ciò che è stato detto; **memoria** = ciò che
  resta fra le sessioni; **blackboard** = stato di *questo* run, che muore col run.

**Accettazione:** `tests/test_blackboard.ts` con `MockLLMProvider`: (a) l'agente A scrive una
nota nel suo turno e l'agente B la legge nel turno successivo (verificato sull'output del
tool, attraverso lo stack reale, non chiamando la classe a mano); (b) la nota compare nel
JSON in `workflow_logs/`; (c) due run concorrenti (`Promise.all`, come il blocco `PARALLELO`
di `/goal`) non si vedono le note a vicenda.

**Fuori scope:** nessuna persistenza fra sessioni (è compito della memoria); non toccare
`send_message` né la coda in `messageQueue.ts`.

## T6.3 — RunController: il loop esegui → verifica → correggi

**Dipende da:** T6.2 · **Sforzo:** alto · **Priorità:** alta

Nuovo `src/core/loop.ts` con una funzione riusabile — il controllore del ciclo, senza
conoscere team né goal.

Criteri di uscita, **in quest'ordine di affidabilità**:

1. **Acceptance oggettiva**: comando shell con exit 0, file esistente, JSON parsabile.
   È il pezzo che rende il loop non-circolare: senza, un LLM piccolo si dichiara soddisfatto
   di qualsiasi cosa. Un `acceptance.command` è un comando a tutti gli effetti: deve passare
   dalla jail del workspace e dal `PermissionManager`, niente scorciatoie.
2. **Verdetto di un verificatore diverso dall'esecutore** (riuso di `cast_vote`/`report_status`).
3. **Auto-dichiarazione dell'esecutore** (il comportamento di oggi).
4. **Budget esaurito**: `maxAttempts` (default 3), tempo, token.

- **Feedback iniettato**: le `issues` del verificatore diventano il prompt del tentativo
  successivo — testo concreto su cosa correggere, mai un generico "riprova". Transitano
  dalla blackboard (T6.2).
- **Anti-stallo**: firma del tentativo = hash del testo di risposta normalizzato + insieme
  dei file modificati. Due tentativi con la stessa firma → esito `no_progress`, riga gialla
  in UI e voce nel workflow log (regola del repo: nessuna degradazione silenziosa).

**Accettazione:** `tests/test_loop.ts` col mock: (a) primo tentativo fallisce l'acceptance,
secondo la passa → esattamente 2 iterazioni, esito ok; (b) acceptance sempre fallita → stop a
`maxAttempts`, esito `failed`, mai un tentativo in più; (c) due tentativi identici →
`no_progress` *prima* di `maxAttempts`; (d) il testo delle issues del verificatore compare nel
prompt del secondo tentativo (verificato sul `callLog` del mock).

**Fuori scope:** **nessun collegamento** a team/goal in questo task (è T6.4): qui si
consegnano controllore e test. Nessun nuovo comando slash.

## T6.4 — Collegare il loop a pipeline e /goal

**Dipende da:** T6.3 · **Sforzo:** medio · **Priorità:** media

- `strategies/pipeline.ts`: una stazione può dichiarare `acceptance` nel team JSON; se
  fallisce, ritenta con il feedback invece di fermare la catena al primo `FALLITO`.
- `goal.ts`: gli step del piano passano dal controllore e il verdetto negativo dell'overseer
  finale rimette in coda lo step fallito (default: un solo ciclo di rilavorazione) invece di
  chiudere. Chiude il gap "Nessun early break" documentato in `AGENTS.md`.
- Nuovi campi opzionali nel team JSON: `maxAttempts`, `acceptance` (per membro/stazione).
  **Assenti = comportamento identico a oggi.**

**Accettazione:** i test di T1.2/T2.1/T4.2 passano **senza alcuna modifica** — è la prova che
in assenza dei nuovi campi non è cambiato niente; almeno 4 scenari nuovi col mock (ritentativo
riuscito, ritentativo esaurito, rilavorazione innescata dall'overseer, campi assenti →
percorso vecchio). `AGENTS.md` aggiornato.

**Fuori scope:** non modificare il protocollo a tool call di T2.1.

## T7.1 — Catalogo personaggi: colmare i buchi e definire i preset

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** alta (sblocca T7.2)

- Creare `characters/dev.json` (role `developer`, trait `professional`) — oggi **nessun**
  personaggio usa quel ruolo, quindi `/goal` non può assegnare codice a uno sviluppatore.
- Creare un ricercatore generalista non accondiscendente (role `researcher`, trait `laconic`):
  oggi l'unico è `yes_lawyer`, trait `compliant`.
- Manifest dei preset in `presets/`: `core.json` e `packs/{osint,content,devops,demo}.json`.
  Un manifest **elenca** i nomi di roles/traits/characters/teams che compongono il set: non
  sposta e non cancella file, quindi nulla si rompe.
- Composizione del core (una competenza distinta ciascuno, nessun doppione di ruolo):
  `overseer`, `dev`, il ricercatore nuovo, `pipeline_pro`, `data_sage`, `wordsmith`,
  `piccione`; traits `professional`, `reliable`, `blunt`, `laconic`, `creative`,
  `devils_advocate`.
- Il pack `demo` raccoglie `compliant`, `sensual_diva`, `yes_lawyer` con una nota nel
  manifest: servono come esempio didattico di tratti dannosi in un team (un votante
  accondiscendente rende l'unanimità di `hybrid.ts` priva di significato), non come default.

**Accettazione:** test che valida i manifest — ogni nome citato esiste su disco; ogni
character del core referenzia role e trait presenti nel core; per ogni file in `roles/`
esiste almeno un character che lo usa (oggi falso per `developer`: il test deve fallire
sul codice attuale e passare dopo il task).

**Fuori scope:** non cancellare personaggi esistenti; non cambiare `activeCharacter` in
`tsuka.config.json`.

## T7.3 — Team che referenziano personaggi inesistenti

**Dipende da:** T7.1 · **Sforzo:** basso · **Priorità:** alta

Emerso durante la verifica di T7.1. Tre team su sette elencavano membri che non esistono in
`characters/`: `pippo` (in `dev_ops`, `dev_security`, `legal_research`) e `salvo` (in
`dev_security`).

Non è un errore rumoroso: `resolveCharacter` torna `null`, `strategies/common.ts:155` stampa
un avviso e **salta** il membro. Il team gira comunque, con meno agenti di quelli dichiarati —
`/team dev_security` lavorava con 2 membri su 4, e il `displayName` continuava a promettere
"Pippo & Salvo".

- Sostituire i riferimenti con personaggi reali (`dev` e `segugio` esistono da T7.1),
  allineando anche `displayName` e `description`.
- Aggiungere a `tests/test_presets.ts` la validazione: ogni membro e ogni `orchestrator` di
  ogni team esiste in `characters/`.

**Accettazione:** il nuovo controllo fallisce se si reintroduce un membro fantasma (provato) e
passa sul catalogo corretto; suite verde.

**Fuori scope:** non cambiare la logica di skip in `common.ts` — l'avviso a runtime resta una
rete di sicurezza utile, il test serve a non arrivarci mai.

## T7.2 — Comando `tsuka init`

**Dipende da:** T6.1, T7.1 · **Sforzo:** medio · **Priorità:** media

Un comando di installazione che prepara una cartella di lavoro. Non è uno slash command:
va gestito da `process.argv` in `src/cli/index.ts` **prima** dell'avvio del REPL.

```
tsuka init [--preset core|full] [--pack <nome,...>] [--force]
```

- Crea `.tsuka/` nella cartella corrente: `config.json`, `memory/`, `workflow_logs/`,
  `output/`, più gli asset del preset scelto (T7.1) copiati dentro — così il progetto è
  autonomo e l'utente può modificare i suoi personaggi senza toccare l'installazione.
- **Risoluzione asset**: `.tsuka/` della workspace se esiste → altrimenti app home
  (comportamento attuale). Va messa in `apphome.ts`/`shared.ts` in un punto solo, non
  duplicata in ogni loader.
- Provider: riusare `discovery.ts` per rilevare i server vivi e scrivere
  `activeProvider`/`model`; se nessuno risponde, scrivere comunque il config con un avviso
  esplicito invece di fallire.
- Interattivo se lanciato senza flag (`prompts` è già in dipendenze), completamente
  non-interattivo con i flag (serve alla CI). A fine init stampare i prossimi passi
  (`/benchmark`, `/goal`).

**Accettazione:** `tests/test_init.ts`: init in una cartella temporanea → struttura creata,
preset core copiato, config valido; un secondo init senza `--force` non sovrascrive ed esce
con un messaggio chiaro; con `--force` sovrascrive. La memoria scritta dentro `.tsuka/` non
è visibile da un'altra cartella inizializzata (usa lo scope di T6.1). Sezione di
installazione aggiornata in `README.md` e `README-it.md`.

**Fuori scope:** nessuna pubblicazione su npm; **zero cambi di comportamento quando `.tsuka/`
non esiste** — l'uso attuale via `npm run dev` dalla cartella del progetto deve restare
identico.

---

## Grafo delle dipendenze (fase 2)

```
T6.1 ─┬─→ T7.2
T7.1 ─┘

T6.2 ─→ T6.3 ─→ T6.4
```

Parallelizzabili subito: T6.1, T6.2, T7.1.
Percorso critico: T6.2 → T6.3 → T6.4.

---

# FASE 3 — Contesto dei sub-agenti e igiene della memoria

> Stesse regole delle fasi precedenti (vedi intestazione del file): leggere `AGENTS.md`
> prima di iniziare, italiano nei commenti, TS strict/CommonJS/no Ink, `npm test` verde +
> `npm run build` pulito prima di dichiarare completato, nessuna degradazione silenziosa,
> non toccare comportamenti fuori dal task.
>
> **Precedenza:** T6.3, T6.4 e T7.2 sono ancora aperti e vengono prima di questa fase.
> Nessun task qui sotto li blocca e nessuno li duplica.

## Stato

| Task | Stato | Note |
|------|-------|------|
| T8.1 | ✅ Fatto | `spawnAgent.ts`: quando `Blackboard.current()` risolve (run `/team`/`/goal` attivo, stesso `AsyncLocalStorage` del padre), il figlio riceve `[...roleObj.allowedTools, 'post_note', 'read_notes']` — stesso criterio additivo di `strategies/common.ts:184`, **non** nei JSON di `roles/` (verificati byte-identici). Il system prompt guadagna un paragrafo "LAVAGNA DEL RUN" solo quando la lavagna è presente. Fuori da un run: tool invariati, nessun fallimento. `tests/test_spawn_agent_context.ts` (34 asserzioni) verifica end-to-end attraverso lo stack reale Agent→ToolRegistry→tool, nello stile di T6.2. Sabotaggio → 2 FAIL mirati, ripristinato. |
| T8.2 | ✅ Fatto | `sources?: string[]` opzionale e additivo su `getRecent`/`search`/`formatForPrompt`/`formatRelevant` (assente = comportamento identico a prima). Nuovo `filterBySource`: con filtro attivo un fatto è visibile solo se è proprio (`source` ∈ `sources`, qualunque kind) oppure `kind:'lezione'`/`'decisione'` di chiunque — layer ortogonale allo scope di T6.1, applicato dopo `visibleFacts()`. `loadSystemPrompt` lo attiva solo con un `character.aiName`. `test_memory.ts` e `test_memory_scope.ts` verdi **senza modifiche**. Sabotaggio (`filterBySource` no-op) → 5 FAIL, ripristinato. |
| T8.3 | ✅ Fatto | Normalizzazione morfologica a mano in `search()`, **zero dipendenze**: lowercase + NFD/rimozione diacritici + troncamento di **un solo** carattere finale (vocale o `'s'`) e solo su parole >3 caratteri, per non mutilare acronimi tipo API/SQL; applicata sia alla keyword sia all'haystack, al posto del confronto `.includes()` grezzo. Verificato: "corsi"→"corso", "badge"→"badges", "citta"→"città". `maxChars` (prima fisso a 600) ora da `getMemoryMaxChars()` (nuovo getter, default 600, min 100, campo `memoryMaxChars`). Nessun falso positivo nuovo; lo scoring OR multi-keyword di T6.1c resta invariato. Sabotaggio → 2 FAIL, ripristinato. |
| T8.4 | ✅ Fatto | `search()` guadagna `opts?: { sources?, touch? }` con `touch` default `true` (`recall_memory` invariato, non passa `opts`); `formatRelevant` chiama con `touch: false`. Costruire un system prompt non aggiorna più `hits`/`lastUsed` e non scrive più `memory.json`. `formatForPrompt` non chiamava `search()` (solo `getRecent`, senza side-effect), quindi non necessitava modifiche su questo fronte. Prova diretta nella forma di T6.5: hash di `memory.json` **identico** dopo 10 costruzioni di prompt, mentre un `search()` esplicito successivo lo cambia come prima. Sabotaggio (`touch` forzato a `true`) → 5 FAIL inclusa l'invarianza dell'hash, ripristinato. |
| T8.5 | ✅ Fatto | Il resoconto integrale del sub-agente va su `runs/<runId o uuid>/<label>-<ts>-<hex>.md` sotto la app home; al padre torna sintesi (max 400 char) + percorso, sempre ≤3000 caratteri. Con un run attivo il percorso è anche postato sulla lavagna (`post_note('artefatto-sub-agente', …)`), chiudendo il cerchio con T8.1. Verificato che il file sopravvive a una potatura simulata della history del padre e resta rileggibile con `read_file`. **Limite dichiarato dall'agente:** la rilettura richiede che `workspaceRoot` includa la app home (caso comune a singolo progetto); se le due cartelle divergono serve un intervento fuori perimetro. Nessun cambio a `workflowLog.ts`. Sabotaggio → 6 FAIL, ripristinato. |
| T8.6 | ✅ Fatto | `harness.config.json` **non cancellato** (`git ls-files` lo conferma, era il vincolo) ma reso inoffensivo: campo `_legacy` in testa che rimanda a `config.ts`, catalogo provider riallineato a quello vivo (Unsloth incluso) e `activeProvider: "unsloth"` al posto del vecchio `"ollama"` che contraddiceva lo stato reale — così una migrazione oggi produrrebbe uno stato sensato invece di riportare l'utente indietro. Nuova `legacyConfigStillPresent()` in `config.ts` (vera solo quando sopravvivono entrambi i file) usata da `index.ts` per un avviso una tantum; ramo di migrazione e `CONFIG_PATH` invariati. `tests/test_legacy_config.ts` (24 check): usa il pattern padre/figlio con `spawnSync` sullo stesso file, perché `CONFIG_PATH`/`LEGACY_CONFIG_PATH` sono costanti valutate all'import e ogni scenario richiede un processo pulito; lo scenario di migrazione copia il **vero** `harness.config.json` in una `TSUKA_HOME` temporanea invece di un fixture ricostruito, così il test verifica il file che la migrazione consuma davvero. Sabotaggio col vecchio contenuto → 7 FAIL mirati. Commit `e8502d7`. |
| T8.7 | ✅ Fatto | L'errore per `task` >2000 caratteri dichiara la lunghezza effettiva, **vieta esplicitamente l'accorciamento** e indica le due uscite legittime (più `spawn_agent`, uno per compito; oppure `write_file` + percorso nel `task`). Limite invariato a 2000 (verificato: 2000 passa, 2001 blocca). Descrizione del parametro `task` in `tools_schemas/spawn_agent.json` allineata alla stessa prescrizione, così la reazione sbagliata è scoraggiata prima ancora dell'errore. Sabotaggio → 7 FAIL, ripristinato. |
| T8.8 | ✅ Fatto | Nuovo `src/core/contextBudget.ts`: `capForContext(text, maxTokens?, {label?, recoveryHint?})`, tetto in token stimati (~3,5 car./token, stessa convenzione di `Agent.charsPerToken`, ma fissa qui perché il taglio avviene PRIMA che un `Agent` esista). Sopra soglia ritorna testa (60%) + nota `[--- TAGLIATO ... ---]` + coda (40%), lunghezza risultato esattamente pari al tetto; sotto soglia il testo torna invariato. `ConfigManager.getMaxToolResultTokens()` (default 4000, min 256, campo `maxToolResultTokens`), letto da un `ConfigManager` cache-by-mtime su `CONFIG_PATH` (stesso schema già usato in `webSearch.ts`, per non ricaricare/riscrivere il config a ogni chiamata tool). Applicato in tutti e 5 i tool indicati: `readFile`, `executeCommand` (sia il ramo normale sia quello del watchdog di timeout — anche l'output parziale prima del timeout può essere enorme), `grepSearch`, `browseUrl` (ha sostituito il taglio ad-hoc in caratteri preesistente, che non spiegava come recuperare il resto), `webSearch`. Ogni tool passa un `recoveryHint` mirato (read_file → offset/limit o startLine/endLine sulla porzione successiva + grep_search; execute_command → comando più filtrato o lettura del log con offset/limit; grep_search → query più specifica o `path` più ristretto; browse_url → non paginabile, suggerisce web_search o un URL più specifico). `read_file` guadagna `offset`/`limit` (paginazione: offset = riga di partenza 1-indexed, limit = numero di righe) come alias di `startLine`/`endLine`, che restano invariati e hanno la precedenza solo se offset/limit sono entrambi assenti — nessuna rottura per i chiamanti esistenti (`test_phase3_fixes.ts`, `test_safe_tools.ts`). Schema di `read_file` in `tools_schemas/` aggiornato con i due nuovi parametri opzionali. **Fuori dal perimetro dichiarato in TASKS.md ma svolto per coerenza**: `webSearch`/`browseUrl` non erano esplicitamente nell'elenco dei tool con un problema misurato, ma il bullet di implementazione li elenca esplicitamente insieme agli altri tre, quindi applicato a tutti e 5 come richiesto. I limiti in byte esistenti (5MB read_file/grep_search, 50KB execute_command) non sono stati toccati, restano la guardia superiore. `tests/test_context_budget.ts` (39 casi), isolato con `TSUKA_HOME`/`workspaceRoot` temporanei come `test_workspace_jail.ts`: capForContext come unità isolata (testa/coda/nota, testo corto invariato); read_file su file ~200KB sotto tetto con nota che cita offset e grep_search, markers di testa e coda preservati; read_file con offset/limit (con/senza l'uno o l'altro) → finestra esatta, nessuna nota spuria; startLine/endLine invariati (regressione); execute_command e grep_search con output enorme sotto tetto; regressione su risultati piccoli (nessuna nota su file/comandi/grep piccoli); `ConfigManager.getMaxToolResultTokens()` con valore assente/valido/sotto-minimo/non-numerico — quest'ultima sezione eseguita per ultima nel file apposta per non dipendere dalla cache mtime di `contextBudget` usata dalle sezioni precedenti. Verificato il fallimento sabotando singolarmente readFile (9 FAIL), executeCommand+grepSearch (4 FAIL) e il getter di config (1 FAIL), poi ripristinati: nessun residuo (verificato via `git diff`/`git status`, incluso `memory/memory.json` invariato e `tsuka.config.json` reale invariato dal task — l'unica differenza presente in quel file era già lì prima di iniziare). Build pulito, 29 suite verdi (28 preesistenti + la nuova).  |
| T8.9 | ✅ Fatto | Elenco testuale "Available tools" omesso da `loadSystemPrompt` quando `hasNativeFunctionCalling` (nuova, `registry.ts`) è vera; la nota su `save_memory`/`recall_memory` è conservata come da Fuori scope. **Soglia `scores.toolCalling >= 0.9`, allineata al tier `large`**: scelta dichiarata dall'agente come l'unico punto compatibile con un caso già registrato (`RE.10c`, profilo a 0.65) — è conservativa, quindi il risparmio si applica solo ai modelli misurati ≥0.9 e i modelli più deboli continuano a ricevere l'elenco, che è la direzione sicura. `pruneHistory`/`compressHistory`/`calibrateCharsPerToken` sommano ora la dimensione stimata dell'array `tools` (nuovo `toolsChars`, aggiornato per round in `run()`) al budget: la calibrazione altrimenti convergeva a un rapporto falsato, dato che il `promptTokens` reale dell'API i tool li include già. Nuovo `estimateTotalContextTokens()` pubblico. `tests/test_prompt_overhead.ts` (29 check). Sabotaggio di 4 righe → `npm test` restava 32/0 (il baseline registrato non copriva il comportamento: prova che la suite aggiunge copertura reale) e 6 FAIL puntuali sulla suite nuova. Commit `612ef71`. |
| T8.11 | ✅ Fatto | Secondo timer `MAX_GENERATION_MS` (300s, costante accanto a `FIRST_TOKEN_TIMEOUT_MS`, deliberatamente fuori da `config.ts`), armato insieme al primo ma **mai azzerato all'arrivo del primo token**, riusa `attemptAbort`. Errore distinto `[Timeout generazione]` invece di `[Mancata risposta]`: dichiara che il modello *stava* rispondendo, altrimenti si diagnostica il problema sbagliato. **Interpretazione dichiarata dall'agente:** un timeout di generazione **non** fa retry (ripetere un tentativo che ha già occupato 300s raddoppierebbe l'attesa in silenzio); la logica di retry esistente sul primo token resta intatta e il nuovo ramo è indipendente. `max_tokens: 8192` aggiunto come soffitto vero, non tarabile. Soglia iniettabile **solo nei test** via `__setMaxGenerationMsForTest`, per test deterministici da 100-300ms invece di 5 minuti. `tests/test_generation_timeout.ts` (13 check), inclusa la verifica che i timer siano sempre ripuliti via `process.getActiveResourcesInfo()`. Sabotaggio del `clearTimeout` nel `finally` → 2 FAIL. Commit `4cbf068`. |
| T8.12 | ✅ Fatto | `getModelTier(modelName, effort?)` propaga l'effort a `getModelProfile` invece di ricadere sempre su `@xhigh`; `listForLLM(modelName, allowedTools?, effort?)` lo inoltra; `Agent.run()` passa l'effort già risolto a ogni round del ciclo — è il punto che decide davvero quali tool sono eseguibili. **Effetto: un `/benchmark` ora serve**, un modello misurato a un livello e girato a quel livello riceve il tier misurato e non l'euristica del nome. `loadSystemPrompt`/`notifyIfUnprofiled` guadagnano `effort?` in coda, backward-compatible. `test_fingerprinting.ts` (+4) e `test_reasoning_effort.ts` (+3, catena end-to-end tier→tool) estesi, nuova `tests/test_effort_propagation.ts` (18 check). Sabotaggio → 8+2+2 FAIL mirati. **Coda aperta:** i chiamanti reali (`index.ts`, `call.ts`, `common.ts`, `hybrid.ts`, `spawnAgent.ts`) non passano ancora l'effort a `loadSystemPrompt`; il default prudente `'xhigh'` rende la cosa sicura — capacità non sfruttata, non rottura. Commit `b934151`. |
| T8.13 | ✅ Fatto | `reasoningEffort` opzionale negli argomenti di `spawn_agent` (enum `none\|low\|medium\|xhigh`), validato e normalizzato (trim + lowercase) prima di toccare provider e registry, con lo stesso stile del controllo di lunghezza del `task` già presente; passato come `reasoningEffortOverride` a `subAgent.run()`. È il livello "chiamante" della cascata, prima irraggiungibile. **Verifica invece di assunzione:** l'agente ha accertato leggendo `agent.ts` che `spawnAgent.ts` non passava — né passa ora — un effort di costruzione all'`Agent` del figlio, quindi omettendo l'override il comportamento resta identico a prima; nessuna cascata introdotta dove non esisteva. Schema con guida esplicita su quando abbassare (compiti meccanici). `tests/test_spawn_agent_reasoning_effort.ts` (21 check, incluso il payload reale dell'SDK). Sabotaggio → 6 FAIL. Commit `4cbf068`. |
| T8.14 | ✅ Fatto (con una coda, vedi sotto) | Pin globale in `src/core/effortControl.ts`, stato di processo mai scritto in `tsuka.config.json`: `withEffortPin(cascaded)` si applica **sopra** la cascata di T8.10 (mai riscritta) nei 3 punti che già la invocano — `cli/index.ts` (`recreateAgent`), `strategies/common.ts` (`runMemberTurn`, quindi tutte e 4 le modalità `/team` più `/goal`) e `tools/impl/spawnAgent.ts`, dove il pin vince anche sull'override esplicito del chiamante di T8.13. Comando `/effort`: senza argomenti mostra livello attivo, **provenienza** e tier di tool conseguente; `<livello>` fissa il pin; `auto` lo rimuove; `ask` alterna la modalità di conferma. Impostare o togliere il pin ricrea l'agente e **confronta il set di tool prima/dopo** (`describeToolDiff`), annunciando quanti e quali cambiano — è l'effetto collaterale di T8.12 che il task chiedeva di non nascondere. Modalità `ask`: **log-only** in `/team`, `/goal` e figli di `spawn_agent`, mai un prompt; il vincolo è verificato in modo attivo mockando `InteractiveMenu.select` perché lanci se venisse mai chiamata — sabotando il routing, il test muore all'istante invece di passare in silenzio. `tests/test_effort_command.ts` (59 check), inclusa la non persistenza provata sia sui byte di `tsuka.config.json` sia su un processo figlio fresco. Sabotaggio di `withEffortPin` → 7 FAIL mirati. `npm test` 38 suite OK, 0 fallite, verificato due volte. Commit `f2ba6b8`. **Coda aperta, causata da un difetto della specifica (non dell'esecuzione):** il task definiva la divergenza come «effort effettivo ≠ livello di riferimento (pin, o default di config)». Con un pin attivo l'effettivo **è** il pin per costruzione, quindi la segnalazione non compare mai proprio nel caso in cui servirebbe di più — quando il pin sta sovrascrivendo il livello che ruolo o personaggio avrebbero chiesto. Il confronto giusto è **pin contro ciò che la cascata avrebbe prodotto**. Vedi T8.15. |
| T8.15 | ✅ Fatto | Aggiornata `confirmEffortDivergence` in `src/core/effortControl.ts`: quando un pin manuale è attivo (`activePin !== null`), l'effort effettivo del turno viene confrontato rispetto al pin stesso (intento esplicito dell'utente). Se l'effort eseguito coincide col pin (es. `low`), ritorna `effective` senza chiedere alcuna conferma o emettere divergenza (`diverged: false`). Nuovo scenario di test in `tests/test_effort_propagation.ts` (20 check OK). 41 suite test verdi e TypeScript strict OK. |
| T8.16 | ✅ Fatto | Configurazione `llmTimeoutMs` in `src/core/config.ts` (`getLlmTimeoutMs`), funzione `setLlmTimeoutMs` in `src/core/provider.ts` invocata all'avvio in `src/cli/index.ts`. Timeout a orologio combinato per l'intera generazione LLM per prevenire stalli indefiniti. Test `GT.5a` e `GT.5b` in `tests/test_generation_timeout.ts` (15 check OK). 41 suite test verdi ed assenza di errori TS. |
| T8.17 | ✅ Fatto | Estensione `ChatOptions` ed inoltro parametri di campionamento numerici (`temperature`, `top_p`, `presence_penalty`, `frequency_penalty`) all'SDK OpenAI in `src/core/provider.ts`. Preset umani leggibili (`creativity`: `'precise'` | `'balanced'` | `'creative'`) con risoluzione in `resolveSamplingParams`. Attribuzione del campo `creativity` nei ruoli e personaggi (`roles/*.json`, `characters/*.json`, `resolveCreativity` in `src/cli/shared.ts`). Nuova suite `tests/test_sampling_params.ts` (15 check OK). 42 suite test verdi ed assenza di errori TS. |
| T8.10 | ✅ Fatto | `ChatOptions{reasoningEffort}` (`none\|low\|medium\|xhigh`) come 5° parametro opzionale di `ILLMProvider.chatWithTools`, inviato come `reasoning_effort` all'SDK OpenAI (cast `as any`: l'SDK tipizza solo low/medium/high). Cascata a 4 livelli in `resolveReasoningEffort` (`agent.ts`): override chiamante → personaggio → ruolo → `getDefaultReasoningEffort()`. `Agent` porta l'effort risolto in costruzione più un override per singola `run()`; cablato in `index.ts` e `strategies/common.ts`. Popolati `roles/*.json` (architect/supervisor=xhigh, developer/devops/sysadmin/data_analyst/researcher/osint_*=medium, copywriter/translator/seo/social/krea=low, entertainer=none) e 4 override in `characters/*.json` per differenziare personaggi che condividono un ruolo. `/benchmark` **spazza** i 4 livelli invece di misurarne uno: un profilo per livello con chiave `"modello@effort"`, nuovo `avgCompletionTokens` (rileva l'over-thinking dove `tokensPerSecond` non basta), e raccomandazione = livello più economico che raggiunge il tier massimo osservato. `BENCHMARK_VERSION`→4: i 6 profili preesistenti diventano stantii da soli, nessuna migrazione scritta. `test_fingerprinting.ts` esteso a 18 casi + nuova `test_reasoning_effort.ts` (32 casi, fino al payload reale dell'SDK). Sabotaggio dell'isolamento di `getModelProfile` → 31/32 e 15/18 FAIL, ripristinato. **Due code aperte dichiarate dall'agente:** (a) `spawnAgent.ts` non è cablato con l'override per singola run (era fuori proprietà file durante il parallelismo) — l'interfaccia è pronta, basta passare il parametro; (b) `getModelProfile(model, effort='xhigh')` ha un default prudente perché `registry.ts:38` e `shared.ts:193` non propagano ancora l'effort: finché non lo fanno, il tier dei tool ricade sull'euristica del nome anche dopo un benchmark. |

## Perché questa fase

Origine: revisione del percorso `spawn_agent` → `Agent` → `loadSystemPrompt` → `MemoryStore`,
fatta per rispondere a una domanda precisa — *quando lancio un agente gli passo tutto il
contesto o un contesto specifico?*

La risposta è: **un contesto specifico, ed è la cosa giusta.** `spawn_agent` costruisce un
`Agent` nuovo il cui costruttore chiama `clearHistory()` (`agent.ts:67`, `106-110`), quindi il
figlio parte con esattamente due messaggi — system prompt + task — e non eredita nulla della
history del padre. Su un modello locale da 27B questo è il comportamento desiderato e non va
cambiato. I cinque problemi qui sotto stanno tutti *intorno* a quella scelta, non dentro.

1. **Il sub-agente nasce cieco.** L'unico ponte verso il figlio è la stringa `task`, max 2000
   caratteri (`spawnAgent.ts:13`), scritta da un modello locale che tende a omettere il
   vincolo che conta. Intanto la lavagna di T6.2 sarebbe già raggiungibile — `Blackboard` è
   scoped via `AsyncLocalStorage` sul runId e il figlio gira dentro il contesto async del
   padre — ma **nessuno dei 15 file in `roles/` elenca `read_notes` o `post_note`** in
   `allowedTools`, e `spawnAgent.ts:36` passa esattamente `roleObj.allowedTools`.
2. **La memoria non ha namespace per agente.** `addFact` salva `source` (`memory.ts:269`) ma
   `visibleFacts()` filtra solo per `scope`/`'globale'` (`memory.ts:210`): `source` non entra
   mai in una lettura. Con più personaggi attivi, gli scarti di run di uno finiscono nel
   prompt dell'altro.
3. **Il retrieval perde le desinenze italiane.** `search()` fa `haystack.includes(k)`
   (`memory.ts:306`): match per sottostringa, quindi la query `"corsi"` **non** trova un fatto
   che dice `"corso"`, e `"badge"` non trova `"badges"`. In italiano la desinenza cambia quasi
   sempre; il budget di 600 caratteri (`memory.ts:360`, `391`) si riempie di fatti peggiori.
4. **Montare un system prompt scrive su disco.** `loadSystemPrompt` → `formatRelevant`
   (`shared.ts:158`) → `search()` → incrementa `hits`/`lastUsed` e chiama `save()`
   (`memory.ts:321-329`). Una scrittura di `memory.json` per ogni costruzione di prompt, e
   `hits` finisce per misurare le iniezioni automatiche invece degli usi utili — mentre pesa
   nell'eviction (`memory.ts:222`).
5. **Il lavoro del sub-agente è effimero.** Torna al padre solo come prosa troncata a 3000
   caratteri (`spawnAgent.ts:47`). Se poi `pruneHistory()` o `compressHistory()` tagliano quel
   messaggio (`agent.ts:123-159`, `184-263`), non ne resta niente da nessuna parte.

## T8.1 — Dare al sub-agente la lavagna del run

**Dipende da:** T6.2 (fatto) · **Sforzo:** basso · **Priorità:** alta

Il cold start del figlio resta. Quello che cambia è che il figlio possa *andarsi a prendere*
il contesto invece di riceverlo tutto masticato in 2000 caratteri dal padre.

- Quando esiste un run attivo, `spawn_agent` aggiunge `read_notes` (e `post_note`) ai tool del
  figlio, con lo stesso criterio già usato in `strategies/common.ts` per i tool di protocollo
  di T2.1 — **senza modificare i JSON in `roles/`**.
- Il system prompt del sub-agente, quando quei tool sono presenti, dice esplicitamente di
  leggere le note del run prima di iniziare.
- Fuori da un run attivo: comportamento identico a oggi, nessun tool aggiuntivo.

**Accettazione:** test che (a) il padre posta una nota, spawna un figlio, e il figlio la legge
attraverso lo stack reale `Agent`→`ToolRegistry`→tool (stessa forma del test end-to-end di
T6.2); (b) uno `spawn_agent` fuori da un run non espone `read_notes` e non fallisce; (c) i file
in `roles/` sono byte-identici a prima del task.

**Fuori scope:** non allargare il limite di 2000 caratteri del task; **non** passare al figlio
la history del padre — il cold start è deliberato ed è il motivo per cui questo harness gira
bene su un modello locale.

## T8.2 — Memoria: filtro per agente in lettura

**Dipende da:** T6.1 (fatto) · **Sforzo:** basso · **Priorità:** media

Rendere utile il campo `source`, oggi scritto e mai letto.

- Parametro opzionale `sources?: string[]` in lettura (`getRecent`, `search`, `formatRelevant`);
  assente = comportamento attuale, nessuna regressione per i chiamanti esistenti.
- Regola dichiarata quando il filtro è attivo (usato da `loadSystemPrompt` quando c'è un
  `character.aiName`): un agente vede **i propri fatti** più quelli di chiunque con
  `kind:'lezione'` o `kind:'decisione'` — che per costruzione sono condivisibili — ed è escluso
  dai `kind:'run'` altrui, che sono scarti di turno.

**Accettazione:** due agenti salvano un `kind:'run'` ciascuno e una `lezione` ciascuno; il
system prompt di A contiene la `lezione` di B e **non** lo scarto di run di B. `test_memory.ts`
e `test_memory_scope.ts` passano **senza modifiche**: se rompono è una regressione.

**Fuori scope:** nessun cambio alla firma dei tool `save_memory`/`recall_memory` oltre a
parametri opzionali additivi; non toccare lo scoping per workspace di T6.1, che è ortogonale.

## T8.3 — Retrieval: normalizzazione morfologica leggera

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** media

- Normalizzazione a costo zero e **senza nuove dipendenze**: lowercase, rimozione degli
  accenti e troncamento della desinenza finale, applicati **sia** alla keyword **sia**
  all'haystack prima del confronto in `search()`.
- `maxChars` dell'iniezione (oggi 600 fisso) diventa configurabile da `tsuka.config.json`,
  con 600 come default.

**Accettazione:** la query `"corsi"` trova un fatto che contiene `"corso"`; `"badge"` trova
`"badges"`; le 17 asserzioni di `test_memory_scope.ts` passano senza modifiche e senza nuovi
falsi positivi nei casi già coperti.

**Fuori scope:** niente embedding, niente database vettoriale, nessuna libreria di stemming —
resta scoring su keyword, come già dichiarato in T6.1.

## T8.4 — Costruire un prompt non deve scrivere sulla memoria

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** media-alta

- `search()` guadagna un'opzione `touch` (default `true`: `recall_memory` non cambia
  comportamento); `formatRelevant` e `formatForPrompt` la chiamano con `touch: false`.
- Così `hits` torna a misurare i recall *voluti* — cioè il segnale che l'eviction a punteggio
  di T6.1 si aspetta di ricevere — invece delle proprie iniezioni automatiche.

**Accettazione:** hash di `memory/memory.json` **identico** dopo N costruzioni di system prompt
senza chiamate esplicite a `save_memory`/`recall_memory` (stessa forma di prova diretta usata
in T6.5, dove oggi il file cambia). `recall_memory` continua a incrementare `hits`.

**Fuori scope:** non cambiare la formula di eviction (`memory.ts:219-224`) — qui si corregge
solo l'input che la alimenta.

## T8.5 — Il lavoro del sub-agente deve lasciare un artefatto

**Dipende da:** T8.1 · **Sforzo:** basso · **Priorità:** media

- Il sub-agente scrive il resoconto integrale in un file di run (es. `runs/<runId>/<label>.md`
  sotto la app home) e il valore restituito al padre diventa **sintesi breve + percorso**.
- Se c'è un run attivo, posta anche una nota sulla lavagna con quel percorso (chiude il cerchio
  con T8.1: il prossimo figlio lo trova da solo).

**Accettazione:** dopo uno spawn il file esiste e contiene il resoconto integrale; il valore di
ritorno resta sotto i 3000 caratteri e contiene il percorso; il padre riesce a rileggere il
contenuto con `read_file` **dopo** una potatura della history che ha rimosso il messaggio
originale.

**Fuori scope:** nessun cambio al formato del report JSON di `workflowLog.ts`.

## T8.6 — Disinnescare la configurazione legacy duplicata

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** bassa

In root convivono due configurazioni: `tsuka.config.json` (`CONFIG_PATH`, `config.ts:33` — è
quella letta) e `harness.config.json` (`LEGACY_CONFIG_PATH`, `config.ts:32`). La migrazione
rinomina il legacy **solo se il nuovo non esiste** (`config.ts:36`), quindi oggi il file resta
sul disco e non viene mai letto — pur contenendo `activeProvider: "ollama"` e un catalogo
provider senza Unsloth, cioè l'esatto contrario dello stato reale.

Il file **resta tracciato in git**: la migrazione serve a chi aggiorna da una versione
precedente al rename, e cancellarlo dal repo la renderebbe non verificabile. Va reso
inoffensivo, non rimosso.

- Aggiornare il **contenuto** di `harness.config.json` perché non contraddica più la
  configurazione viva: stesso catalogo provider di `tsuka.config.json` (Unsloth incluso), così
  che una migrazione oggi produca uno stato sensato invece di riportare l'utente a Ollama.
- Aggiungere in testa un campo esplicito (es. `"_legacy"`) che dica che il file non è letto
  quando `tsuka.config.json` esiste, e rimandare a `config.ts:32-40`.
- All'avvio, se **entrambi** i file esistono, un avviso una tantum sulla CLI: il legacy è
  ignorato, modificarlo non ha effetto.

**Accettazione:** con entrambi i file presenti l'avviso compare una volta e la configurazione
attiva resta quella di `tsuka.config.json`; rinominando via `tsuka.config.json` la migrazione
promuove il legacy e il provider risultante è coerente con quello che l'utente usa davvero;
`git ls-files` continua a elencare `harness.config.json`.

**Fuori scope:** non rimuovere il file né il ramo di migrazione; non cambiare `CONFIG_PATH`.

## T8.7 — Un briefing che sfora va spezzato, non accorciato

**Dipende da:** nessuno (si completa con T8.5) · **Sforzo:** basso · **Priorità:** alta

Osservato in uso. `spawnAgent.ts:13` lancia `'Compito troppo lungo (max 2000 caratteri).'`
L'errore torna al modello come risultato del tool, e la riparazione che il messaggio suggerisce
è **accorciare il briefing** — cioè buttare requisiti in silenzio, senza che nessuno se ne
accorga. È il comportamento peggiore possibile: il sub-agente parte comunque, ma sul compito
sbagliato.

La lunghezza è il sintomo, non il problema: **un briefing che non sta in 2000 caratteri non è
un compito, sono più compiti.** Il limite va tenuto; è il messaggio che deve prescrivere la
riparazione giusta.

- Riscrivere l'errore in forma prescrittiva: dichiarare la lunghezza effettiva, vietare
  esplicitamente l'accorciamento, e indicare le due uscite legittime — (a) suddividere in più
  chiamate a `spawn_agent`, una per compito, ciascuna autosufficiente; (b) se il compito è
  davvero unitario, scrivere il briefing con `write_file` e passare il **percorso** nel `task`.
- Allineare la descrizione del parametro `task` in `tools_schemas/spawn_agent.json`, che oggi
  dice solo «max 2000 caratteri» e prepara la stessa reazione sbagliata prima ancora
  dell'errore.
- Con T8.5 la seconda uscita diventa naturale: i sub-agenti già scrivono e leggono artefatti
  su file, quindi passare un percorso invece di prosa non è più un caso speciale.

**Accettazione:** un `task` di oltre 2000 caratteri produce un errore che contiene la lunghezza
effettiva e le due alternative, e **non** contiene alcun invito ad accorciare; il limite resta
2000; i test esistenti su `spawn_agent` passano senza modifiche.

**Fuori scope:** non alzare il limite dei 2000 caratteri — alzarlo sposterebbe il problema
senza risolverlo, ed è la finestra di contesto del modello locale a non reggere briefing più
lunghi.

## T8.8 — Tetto di contesto per singolo risultato di tool

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** ALTA (la più alta della fase)

La finestra reale del modello locale in uso è **46k token**. Un solo risultato di tool può
saturarla prima che qualunque rete di sicurezza entri in funzione, perché i tetti attuali sono
in **byte** e furono scelti per una finestra molto più grande:

- `readFile.ts:19` rifiuta i file oltre **5 MB** ma **non tronca nulla** sotto quella soglia:
  un file da 200 KB entra intero in cronologia, cioè ~57k token stimati — finestra saltata con
  una chiamata sola, e la potatura non fa in tempo perché il messaggio è già stato costruito.
- `executeCommand.ts:9` tronca a **50 KB** ≈ 14k token: un terzo della finestra da un comando.
- `grepSearch.ts:7` salta i file oltre 5 MB ma non limita il numero complessivo di righe rese.

La potatura della cronologia è l'**ultima** difesa, non la prima: quando interviene il danno è
già in contesto. Il tetto va messo all'ingresso.

- Un solo helper condiviso, es. `src/core/contextBudget.ts`: `capForContext(text, maxTokens)` —
  ritorna testa + coda con al centro una nota esplicita che dichiara quanto è stato tagliato e
  **come recuperare il resto** (`grep_search`, oppure `read_file` con offset).
- Applicarlo in `readFile`, `executeCommand`, `grepSearch`, `browseUrl`, `webSearch`. Tetto di
  default ~4k token per risultato, configurabile con `maxToolResultTokens` in
  `tsuka.config.json`.
- `read_file` guadagna i parametri opzionali `offset`/`limit` (righe), così il troncamento non
  è un vicolo cieco ma una paginazione: è la ragione per cui il modello non deve accorciare
  nulla, gli basta chiedere la porzione successiva.

**Accettazione:** un `read_file` su un file da 200 KB produce un risultato sotto il tetto
configurato e una nota che spiega come ottenere il resto; `read_file` con `offset`/`limit`
ritorna esattamente la finestra di righe richiesta; un `execute_command` con output enorme
resta sotto il tetto; nessuna suite esistente cambia comportamento sui file piccoli.

**Fuori scope:** non toccare i limiti di sicurezza in byte già esistenti (5 MB / 50 KB), che
restano come guardia superiore — qui si aggiunge un tetto *in token*, più stretto, sopra di
essi.

## T8.9 — Ridurre il costo fisso del prompt

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** media

Due sprechi strutturali, pagati a ogni singola chiamata API:

1. **I tool viaggiano due volte.** `registry.listForLLM()` li manda come array `tools` nella
   richiesta (`provider.ts:153`), e `loadSystemPrompt` li riscrive come elenco testuale nel
   system prompt (`shared.ts:164-175`). Il secondo elenco è ridondante rispetto al primo per
   qualunque modello con function calling nativo — e Unsloth ce l'ha.
2. **Gli schemi dei tool non entrano nella stima.** `pruneHistory`/`estimateMessagesTokens`
   contano solo `this.messages` (`agent.ts:123-169`): l'array `tools`, che è comunque contesto
   inviato, è un punto cieco di ~2-3k token. Il budget crede di avere più spazio di quanto ne
   abbia davvero.

- Rendere l'elenco testuale condizionale: incluso solo per i modelli senza function calling
  misurato (il profilo di X2 in `models_profile.json` lo sa già), altrimenti omesso.
- Sommare la dimensione stimata degli schemi al totale usato da `pruneHistory` e da
  `compressHistory`, così le soglie ragionano sul contesto reale.

**Accettazione:** su un modello profilato con function calling, il system prompt non contiene
più la sezione "Available tools" e il comportamento dei tool è invariato; la stima di contesto
mostrata all'utente include gli schemi e si avvicina al `promptTokens` reale restituito
dall'API (che `calibrateCharsPerToken` già osserva, `agent.ts:94-100`).

**Fuori scope:** non rimuovere la nota su `save_memory`/`recall_memory` (`shared.ts:171-173`),
che non è un elenco di tool ma un'istruzione d'uso.

## T8.10 — `reasoning_effort`: passarlo, e misurare il profilo per livello

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** alta

**Misura sul campo (monitor API, 2026-08-15).** Una chiamata reale con questo modello: durata
174s, primo token a 6s, prompt a 1200 tok/s, generazione a 20 tok/s, ~10k token totali,
`stop_reason: tool_calls`. Ricostruzione: prompt ≈ 7.200 token (6s × 1200), generati ≈ 3.300
token (168s × 20). Una tool call in JSON pesa 50-150 token: **circa 3.200 token erano puro
ragionamento, per decidere di chiamare un tool.** Il prompt processing è il 3,5% del tempo.
Confronto delle leve su quei 174s: dimezzare il prompt vale −3s (1,7%), portare il ragionamento
da 3.300 a 300 token vale −150s (86%). Ne segue una gerarchia da tenere presente: T8.8 e T8.9
proteggono dal **fallimento duro** (finestra saturata), non dalla lentezza; la lentezza è
**tutta** qui. E quei 174s erano **un solo round**: con `MAX_TOOL_ROUNDS = 15` il tetto teorico
per un singolo messaggio utente supera i 40 minuti.

**Il fatto:** `chat.completions.create` (`provider.ts:150-157`) manda solo `model`, `messages`,
`tools`, `tool_choice`, `stream`, `stream_options`. Nessun parametro di campionamento e nessun
controllo del ragionamento. Il modello gira quindi sui propri default — e per Qwen3.8-27B il
default documentato di `reasoning_effort` è **`xhigh`** («complex tasks demanding thorough
analysis»). Ogni chiamata, compreso un banale `read_file`, viene eseguita al massimo sforzo di
ragionamento; con `MAX_TOOL_ROUNDS = 15` un solo turno utente può significare quindici
ragionamenti `xhigh` in fila. Livelli disponibili: `none`, `low`, `medium`, `xhigh`.

**Il difetto che ne consegue nel profilo:** `saveProfile` indicizza per solo nome del modello
(`modelProfile.ts:101`) e `getModelProfile` lo rilegge allo stesso modo. Un profilo misurato a
`xhigh` viene quindi applicato anche quando si gira a `low`: `computeTier`
(`modelProfile.ts:115-123`) concede i tool di tier `large` a una configurazione che quei test
non li ha mai superati. Misurare in una condizione e girare in un'altra rende il fingerprinting
di X2 una dichiarazione, non una misura.

- **Passare il parametro, con una cascata a quattro livelli.** Un `ChatOptions` opzionale in
  `ILLMProvider.chatWithTools`, risolto in ordine: **override del chiamante** (es. `spawn_agent`
  che sa che il sottocompito è meccanico) → **personaggio** (`characters/*.json`) → **ruolo**
  (`roles/*.json`) → **default** in `tsuka.config.json`.
  - Il **ruolo** porta il valore di base, perché è il tipo di lavoro a determinare quanto vale
    la pena ragionare: `architect` alto, `translator` basso.
  - Il **personaggio** serve a differenziare due agenti che condividono lo stesso ruolo, ed è
    l'unico livello raggiungibile da `/goal`: il DSL dell'orchestrator seleziona personaggi
    (`goal.ts:42`), non ruoli né tratti. Senza questo livello, un piano generato da `/goal` non
    potrebbe mai modulare lo sforzo fra i suoi step — per esempio far progettare il piano a
    sforzo alto e derivarne i task a sforzo basso.
  - Il **tratto** resta fuori dalla cascata di proposito: descrive il tono, non la profondità
    del ragionamento. Metterlo lì confonderebbe due assi indipendenti.
- **Il benchmark spazza i livelli** invece di misurarne uno solo: esegue il set per ciascun
  effort e salva un profilo per livello, con chiave `modello@effort`.
- **Nuovo campo `avgCompletionTokens`** nel profilo. `tokensPerSecond` da solo **non rileva
  l'over-thinking**: a `xhigh` la velocità di generazione può essere identica, ma i token
  emessi per arrivare alla stessa risposta sono molti di più. Senza questa metrica il costo del
  ragionamento è invisibile al profilo.
- **`/benchmark` chiude con una raccomandazione**: il livello *più basso* che raggiunge il tier
  più alto. È la risposta misurata a «quanto deve pensare», nello spirito di X2 (misurare
  invece di indovinare dal nome).
- **`BENCHMARK_VERSION` → 4**: i profili misurati senza effort diventano automaticamente
  stantii (`modelProfile.ts:87-89`) e vengono riproposti per la misura, senza scrivere codice
  di migrazione.

**Accettazione:** un `/benchmark` su un modello produce un profilo per livello di effort;
`getModelProfile` per un modello girato a effort X non restituisce il profilo misurato a
effort Y; i 5 profili già presenti in `models_profile.json` risultano stantii e vengono
riproposti; `tests/test_fingerprinting.ts` passa, esteso con un caso che prova l'isolamento fra
livelli.

**Fuori scope:** i parametri di campionamento (`temperature`, `top_p`, `top_k`,
`presence_penalty`) sono un problema ortogonale e **non si misurano**: vanno impostati ai valori
raccomandati per la modalità in uso (Qwen3.8 thinking: 1.0 / 0.95 / 20 / 0.0; instruct: 0.7 /
0.80 / 20 / 1.5). Task separato.

## T8.11 — Timeout a orologio sull'intera generazione

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** alta

`provider.ts:144-147` arma `FIRST_TOKEN_TIMEOUT_MS` (120s) e lo **azzera** all'arrivo del primo
token (riga 177-180). Da lì in poi la generazione non ha alcun limite di tempo: l'unica uscita
è l'Esc dell'utente. La misura riportata in T8.10 mostra 174s trascorsi senza alcuna
possibilità di intervento, e quello era un solo round su quindici possibili.

- Secondo timer, **non azzerato** al primo token, che aborta l'intera generazione oltre
  `MAX_GENERATION_MS` (default ~300s, costante accanto a `FIRST_TOKEN_TIMEOUT_MS`).
  L'`AbortController` per tentativo esiste già (`attemptAbort`, riga 135): riusarlo.
- Distinguere il messaggio d'errore da quello di mancata risposta: qui il modello *stava*
  generando, e va detto — altrimenti si diagnostica il problema sbagliato.
- Aggiungere `max_tokens` alla richiesta come **soffitto vero**, generoso (~8k), non un valore
  da tarare. Motivazione da rispettare: se stretto tronca una tool call a metà JSON, che è
  peggio che lento; e con un modello che ragiona deve coprire pensiero **più** risposta.

**Accettazione:** una generazione che supera `MAX_GENERATION_MS` viene interrotta con un errore
che la distingue dal timeout sul primo token; un modello che risponde normalmente non è mai
toccato; il timer viene sempre ripulito, anche in caso di errore o di abort dell'utente.

**Fuori scope:** non toccare `MAX_TOOL_ROUNDS` né la logica di retry.

## T8.12 — Propagare l'effort a `getModelProfile`

**Dipende da:** T8.10 (fatto) · **Sforzo:** basso · **Priorità:** ALTA (sblocca i benchmark)

Coda aperta di T8.10. `getModelProfile(model, effort = 'xhigh')` ha un default prudente perché
i due chiamanti non propagano l'effort: `registry.ts:38` (`getModelTier`, che decide quali tool
vede il modello) e `shared.ts:193`. Conseguenza concreta: **si può benchmarkare i quattro
livelli e il tier dei tool non cambia comunque**, perché il lookup cerca sempre la chiave
`@xhigh` e ricade sull'euristica del nome.

- `getModelTier(modelName, effort?)` e i suoi chiamanti propagano l'effort risolto — lo stesso
  che `resolveReasoningEffort` già calcola in `agent.ts`.
- Dove l'effort non è noto, il default resta `'xhigh'`: assumere lo scenario più costoso è
  l'errore giusto da fare.

**Accettazione:** un modello profilato a `medium` e girato a `medium` riceve il tier misurato,
non quello euristico; girato a un livello non profilato ricade sull'euristica; i test di
`test_reasoning_effort.ts` e `test_fingerprinting.ts` passano, estesi con il caso end-to-end
tier→tool.

**Fuori scope:** non cambiare `computeTier` né le soglie.

## T8.13 — Override di effort in `spawn_agent`

**Dipende da:** T8.10 (fatto) · **Sforzo:** basso · **Priorità:** media

Coda aperta di T8.10: l'interfaccia è pronta (`Agent.run(..., reasoningEffortOverride?)`), manca
il parametro nel tool. È il livello "chiamante" della cascata a quattro livelli, oggi
irraggiungibile: un padre che sa che il sottocompito è meccanico non può dirlo al figlio.

- `reasoningEffort` opzionale negli argomenti di `spawn_agent`, con schema in
  `tools_schemas/spawn_agent.json` (enum `none|low|medium|xhigh`), passato a `subAgent.run(...)`.
- La descrizione dello schema deve dire **quando** abbassarlo: compiti meccanici (applicare una
  modifica nota, riformattare, estrarre campi) vanno a `none`/`low`.

**Accettazione:** uno `spawn_agent` con `reasoningEffort: 'none'` fa arrivare `none` al provider,
verificato sul payload; omesso, la cascata ricade su personaggio/ruolo come prima.

**Fuori scope:** non toccare la cascata in `resolveReasoningEffort`, già fatta e testata.

## T8.14 — Controllo globale dell'effort: comando `/effort`

**Dipende da:** T8.10, T8.12, T8.13 (fatti) · **Sforzo:** medio · **Priorità:** alta

Oggi l'effort è deciso dalla cascata a quattro livelli, tutta dichiarativa: sta nei JSON di
ruoli e personaggi, e l'utente non ha alcuna leva a runtime. Manca un livello **globale**, sopra
la cascata, azionabile da comando.

**Conseguenza da non sottovalutare, introdotta da T8.12:** l'effort non regola più solo la
profondità del ragionamento, **decide anche quali tool il modello vede** — `getModelTier` lo
propaga a `getModelProfile`, e un livello non profilato ricade sull'euristica del nome.
Cambiare effort a runtime può quindi cambiare il set di tool disponibili nel mezzo di una
sessione. Il comando deve renderlo visibile, non farlo di nascosto.

- **Nuovo livello in cima alla cascata: il pin globale.** Ordine finale: **pin globale →
  override del chiamante → personaggio → ruolo → default di config**. Vive **in memoria di
  processo**, non in `tsuka.config.json`: è una scelta "per adesso", e deve sparire al riavvio.
  Il default persistente resta il campo `reasoningEffort` in configurazione, già esistente
  (`getDefaultReasoningEffort`) — sono due cose distinte e non vanno confuse.
- **Comando `/effort`** in `src/cli/commands/`, con dispatch come gli altri:
  - `/effort` — mostra il livello attivo, da dove viene (pin, personaggio, ruolo o default) e
    il tier di tool che ne consegue;
  - `/effort <none|low|medium|xhigh>` — fissa il pin;
  - `/effort auto` — rimuove il pin e torna alla cascata.
- **Quando il pin cambia il tier dei tool, dirlo subito**: messaggio esplicito con quanti tool
  diventano visibili o spariscono. È l'effetto collaterale meno intuibile del comando.
- **Rendere visibile la divergenza invece di chiederla.** Quando l'effort effettivo di un turno
  differisce dal livello di riferimento (pin, o default di config se non c'è pin), va
  segnalato: nella `statusline` in chat, e come riga di log nei turni di `/team` e `/goal`.
- **Modalità `ask` opzionale** (`/effort ask`), per chi vuole il controllo puntuale: chiede
  conferma quando l'agente sta per girare a un livello diverso da quello di riferimento.
  **Vincolo obbligatorio:** attiva **solo nella chat interattiva**. In `/team`, `/goal` e nei
  figli di `spawn_agent` degrada automaticamente a riga di log, senza mai bloccare. Un flusso
  autonomo con molti turni produrrebbe altrimenti la stessa approval fatigue che il
  `PermissionManager` è progettato per evitare.

**Accettazione:** con un pin attivo, un personaggio con `reasoningEffort` diverso gira al
livello del pin, e `/effort` lo dichiara con la provenienza corretta; `/effort auto` ripristina
esattamente il comportamento precedente al pin; un pin che cambia il tier dei tool produce un
messaggio che nomina la differenza; in modalità `ask`, un turno di `/team` **non** apre alcun
prompt e scrive invece una riga di log; il pin non compare in `tsuka.config.json` e non
sopravvive al riavvio.

**Fuori scope:** non modificare la cascata esistente in `resolveReasoningEffort` (il pin si
aggiunge sopra, non la riscrive); non rendere il pin persistente; non toccare i valori di
`reasoningEffort` già presenti nei JSON di ruoli e personaggi.

## T8.15 — La divergenza va misurata contro la cascata, non contro il pin

**Dipende da:** T8.14 (fatto) · **Sforzo:** basso · **Priorità:** media

Correzione di un difetto della specifica di T8.14, non della sua esecuzione. Là la divergenza
era definita come «effort effettivo ≠ livello di riferimento», con il livello di riferimento
uguale al pin quando presente. Ma con un pin attivo l'effort effettivo **è** il pin per
costruzione: il confronto è sempre vero e la segnalazione non compare mai — proprio nel caso in
cui serve di più, cioè quando il pin sta zittendo il livello che ruolo o personaggio avrebbero
chiesto.

- Il confronto corretto è fra il **pin** e **ciò che la cascata avrebbe prodotto senza pin**
  (`resolveReasoningEffort` sa già calcolarlo: va invocata comunque, e il risultato confrontato
  invece che scartato).
- Il messaggio deve nominare entrambi i termini e la provenienza di quello scartato: *«Castoro
  chiederebbe `xhigh` (personaggio), pin attivo a `low`»*.
- Restano validi i vincoli di T8.14: log-only in `/team`, `/goal` e figli di `spawn_agent`;
  prompt solo in chat interattiva e solo con `ask` attiva.

**Accettazione:** con pin `low` e un personaggio a `xhigh`, ogni turno produce la segnalazione
con entrambi i livelli e la provenienza; con pin `low` e una cascata che avrebbe comunque dato
`low`, **nessuna** segnalazione (non deve diventare rumore a ogni turno); in `/team` resta una
riga di log e nessun prompt; i 59 check di `tests/test_effort_command.ts` restano verdi, estesi
con i due casi nuovi.

**Fuori scope:** non cambiare la precedenza del pin — resta il livello più alto della cascata,
qui si corregge solo ciò che viene *segnalato*.

## T8.16 — Rendere il catalogo dei personaggi effettivamente selezionabile

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** alta

Misura sul catalogo attuale: 24 personaggi, 16 ruoli, 9 tratti. **Nessun buco** — ogni ruolo ha
almeno un personaggio e ogni tratto è usato, quindi T7.1 e T7.3 hanno fatto il loro lavoro. Il
problema è la **selezionabilità**.

1. **Le descrizioni sono troppo corte per discriminare.** Media ~85 caratteri, minimo 54
   (`falco`) e 57 (`data_sage`). L'orchestrator di `/goal` costruisce l'elenco dei candidati
   **solo** da `description` (`goal.ts:22-28`): non vede il `systemPrompt` del ruolo, non vede
   gli `allowedTools`. Un modello locale deve scegliere fra 24 candidati presentati in mezza
   riga ciascuno.
2. **Otto ruoli su sedici hanno due personaggi** (`krea_prompt_engineer`, `data_analyst`,
   `sysadmin`, `social_media_manager`, `seo_specialist`, `translator`, `researcher`,
   `copywriter`). Alcune coppie sono differenze vere (`seo_wizard` professional vs `hard_edge`
   blunt), altre no (`data_sage` professional vs `iron_claw` reliable: due tratti quasi
   sovrapponibili). In nessun caso la descrizione dice **in cosa** i due differiscono, quindi la
   scelta fra loro è arbitraria.
3. **Tre convenzioni di nomi convivono**: animali italiani (`argo`, `falco`, `gufo`, `piccione`,
   `volpe`, `segugio`, `castoro`), epiteti inglesi (`cold_steel`, `hard_edge`, `iron_claw`,
   `no_bull`, `straight_shooter`, `ground_control`), mestieri (`dev`, `wordsmith`, `polyglot`,
   `pipeline_pro`, `overseer`, `data_sage`, `seo_wizard`, `social_guru`, `krea_master`).

- **Riscrivere ogni `description`** perché risponda a una domanda sola: *quando scegliere questo
  personaggio e quando no*. Non com'è fatto — a cosa serve. Lunghezza indicativa 150-300
  caratteri, in italiano come le attuali.
- **Per ogni ruolo con due personaggi**, le due descrizioni devono nominare esplicitamente il
  criterio che li separa, in modo che siano leggibili come un'alternativa e non come un
  doppione.
- **Documentare la convenzione dei nomi** in `AGENTS.md` (quale si adotta per i nuovi, e che le
  esistenti restano). **Non rinominare né cancellare nulla**: i nomi sono referenziati da
  `teams/*.json`, dai preset e dalla memoria dell'utente.
- **Test di selezionabilità** in `tests/`: ogni `description` supera una soglia minima di
  lunghezza; due personaggi con lo stesso ruolo non hanno descrizioni sovrapponibili (per
  esempio: differiscono per un insieme di parole significative, non solo per il nome proprio);
  ogni personaggio citato in `teams/*.json` e nei preset esiste ancora.

**Accettazione:** il test sopra passa; `tests/test_presets.ts` e `tests/test_characters.ts`
restano verdi **senza modifiche**; nessun file in `characters/` rinominato o rimosso;
`git status` non mostra cancellazioni.

**Fuori scope:** non aggiungere né togliere personaggi, ruoli o tratti — il catalogo è completo,
qui si lavora solo sul testo che l'orchestrator legge. Non toccare `systemPrompt` dei ruoli.

## T8.17 — Suggerire la modalità di esecuzione in base alla richiesta

**Dipende da:** T8.10, T8.14 (fatti) · **Sforzo:** medio · **Priorità:** alta

Oggi la scelta fra chat singola, `/team` e `/goal` è tutta a carico dell'utente, che deve
conoscere il catalogo e ricordarsi i comandi. Una richiesta complessa scritta in chat viene
eseguita da un agente solo, anche quando un team la farebbe meglio.

Serve un **suggeritore**: a ogni messaggio in chat normale, il sistema valuta la richiesta e —
**indipendentemente dal fatto che l'utente abbia usato `/goal` o no** — propone la modalità più
adatta, con il comando già pronto.

- **Classificatore economico.** Una sola chiamata con `reasoning_effort: 'none'` (T8.10) e
  `max_tokens` molto stretto: è una classificazione, non un ragionamento, e deve costare
  centinaia di millisecondi, non minuti. Su un modello locale a ~20 tok/s questo è il punto che
  decide se la funzione è usabile o insopportabile.
- **Esito a tre valori**: `chat` (esegui direttamente, nessun suggerimento), `team:<nome>` (con
  il team esistente più adatto fra quelli in `teams/`), `goal` (obiettivo multi-passo, il piano
  lo costruisce l'orchestrator). Più una riga di motivazione.
- **Suggerisce, non impone.** Stampa la proposta con il comando pronto da eseguire e prosegue
  comunque con la chat. Mai un prompt bloccante: stessa ragione già stabilita in T8.14.
- **Non deve diventare rumore**: silenzio quando l'esito è `chat`, quando il messaggio è un
  comando slash, quando è molto breve, e quando si è già dentro un run di `/team` o `/goal`.
- **Disattivabile** con un comando (`/suggest off|on`), stato di processo come il pin di T8.14,
  non persistente.

**Accettazione:** una richiesta multi-passo in chat produce un suggerimento con il comando
pronto; una domanda breve non produce nulla; un messaggio che inizia con `/` non produce nulla;
dentro un turno di `/team` o `/goal` il suggeritore non viene mai invocato; con `/suggest off`
non parte alcuna chiamata al modello (verificabile contando le chiamate al provider finto); la
chiamata di classificazione viene emessa con `reasoning_effort: 'none'`.

**Fuori scope:** non eseguire automaticamente la modalità suggerita — la decisione resta
dell'utente; non toccare il DSL dell'orchestrator di `/goal` né il formato dei `teams/*.json`.

---

## Grafo delle dipendenze (fase 3)

```
T8.1 ─→ T8.5 ←┄┄ T8.7   (T8.7 non dipende da T8.5, ma la seconda uscita
                         del suo messaggio d'errore diventa praticabile
T8.2 ┐                   solo quando T8.5 è fatto)
T8.3 ├─ indipendenti fra loro e da T8.1
T8.4 ┤
T8.6 ┘
```

Parallelizzabili subito: T8.1, T8.2, T8.3, T8.4, T8.6, T8.7, T8.8, T8.9, T8.10.
Percorso critico: T8.1 → T8.5.

**Da fare per primo: T8.8.** È l'unico che oggi provoca un fallimento duro (finestra saturata
da un singolo risultato di tool) invece di un degrado graduale.

---

## Stato della lavorazione — aggiornato al 2026-08-15

Punto di ripresa, se il lavoro viene interrotto.

**Fatto e verificato in modo indipendente:**
- **T8.8** ✅ — `tsc` pulito, `npm test` 29 suite OK (nuova `tests/test_context_budget.ts`, 39
  casi, già registrata in `run_tests.ts`). Neo noto e non risolto, latente: `capForContext`
  invocata con un `maxTokens` esplicito sotto ~80 token restituirebbe la sola nota di taglio,
  superando il tetto che dovrebbe imporre. Irraggiungibile da configurazione (pavimento a 256).

**T8.1, T8.2, T8.3, T8.4, T8.5, T8.7, T8.10** ✅ — svolti da tre agenti in parallelo, separati
per file posseduti (non per logica) e con divieto di scrivere su `run_tests.ts` e su questo
file; suite registrate e tabella Stato aggiornata a mano dopo il rientro. **Verifica unica
finale, a lavorazioni concluse: `npx tsc --noEmit` pulito, `npm test` → 32 suite OK, 0 fallite,
`memory/memory.json` reale invariato.** Nota di metodo: durante il parallelismo il repo
attraversa stati transitori incoerenti (la proprietà dei file evita le sovrascritture, ma la
compilazione è globale) — le corse di test intermedie di un agente non sono attendibili, conta
solo la verifica finale.

### FASE 3 completa — verifica finale: 37 suite OK, 0 fallite

Tutti i task da T8.1 a T8.13 sono chiusi e committati. `npx tsc --noEmit` pulito, `npm test`
**37 suite OK, 0 fallite** su due corse consecutive, `memory/memory.json` reale invariato.
Resta aperto **T8.14** (comando `/effort`), scritto ma non ancora affidato.

**Due difetti emersi solo nella verifica finale, e la lezione che ne segue.** Ogni agente aveva
eseguito la propria suite in isolamento vedendo verde, e il baseline `npm test` non conteneva
ancora le suite nuove (non registrate, per evitare che si sovrascrivessero a vicenda). Di
conseguenza:

1. **T8.9 ha rotto un'asserzione di T8.12** senza che nessuno se ne accorgesse: `T812.5c` dava
   per scontato che il prompt elencasse i tool, comportamento che T8.9 ha deliberatamente
   cambiato per i modelli con function calling misurato affidabile. Asserzione riscritta
   mantenendo l'intento — ora è l'**assenza** dell'elenco a provare che il fallback risolve a
   `xhigh`, il che è anche un controllo più stretto.
2. **`test_reasoning_effort.ts` passava da sola e falliva in batch.** Causa reale, accertata:
   `loadProfiles()` in `modelProfile.ts` invalidava la cache confrontando solo `mtimeMs`, e su
   Windows la risoluzione dell'orologio del filesystem (~15 ms) permette a due scritture
   consecutive con contenuto diverso di condividere lo stesso mtime — la seconda veniva letta
   dalla cache stantia, il profilo appena scritto risultava assente, `getModelTier` ricadeva
   sull'euristica e nascondeva tutti i tool. Non era specifico di una suite: durante la prova
   di regressione la stessa corsa è comparsa anche in `test_prompt_overhead.ts`. Corretto
   confrontando il **contenuto letto** invece del timestamp (commit `bf1bbad`), stesso principio
   già applicato in `memory.ts` con `useOrder` per non fidarsi di timestamp grezzi. Verde su 10
   ripetizioni consecutive; sabotando, la corsa riappariva 2 volte su 5.

**Conclusione di metodo, da riusare:** con più agenti in parallelo la verifica che conta è
**una sola, finale, a lavorazioni concluse e con tutte le suite registrate**. Le corse
intermedie non sono attendibili — la proprietà dei file evita le sovrascritture, ma la
compilazione e il filesystem sono globali. Il resto del coordinamento ha funzionato e vale la
pena riusarlo: vietare a ogni agente di scrivere su `tests/run_tests.ts` e su questo file,
farsi consegnare nome della suite e testo per la colonna Note, su `config.ts` condiviso solo
Edit chirurgici e mai Write, e dichiarare il baseline numerico nel briefing così un calo si
vede.

**Dopo FASE 3, direzione in valutazione (non decisa):** una UI nuova — TUI o webui, con TS
come candidato naturale per la seconda. Prerequisito comune a entrambe, e utile anche alla CLI
attuale: **chiudere i 23 `console.log`/`error`/`warn` presenti in `src/core/` e `src/tools/`**,
instradandoli su `AgentEvent` (basta un tipo `notice`) o su un sink iniettato. Il principio è
già dichiarato in `src/core/agentEvents.ts` ma non rispettato; una UI a frame non tollera una
stampa diretta dal core. Da fare comunque, qualunque sia la scelta sulla UI.
- **Nuovo task da scrivere: timeout a orologio sull'intera generazione.** `provider.ts:144-147`
  arma `FIRST_TOKEN_TIMEOUT_MS` (120s) e lo azzera all'arrivo del primo token (riga 177-180):
  da lì in poi la generazione è **illimitata nel tempo**, l'unica uscita è l'Esc dell'utente.
  La misura in T8.10 mostra 174s trascorsi senza alcuna possibilità di intervento. Forma
  corretta: `max_tokens` generoso come vero soffitto (~8k, mai raggiunto in condizioni normali —
  se stretto tronca una tool call a metà JSON, che è peggio che lento; e con un modello che
  ragiona deve coprire pensiero + risposta) **più** un secondo timer sull'intera generazione,
  che non venga azzerato al primo token. L'`AbortController` per tentativo esiste già
  (`attemptAbort`, `provider.ts:135`).
- **Parametri di campionamento**, oggi non impostati affatto. Non si misurano: valori
  raccomandati per Qwen3.8 — thinking `temperature 1.0 / top_p 0.95 / top_k 20 /
  presence_penalty 0.0`; instruct `0.7 / 0.80 / 20 / 1.5`.

**Configurazione già cambiata a mano** (fuori dai task, motivata in `## Note operative`):
`tsuka.config.json` ha ora `"maxHistoryTokens": 30000`, tarato sulla finestra reale di 46k —
il default era 65536, sopra la finestra, e rendeva inefficaci sia `pruneHistory` sia
`compressHistory` (che partiva a 49152, già oltre il muro).

## Note operative

- **Il riallineamento del loop non è in questa fase**: è già pianificato come T6.3
  (`RunController`, esegui → verifica → correggi) e T6.4. Questa fase gli prepara il terreno —
  T8.1 e T8.5 fanno sì che ci sia qualcosa di solido da rileggere a ogni riallineamento — ma
  non lo anticipa e non lo duplica.
- **`unsloth/Qwen3.8-27B-GGUF` non è profilato.** Verificato: `models_profile.json` contiene
  5 modelli, nessuno dei quali è quello Unsloth attivo in `tsuka.config.json`. Quindi
  `getModelTier` ricade sull'euristica del nome (`registry.ts:56-63`), che su `…-27b-…`
  restituisce `medium` e **nasconde al modello tutti i tool di tier `large`**. Un `/benchmark`
  una tantum risolve: sul 9B `satgeze/qwenpaw-9b-heretic-1m` la misura ha dato `large` dove
  l'euristica diceva `small` (vedi X2 in `OPTIMIZATION_PLAN.md`), quindi lo scarto fra stima e
  realtà è già stato osservato su questa codebase e non è teorico.
- **L'integrazione Unsloth è a posto, non toccarla.** Catena verificata: `tsuka.config.json`
  (`activeProvider: "unsloth"`, `baseUrl: http://127.0.0.1:8888/v1`) → `provider.ts:59`
  (`new OpenAI({ baseURL, apiKey })`, SDK ufficiale) → `provider.ts:150`
  (`chat.completions.create`) → `config.ts:139` (`UNSLOTH_API_KEY`, header `Bearer` messo
  dall'SDK). Unsloth Studio parla il dialetto OpenAI e la prova è che `stream_options:
  { include_usage: true }` (`provider.ts:156`, estensione specifica OpenAI) viene accettato e
  restituisce `usage` reale.
- **Unica ruvidezza rimasta, cosmetica:** il fallback di `listModels()` (`provider.ts:102-112`)
  sostituisce `/v1` con `/api/tags`, che è un endpoint **Ollama**. Su Unsloth non può mai
  riuscire; è dentro un `try/catch` che rilancia comunque l'errore originale, quindi non rompe
  niente — ma è codice morto per questo provider. Da tenere presente solo se un giorno
  `/v1/models` desse problemi e il messaggio d'errore sembrasse fuorviante.
- **Configurazione legacy duplicata:** `harness.config.json` esiste ancora accanto a
  `tsuka.config.json` e non viene mai letto. È diventato il task **T8.6** — il file resta
  tracciato in git, va corretto e segnalato, non cancellato.

---

# FASE 4 — Architettura Multi-Skill (Ruoli Modulari & Hot-Swappable)

## Stato

| Task | Stato | Note |
|------|-------|------|
| T9.1 | ✅ Fatto | Estensione tipi e motorizzazione agentica (`types.ts`, `shared.ts`, `agent.ts`): supporto per `roles?: string[]`, `activeRole?: string` su `CharacterConfig` con retro-compatibilità per `role?: string` e hot-swapping via `Agent.setActiveSkill()`. |
| T9.2 | ✅ Fatto | Implementazione tool di protocollo SAFE `switch_skill` (`tools_schemas/switch_skill.json`, `src/tools/impl/switchSkill.ts`) per la commutazione di skill in-session. |
| T9.3 | ✅ Fatto | Comando slash `/skill [nome]` in `src/cli/commands/persona.ts`, registrato in `commandMap` di `src/cli/index.ts`. |
| T9.4 | ✅ Fatto | Suite di test `tests/test_multi_skill.ts` (7/7 PASS) e verifica regressione `tests/test_presets.ts` (138/138 PASS). |
| T9.5 | ✅ Fatto | **Compact Agent Signatures & Context-Efficient Goal Orchestration**: generazione automatica firme sintetiche ad alto segnale per il catalogo orchestrator (`formatAgentSignature` in `src/cli/commands/goal.ts`, `signature?: string` in `CharacterConfig`). Abbattimento overhead prompt catalogo (budget < 60 tok/agente) a singola chiamata con supporto multi-skill e test dedicato G5 in `tests/test_goal_orchestrator.ts`. |
| T9.6 | ✅ Fatto (rivisto in T9.7) | **Star Trek Roster Revamp, Nuovi Ruoli & Squad Blueprints**: Rebranding completo del catalogo personaggi sull'universo di Gene Roddenberry (TOS, TNG, DS9, VOY, SNW con Capitan Pike come supervisore/comandante e Deanna Troi come entertainer empatico). Aggiunti 3 nuovi ruoli specializzati (`game_designer`, `tech_writer`, `storyteller`) e nuove Squad predeterminate per GameDev, TechDocs, Story/Comedy. Catalog Squad Blueprint deterministico iniettato nel Goal Orchestrator prompt (`buildGoalOrchestratorPrompt`). Suite di test 42/42 (100%) PASS. |
| T9.7 | ✅ Fatto | **Il roster è dati, i ruoli sono il contratto**: rimossi i nomi propri hard-coded da prompt, codice e test dopo la rinomina T9.6. Blueprint dell'orchestrator generati dai team installati (`buildTeamBlueprints`), risoluzione degli agenti anche per MESTIERE (`resolveCharacter` → ruolo), alias table eliminata, preset resi auto-consistenti (core+pack), fixture di test per ruolo (`tests/fixtures/roster.ts`) e nuove guardie `T7.4-install-*` in `tests/test_presets.ts`. 42/42 suite PASS. |
| T9.8 | ✅ Fatto | **Robustezza di `spawn_agent` su modelli locali "pensanti"**: osservato in uso reale (run `/goal` su Qwen3.8-27B via llama-server), tre fallimenti collegati — (1) un membro copia il proprio compito assegnato pari pari in `spawn_agent`, sfora `MAX_TASK_LENGTH` e non recupera; (2) un turno che produce solo testo/ragionamento senza mai chiamare un tool termina silenziosamente come `'continue'`, scambiando una blackboard vuota per "nessun compito"; (3) un briefing lungo incollato inline nell'argomento `task` rompe la generazione JSON della tool call (500 lato server, `invalid string: missing closing quote`), bruciando l'intero turno. Fix: (a) `strategies/common.ts` — istruzione esplicita a non delegare l'intero compito assegnato, chiarito che una blackboard vuota è normale e non un pass per `FALLITO`; (b) `spawnAgent.ts` + `tools_schemas/spawn_agent.json` — nuovo parametro `briefingFile` (letto da disco via `resolveSafePath`, limite 12000 caratteri) per un briefing lungo passato come percorso invece che come stringa JSON inline; (c) `provider.ts` — `isMalformedToolCallJsonError` distingue un 500 di JSON malformato in tool call (glitch di campionamento) da un errore di comunicazione generico e lo ritenta (stesso conteggio di "mancata risposta"), invece di arrendersi al primo colpo. Test: `SA-f-*` in `tests/test_spawn_agent_context.ts`, nuova suite `tests/test_malformed_toolcall_retry.ts` (GM.1–GM.3). 43/43 suite PASS. |
| T9.9 | ✅ Fatto | **`write_file`: scrittura a pezzi (`append`)**: `content` inline in un'unica chiamata è esposto allo stesso rischio di T9.8 — una stringa JSON lunga (un file di codice intero) può rompere la generazione della tool call su un modello locale, ed è il tool con cui si scrive la maggior parte del codice vero (più esposto di `spawn_agent`). Nuovo parametro opzionale `append: boolean` su `write_file` (`writeFile.ts` + `tools_schemas/write_file.json`): `false`/assente = comportamento invariato (sovrascrive); `true` = accoda al file esistente (lo crea se assente), per costruire un file lungo con più chiamate piccole. Normalizzato a mano (`args.append === true \|\| ...stringa "true"`) contro la trappola "la stringa `\"false\"` è truthy in JS". Schema aggiornato con la raccomandazione esplicita di dividere i file lunghi in più chiamate. Test: nuova suite `tests/test_write_file_append.ts` (WA.1–WA.4). |
| T9.10 | ✅ Fatto | **Nudge quando un turno produce solo testo, senza mai agire**: osservato due volte in uso reale (`/goal` su Qwen3.8-27B, membri `Geordi` e `Paris`) — un turno che produce centinaia/migliaia di token di solo ragionamento, senza mai una tool call, termina il turno in `Agent.run()` alla prima risposta senza `toolCalls` (comportamento corretto per la chat normale, dove un testo puro è una risposta legittima) e viene scambiato per "nessun lavoro necessario" da `resolveTurnStatus` (fallback silenzioso a `'continue'`). Fix in `agent.ts`: nuovo parametro opzionale del costruttore `acceptTextOnlyIf?: (content) => boolean` — se fornito e la prima risposta di `run()` non ha tool call E il predicato rifiuta il testo, un nudge esplicito ("non hai chiamato nessun tool, agisci ora o chiudi il turno esplicitamente") prima di accettare la risposta com'è (un solo nudge per `run()`, mai un loop). Il nudge si applica SOLO se il turno non ha MAI chiamato un tool: un turno che ha già agito e poi chiude con una nota testuale libera non deve ripetere il marker. `strategies/common.ts` passa `hasAnyStatusMarker` (qualunque `STATO: COMPLETATO\|DA_CONTINUARE\|FALLITO`, non solo COMPLETATO) come predicato per i turni di membro `/team`-`/goal`; `spawn_agent`, senza un protocollo di stato paragonabile, resta `undefined` (comportamento invariato). Test: blocco T9.10 in `tests/test_team_modes.ts` (NA1–NA3). 44/44 suite PASS. |

## T9.5 — Compact Agent Signatures & Context-Efficient Goal Orchestration

**Dipende da:** T9.1, T9.2, T9.3 · **Sforzo:** medio · **Priorità:** alta · **Stato:** ✅ Completato

### Problema
Includere l'intero `role.systemPrompt` (paragrafi lunghi pensati per la fase esecutiva) e tutti i trait prompt per 27 personaggi nel prompt del Goal Orchestrator generava un overhead di ~4.500–5.000 token solo per l'elenco agenti. Per modelli locali compatti (9B–14B) questo saturava la finestra di attenzione, causando allucinazioni o difficoltà di pianificazione.

### Soluzione Architetturale: Firme Sintetiche Determistiche (Compact Signatures)
Invece di costringere l'LLM a un doppio round o ad auto-riassumere 27 prompt di sistema, TSUKA genera a runtime una **firma sintetica compatta ad altissimo segnale**:
- **Formato**: `- @<name> (<aiName>): role=<roles> — <descrizione sintetica> | Tools: [<specific_tools>]`
- **Filtro Ambient Tools**: Esclude i tool generici/ambientali (`save_memory`, `recall_memory`, `send_message`, `list_dir`, `read_file`, `browse_url`) evidenziando solo i tool che differenziano le capacità operative (es. `audit_code`, `execute_command`, `create_tool`, `edit_file`).
- **Supporto Multi-Skill (T9.1)**: Aggrega automaticamente i ruoli (`roles: string[]`) e l'unione dei tool consentiti.
- **Override Esplicito**: Supporta il campo opzionale `signature?: string` in `CharacterConfig` (`characters/*.json`) per firme personalizzate.

### Risultati e Metriche di Accettazione
- **Token footprint catalogo**: Budget medio misurato **~50–55 tok/agente** (invece di ~180 tok/agente).
- **Latenza**: 1 singolo round LLM velocissimo per la formulazione del piano, senza raddoppio di round-trip.
- **Test Suite**: Test `G5a-d` in `tests/test_goal_orchestrator.ts` (15/15 PASS) con verifica automatica del budget token su tutti i 27 personaggi reali e suite completa (42/42 suite PASS).

## T9.6 — Star Trek Roster Revamp, Nuovi Ruoli & Squad Blueprints Deterministici

**Dipende da:** T9.5 · **Sforzo:** medio · **Priorità:** alta · **Stato:** ✅ Completato

### Contesto e Obiettivo
Riorganizzazione organica dell'intero roster dei personaggi e delle squadre sull'universo di Star Trek (Gene Roddenberry) attraversando Next Generation, Serie Classica, Voyager, Deep Space Nine e Strange New Worlds (con il Capitano Christopher Pike nel ruolo di supervisore/comandante d'eccellenza e Deanna Troi nel ruolo di intrattenitrice/consigliere empatico). Creazione di 3 nuovi ruoli specializzati (Videogiochi, Documentazione Tecnica, Storie & Commedie) e implementazione di Squad Blueprints deterministici nel prompt del Goal Orchestrator.

### Implementazione
1. **Nuovi Ruoli Specializzati (`roles/*.json`)**:
   - `game_designer.json`: Game loop, puzzle mechanics, retro/canvas game balancing.
   - `tech_writer.json`: Documentazione tecnica, architettura software, README e guide API.
   - `storyteller.json`: Narrativa creativa, commedie, sketch, dialoghi teatrali e storytelling.
2. **Roster Personaggi Star Trek (`characters/*.json`)**:
   - 27 personaggi della Flotta Stellare e dell'universo Trek coprono tutti i 21 ruoli (`pike`, `picard`, `kirk`, `geordi`, `data`, `spock`, `worf`, `paris`, `doctor`, `scotty`, `seven`, `tuvok`, `deanna_troi`, `q`, `una`, `laan`, `uhura`, `mccoy`, `quark`, `odo`, `dax`, `barclay`, `moriarty`, `ortegas`, `chapel`, `mbenga`, `torres`).
   - Nessuna mappatura alias dei nomi storici: i vecchi character sono stati rimossi e non esistono più installazioni da preservare (vedi T9.7, che ha eliminato l'alias table introdotta qui).
3. **Nuove Squad Specializzate (`teams/*.json`)**:
   - `game_dev.json` (`@paris`, `@geordi`, `@pike`)
   - `tech_docs.json` (`@geordi`, `@data`, `@pike`)
   - `story_comedy.json` (`@doctor`, `@q`, `@pike`)
   - `dev_security.json` (`@geordi`, `@worf`, `@pike`)
   - `dev_ops.json` (`@scotty`, `@geordi`, `@pike`)
   - `osint_recon.json` (`@spock`, `@seven`, `@pike`)
   - `cyber_audit.json` (`@worf`, `@tuvok`, `@pike`)
   - `creative_promo.json` (`@kirk`, `@deanna_troi`, `@pike`)
   - `research_writer.json` (`@spock`, `@dax`, `@pike`)
   - `legal_research.json` (`@spock`, `@deanna_troi`, `@pike`)
4. **Squad Blueprint Catalog nel Goal Orchestrator**:
   - `buildGoalOrchestratorPrompt` include l'elenco delle squadre preconfigurate con istruzioni di prioritizzazione. **Nota (T9.7)**: l'elenco era hard-coded nel prompt e citava agenti che il preset `core` non installa; ora è generato dai team realmente installati (`buildTeamBlueprints`).
5. **Validazione e Preset**:
   - Preset `core.json` e `packs/*.json` aggiornati e validati con 177/177 check in `tests/test_presets.ts`.
   - Tutte le 42 suite di test di TSUKA (`npm test`) passano con successo (100% PASS).

## T9.7 — Il roster è dati: nessun nome proprio nel codice

**Dipende da:** T9.6 · **Sforzo:** medio · **Priorità:** alta · **Stato:** ✅ Completato

### Problema
La rinomina del roster (T9.6) aveva lasciato dietro di sé riferimenti ai nomi vecchi e
nuovi nomi scritti a mano in punti che dovevano restare generici:
- **preset incoerenti**: `core` installava i team `story_comedy` e `dev_security` senza
  installare `q` e `worf`; `content` installava `creative_promo` senza `deanna_troi`;
  `devops` installava `cyber_audit` senza `worf`; `tuvok` arrivava con la skill
  `security_auditor` ma senza il file del ruolo;
- **blueprint hard-coded** nel prompt dell'orchestrator, che citavano agenti non installati
  (`parsePlan` li scartava, dimezzando il piano in silenzio);
- **alias table** di 30 nomi storici in `src/cli/shared.ts`, con voci sbagliate
  (`hard_edge` → un developer invece di un SEO) e una morta (`cold_steel` → `hemmer`, file
  inesistente);
- **test verdi per il motivo sbagliato**: `test_team_modes`, `test_protocol_parsing`,
  `test_blackboard` usavano `falco`/`piccione`/`overseer` come fixture e passavano solo
  grazie a quegli alias;
- **trait didattico orfano**: `compliant` restava elencato nel pack `demo` senza nessun
  character che lo usasse — l'esempio negativo sul voto non era più dimostrabile.

### Soluzione: i nomi sono dati, i ruoli sono il contratto
1. **Prompt derivati** — `buildTeamBlueprints(allCharacters)` genera i blueprint dai
   `teams/*.json` installati, descritti come catene di RUOLI (`developer (@geordi) → …`);
   catalogo, esempi e agente di fallback escono dal catalogo reale. Un solo concetto di
   squadra: il team di `/team`, non un archetipo separato inventato nel prompt.
2. **Risoluzione per mestiere** — `resolveCharacter` risolve nome file → `aiName` → RUOLO:
   `@security_auditor` designa chi quel mestiere lo esercita. L'alias table è stata
   rimossa: con il multi-skill (T9.1) un handle copre più mestieri e non serve un secondo
   agente solo per raggiungere il tool di un altro ruolo.
3. **Criterio di supervisione per ruolo** — la rilavorazione in `/goal` si innesca su
   `rolesOf(char).includes('supervisor')`, non su un nome; le stringhe UI parlano di
   "supervisore", non di "Overseer".
4. **Preset auto-consistenti** — `core` installa anche `q` e `worf` (con i ruoli
   `entertainer` e `security_auditor`); `content` installa `deanna_troi`; `demo` recupera
   l'esempio didattico con `neelix` (`researcher` + trait `compliant`) e la nota che lo
   spiega; `osint`/`devops` dichiarano i ruoli delle skill secondarie dei loro character.
5. **Fixture di test per ruolo** — `tests/fixtures/roster.ts` (`agentWithRole`,
   `distinctAgents`, `aiNameOf`): 11 suite non nominano più nessun personaggio; le fixture
   puramente sintetiche (parser) usano nomi inventati e indipendenti dal catalogo.

### Guardie aggiunte (`tests/test_presets.ts`)
- `T7.4-install-*`: simula `core` e `core+<pack>` e verifica che ogni membro dei team
  installati sia installato, e che ogni skill dichiarata abbia il suo file di ruolo;
- `T7.1-demo-trait-incarnato-*`: un trait elencato nel pack didattico deve avere almeno un
  character che lo incarna;
- la copertura dei ruoli ora conta anche le skill secondarie del multi-skill.

### Risultato
`npx tsc --noEmit` pulito, 42/42 suite PASS. Documentazione allineata (README, README-it,
`docs/multi-agent.md`, `docs/use-cases.md` con la tabella dei team generata dai file reali,
`docs/security.md`, `AGENTS.md`); rimosso da `package.json` lo script morto `test:puzznic`.

---

# FASE 5 — Backlog & Evoluzioni Future (Routing Adattivo dei Modelli)

## T10.1 — Dynamic Model Auto-Routing (Selezione Adattiva del Modello da Benchmark)

**Sforzo:** alto · **Priorità:** media · **Prerequisiti:** T8.10, Capability Fingerprinting (`models_profile.json`)

### Descrizione
Sfruttare la matrice dei profili di fingerprinting misurati da `/benchmark` (`models_profile.json`) per consentire a TSUKA di selezionare automaticamente e dinamicamente il modello LLM più adatto, economico e veloce per ciascun sotto-task assegnato agli agenti in `/goal`, `/team` o `spawn_agent`.

### Architettura Proposta
1. **Classificazione Adattiva del Task**:
   - Analisi del tipo di task (es. *Coding/Refactoring*, *JSON Structuring*, *Creative Writing*, *Audit di Sicurezza*, *Sintesi Breve*).
   - Matching dei requisiti del task con le metriche del benchmark (`instruction`, `json`, `toolCalling`, `avgCompletionTokens`, `tok/s`).

2. **Criteri di Assegnazione Modelli**:
   - **Task ad Alta Complessità / Tool Calling**: Assegnati ai modelli con Tier `LARGE`/`MEDIUM` misurato (es. `qwen2.5-coder`, `deepseek-r1`).
   - **Task di Scrittura Creativa / Copywriting**: Assegnati a modelli veloci ad alta creatività (`creativity: "creative"`).
   - **Task di Sintesi / Formattazione**: Assegnati ai modelli più leggeri ed economici (`reasoningEffort: "none"`, `tok/s` elevato).

3. **Gestione del Model Swapping**:
   - Riconoscimento del tipo di provider: per provider locali single-GPU (es. Ollama), minimizzare lo swapping di modelli da VRAM introducendo il raggruppamento per modello; per endpoint cloud (OpenRouter) o server paralleli (Unsloth + Ollama), switching a latenza zero.
   - Fallback automatico sul secondo modello più idoneo in caso di errore o timeout (`llmTimeoutMs`).

### Criteri di Accettazione (Futuri)
- `/goal` e `/team` riescono ad assegnare modelli differenti agli agenti della squadra in base ai profili di `models_profile.json`.
- Integrazione coerente con la cascata dell'effort e della creatività esistente.
- Suite di test dedicata `tests/test_model_routing.ts`.

---

# FASE 6 — Release Readiness & Packaging Optimization

> Obiettivo: preparare TSUKA alla pubblicazione open-source e npm garantendo packaging impeccabile, onboarding resiliente al primo avvio su qualsiasi OS, e documentazione chiara con Quickstart.

## T11.1 — Packaging npm & Sanitizzazione Distribuzione

**Dipende da:** nessuno · **Sforzo:** basso · **Priorità:** alta

Configurare il packaging formale di TSUKA per la distribuzione via npm registry e l'esecuzione tramite `npx tsuka` / `npm install -g tsuka`.

- Aggiungere il campo `files` in `package.json` con la whitelist rigorosa degli asset da distribuire:
  ```json
  "files": [
    "dist",
    "roles",
    "traits",
    "characters",
    "teams",
    "presets",
    "tools_schemas",
    "benchmarks",
    "tsuka.config.json"
  ]
  ```
- Configurare `.npmignore` esplicito per escludere file di test (`tests/`), memorie persistenti locali (`memory/`), run temporanee (`runs/`, `workspace/`, `output/`, `workflow_logs/`), e log locali.
- Verificare la risoluzione degli asset in `src/core/apphome.ts` e `src/cli/shared.ts` per garantire che, se invocato come pacchetto npm globale o via `npx`, TSUKA trovi sempre i preset e i character inclusi nel pacchetto senza dipendere da directory di sviluppo relative errate.

**Accettazione:** `npm pack --dry-run` produce un archivio pulito contenente solo il codice compilato e gli asset di configurazione/preset; nessun file di test o di runtime locale incluso.

## T11.2 — Zero-Config First Run & Wizard Onboarding

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** massima

Garantire un'esperienza a zero frizione per l'utente che avvia TSUKA per la prima volta in una directory vuota o su un sistema privo di configurazione preesistente.

- Se all'avvio nessun provider LLM locale è raggiungibile (Ollama, LM Studio, Unsloth) e non è presente una chiave API in `tsuka.config.json` o `.env`:
  1. Non lanciare stacktrace raw di connessione.
  2. Mostrare un banner accogliente che spiega chiaramente la situazione.
  3. Offrire un prompt interattivo (`prompts`): scelta tra configurare un endpoint Ollama locale, inserire una chiave OpenRouter, o avviare `tsuka init`.
- Intercettare tempestivamente gli errori di rete verso LLM durante il ciclo ReAct (`Agent.run`), fornendo suggerimenti pratici a video (es. *"Assicurati che Ollama sia avviato con `ollama serve`"*).

**Accettazione:** Esecuzione di TSUKA in ambiente sterile (senza config e senza LLM attivo) gestita con grazia, con prompt guidato e zero crash non intercettati.

## T11.3 — CI/CD Multi-OS & Script di Pre-Publish / Dry-Run

**Dipende da:** T11.1 · **Sforzo:** basso · **Priorità:** alta

Estendere l'automazione di Continuous Integration per validare la compatibilità cross-platform su tutti i target supportati.

- Aggiornare `.github/workflows/test.yml` per testare la matrice:
  - OS: `ubuntu-latest`, `windows-latest`, `macos-latest`
  - Node.js: `20.x`, `22.x`
- Includere nello step di CI: `npm ci` → `npm run build` → `npm test` → `npm pack --dry-run`.
- Aggiungere uno script npm `npm run prepublishOnly` che esegua automaticamente build e test prima di qualsiasi operazione di publish.

**Accettazione:** Workflow GitHub Actions completo che valida build, test e packaging su tutte e 3 le piattaforme operative.

## T11.4 — Documentazione Open-Source & Quickstart a 3 Comandi

**Dipende da:** T11.1, T11.2 · **Sforzo:** basso · **Priorità:** media

Rendere il repository immediatamente fruibile e attraente per la community GitHub e sviluppatori esterni.

- Aggiornare `README.md` e `README-it.md` posizionando in evidenza (subito sotto il banner iniziale) un **Quickstart a 3 comandi**:
  ```bash
  # 1. Installazione globale
  npm install -g tsuka

  # 2. Inizializzazione rapida del workspace
  tsuka init --preset core

  # 3. Avvio
  tsuka
  ```
- Aggiungere indicazioni chiare per il primo comando di test (es. `/goal "Crea un server Express con endpoint di healthcheck"` o `/team game_dev`).
- Preparare la sezione per demo visiva / GIF terminale.

**Accettazione:** README allineato, chiaro, con guida rapida al primo avvio in cima sia in inglese che in italiano.

## T11.5 — Dynamic Context Window Auto-Detection (Rilevamento Live del Limite di Contesto)

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** alta

Rilevare dinamicamente e in tempo reale la dimensione della finestra di contesto (`n_ctx` / `context_length`) dal backend LLM attivo (llama-server, Ollama, OpenRouter, vLLM), superando il limite statico di `tsuka.config.json` che fungerà unicamente da fallback.

- Implementare `detectContextWindow(baseUrl, apiKey, model)` in `src/core/discovery.ts`:
  - **`llama-server` (llama.cpp)**: interroga `GET /props` (`default_generation_settings.n_ctx` o `n_ctx`) con fallback su `GET /slots` (`slots[0].n_ctx`).
  - **`Ollama`**: interroga `POST /api/show` con `{ "name": model }` e cerca `model_info["llama.context_length"]`, `model_info["qwen2.context_length"]`, `model_info["context_length"]` o `parameters` (`num_ctx`).
  - **`OpenRouter` & `vLLM`**: interroga `GET /models` e recupera `context_length` o `max_model_len` corrispondente al modello attivo.
- Aggiornare `ConfigManager` con `setRuntimeContextTokens` / `getRuntimeContextTokens` e fare in modo che `getMaxHistoryTokens()` dia priorità al valore live rilevato dal server se presente.
- Visualizzare nel pannello di avvio e nei comandi `/info`, `/context` e `/use` la finestra di contesto effettiva e la sua sorgente (`server live` vs `config fallback`).
- Scrivere la suite di test `tests/test_context_detection.ts` per validare il parsing dei vari formati di payload server.

**Accettazione:** All'avvio su llama-server o Ollama, TSUKA adotta automaticamente la dimensione reale del contesto del modello/server senza richiedere modifiche manuali a `tsuka.config.json`.

## T11.6 — Token-Driven History & Dynamic Command Timeout

**Dipende da:** T11.5 · **Sforzo:** basso · **Priorità:** alta

- Rendere il budget token (`maxHistoryTokens`) il driver primario per il pruning della cronologia in `Agent.pruneHistory`: non eliminare messaggi finché il contesto effettivo non supera la soglia di guardia (o il 75% per la smart compression).
- Alzare `maxHistoryMessages` di default da 40 a 500 (funzione di sola guardia superiore per loop infiniti).
- Rendere il timeout di `execute_command` configurabile tramite il parametro opzionale `timeout_ms` (nello schema JSON del tool) e tramite `commandTimeoutMs` in `tsuka.config.json` (default 120000 ms, cap 10 min).
- Migliorare il messaggio di errore su timeout fornendo spiegazioni operative e suggerimenti per operazioni lunghe o demoni.

**Accettazione:** Esecuzione di loop prolungati senza potature premature a basso consumo di token; possibilità per l'agente di specificare timeout personalizzati per comandi pesanti.

## T11.7 — Blackboard Visibility & Goal Report Persistence

**Dipende da:** T6.2 · **Sforzo:** basso · **Priorità:** media

- Persistenza automatica dei report di workflow per `/goal` in `workflow_logs/goal-<timestamp>.json` con esito, task, agenti, token stats e snapshot della Blackboard.
- Stampa a console delle note della Blackboard al completamento del goal se utilizzata dagli agenti (`post_note`).
- Implementazione del comando slash `/blackboard [limit]` nel REPL per visualizzare le note e i dettagli degli ultimi workflow eseguiti.
- Allineamento documentale in `AGENTS.md` e persistenza dello snapshot della lavagna.

**Accettazione:** Tutti i workflow (/team e /goal) salvano i report e le note della blackboard in modo consultabile in `workflow_logs/` e tramite il comando `/blackboard`.

## T11.8 — Self-Healing History & Malformed Tool Call Sanitization

**Dipende da:** T9.8 · **Sforzo:** medio · **Priorità:** alta

Prevenire il crash a cascata (HTTP 500 `Failed to parse tool call arguments as JSON: missing closing quote`) su `llama-server` e altri backend con parser C++/Jinja rigorosi quando un modello genera tool call con JSON malformato o troncato.

- Implementare `sanitizeAndParseToolArgs(rawArguments)` in `src/core/agent.ts`:
  1. Tentativo di parse diretto JSON.
  2. Tentativo di riparazione euristica per stringhe/oggetti troncati (chiusura automatica di virgolette e parentesi graffe mancanti).
  3. In caso di fallimento della riparazione, incapsulamento automatico in un payload JSON valido `{ _error: 'invalid_json_arguments', _raw_malformed_input: raw }`.
- Garantire che la proprietà `function.arguments` di ogni `tool_call` salvata in `this.messages` (`role: 'assistant'`) sia sempre un JSON valido al 100%, eliminando la contaminazione della cronologia che causava risposte 500 su tutti i retry successivi.
- Gestire in `ToolRegistry.executeTool` e `validateToolArgs` l'errore esplicito di argomenti malformati con messaggio informativo per l'agente.
- Scrivere la suite di test `tests/test_toolcall_sanitization.ts`.

**Accettazione:** Quando un modello produce una tool call con JSON troncato o non valido, la cronologia non viene corrotta e il server locale non va in HTTP 500 nei round successivi, consentendo all'agente di ricevere l'errore e correggersi.

## T11.9 — Codebase-Wide JSON Resilience & Protocol Hardening

**Dipende da:** T11.8 · **Sforzo:** basso · **Priorità:** alta

Estendere il motore modulare `jsonRepair.ts` a tutti i punti di consumo di input/output generati da modelli LLM:

- **Protocollo multi-agente (`strategies/common.ts`, `strategies/hybrid.ts`, `strategies/orchestrated.ts`)**:
  - `extractReportStatusCall`, `extractCastVoteCall`, `extractRouteNextCall` ora usano `sanitizeToolCallArguments(raw).parsed` invece di `JSON.parse` rigido, prevenendo degradamenti a regex causati da trailing commas o code fences.
- **Benchmark DSL runner (`src/core/benchmarkTests.ts`)**:
  - `extractJson(text)` e `parseArgs(tc)` integrano `repairJsonString` e `sanitizeToolCallArguments` per una tolleranza robusta sui payload JSON di verifica.
- **Tool Registry execution (`src/tools/registry.ts`)**:
  - `ToolRegistry.executeTool` applica sanificazione e normalizzazione preventiva su argomenti passati come stringa prima della validazione dello schema e dell'esecuzione effettiva.

**Accettazione:** Massima tolleranza a glitch sintattici minori degli LLM in tutta la piattaforma senza falsi degradamenti del protocollo né fallimenti nei benchmark.

## T11.10 — Context-Aware Reasoning Budgeting, Throttling & CoT Recovery

**Dipende da:** T11.5, T11.6 · **Sforzo:** medio · **Priorità:** alta

Implementare la protezione a più livelli contro il sovraccarico di contesto causato da generazioni Chain of Thought prolungate:

- **Calcolo Dinamico del Budget (`calculateReasoningBudget` in `src/core/contextBudget.ts`)**:
  - Calcola la percentuale di contesto libero prima di ogni chiamata API in base ai token stimati di prompt e schemi dei tool.
  - Se il contesto è abbondante (> 55%), mantiene l'effort nominale.
  - Se il contesto è medio (30% - 55%), attiva la concisione e riduce `xhigh`/`high` a `medium`.
  - Se il contesto è critico (< 30%), applica throttling aggressivo a `low` o `none` per evitare context overflow e crash di llama-server.
- **CoT Recovery su Risposta di Solo Pensiero (`Agent.run` in `src/core/agent.ts`)**:
  - Quando un modello esaurisce il turno in solo ragionamento senza chiamare tool (o viene troncato prima della chiamata), il nudge di azione forza per il retry immediato un reasoning effort pari a `'none'`. Il modello non ripete il ragionamento da zero e produce istantaneamente la tool call in frazioni di secondo.
- **Suite di Test (`tests/test_reasoning_budget.ts`)**:
  - 5 test dedicati che coprono throttling su contesti ampi, medi e critici, e il passaggio deterministico a effort `none` nel round di recovery di `Agent.run`.

**Accettazione:** Quando un modello affronta contesti stretti o produce risposte con solo CoT, l'effort viene regolato dinamicamente per prevenire overflow e il recovery spinge all'azione immediata a costo computazionale nullo.

## T12.1 — Evoluzione browse_url: HTML-to-Markdown strutturato & Media Extraction

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** media

Sostituire l'attuale funzione Regex in [`src/tools/impl/browseUrl.ts`](file:///f:/progetti_ai/harness/src/tools/impl/browseUrl.ts) con una libreria avanzata di parsing HTML e content extraction (`node-html-markdown`).

- Estrarre in modo pulito il contenuto principale del documento (modalità Reader View), scartando parti non rilevanti (navigation, footer, ad, sidebar, cookie banner).
- Preservare e formattare correttamente gli elementi strutturati ed i media:
  - Immagini `![alt](url)` con risoluzione URL assoluti ed esclusione spacer/tracking pixel.
  - Link a video ed anteprime (tag `<video>`, `<source>`, `<iframe>` player tipo YouTube/Vimeo).
  - Tabelle HTML in sintassi Markdown GFM allineate.
- Mantenere l'integrazione con `capForContext` per la gestione del budget di token.
- Offrire agli agenti con capacità visive (Vision LLM / Multimodali) una sezione riassuntiva `### 📎 Media & Risorse della Pagina` con gli URL assoluti delle immagini e dei video.

**Implementazione & Test:**
- `src/tools/impl/browseUrl.ts`: implementata pipeline Reader View (`cleanHtmlForReader`), estrazione media (`extractMedia`), risoluzione URL assoluti (`resolveAbsoluteUrl`) e traduzione Markdown GFM (`NodeHtmlMarkdown`).
- `tests/test_browser_evolution.ts`: 9 check deterministici a copertura completa.

**Accettazione:** `browse_url` converte pagine HTML complesse senza fragilità da Regex, mantenendo pulizia di contesto ed estraendo immagini/video leggibili dagli agenti. Suite di test con 52/52 suite verdi.









