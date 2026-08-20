# TASKS 

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
| T11.6 | ✅ Fatto | Token-Driven History & Dynamic Command Timeout: potatura cronologia guidata dai token effettivi con tetto a 500 messaggi; timeout di `execute_command` reso dinamico via parametro `timeout_ms` e configurabile con `commandTimeoutMs` in `tsuka.config.json`. |
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
| T13.5 | ✅ Fatto | Costanti di Configurazione, Template di Esempio & Igiene del Repository: `maxToolRounds` (default 15) e `memoryMaxFacts` (default 200) spostati da costanti statiche hardcodate a parametri configurabili in `tsuka.config.json` e `ConfigManager`, propagati ad `Agent` (in `index.ts`, `strategies/common.ts`, `spawnAgent.ts`) e a `MemoryStore`; creato `tsuka.config.json.example` come template di riferimento pulito per GitHub; ripulito `tsuka.config.json` e i fallback da modelli/porte locali personali; suite `tests/test_config_limits.ts` (13 check OK). 57/57 suite verdi, `tsc --noEmit` pulito. |
| T14.1 | ✅ Fatto | **Interactive Terminal UI (TUI Dashboard)**: Dashboard terminale interattiva a schermo intero (`src/tui/`) con architettura Component-Driven (`src/tui/views/`), store reattivo Flux (`TuiStore`), double-buffering differenziale a zero-sfarfallio (`TuiScreen`), mouse tracking esteso SGR 1006 (scorrimento con rotellina e click-to-focus/insert), scrollbar grafica (`░`/`█`), file explorer del workspace in tempo reale con icone di estensione, gestione interattiva del ciclo di vita con modali di rinnovo timeout e concessione round tool (`provider.ts`/`agent.ts`), auto-rilevamento contesto modello (`detectContextWindow`), cheatsheet comandi REPL (`F12`), pacchetti ANSI standard (`string-width`, `strip-ansi`, `slice-ansi`, `wrap-ansi`); suite `tests/test_tui.ts`. |
| T14.2 | ✅ Fatto | **Data-Driven Layout Engine, Modular Widgets & v0.4.0 Release**: Estrazione dei blocchi sidebar in micro-widget autonomi e riutilizzabili (`src/tui/widgets/{PersonaWidget,MetricsWidget,ToolActivityWidget,QuickKeysWidget}.ts`); disaccoppiamento del driver di schermo in `inputParser.ts` (decodifica eventi tasti e mouse SGR), `boxDrawing.ts` (primitive grafiche e scrollbar) e `screen.ts` (~150 righe); motore di layout configurabile via JSON (`tui.layout.json`, `layoutConfig.ts`) con preset dinamici (Default, Wide Chat, Sidebar a Destra, Zen Focus), 5 temi colore e editor visivo interattivo nella TUI (`F7` / `/layout`); indicatore dinamico reasoning effort (livello effettivo + sorgente persona/ruolo/pin); rilascio ufficiale **v0.4.0**; 58/58 suite di test verdi. |
| T14.3 | ✅ Fatto | **Workspace File Viewer Modal**: Modale di anteprima e ispezione rapida dei file dal Files Explorer (`src/tui/views/Files.ts`, `src/tui/modals/fileViewerModal.ts`) con numerazione righe, scroll fluido (frecce/mouse/paginazione) e jail di sicurezza `resolveSafePath`; suite `tests/test_tui_fileviewer_export.ts`. |
| T14.4 | ✅ Fatto | **Session Export to Markdown (`/export` Command)**: Esportazione completa e strutturata della cronologia di chat attiva, blocchi Chain of Thought e chiamate tool in un documento Markdown pulito (`exports/session-<timestamp>.md`) tramite comando slash `/export` e `/save`; suite `tests/test_tui_fileviewer_export.ts`. |
| T14.5 | ✅ Fatto | **Multi-line Input Prompt & Paste Preservation**: Supporto per input su più righe nel prompt buffer (`Shift+Enter`, `Ctrl+J`, paste multi-linea) con rendering dinamico multilinea, box ad altezza elastica e navigazione cursore 2D; suite `tests/test_multiline_tools_filter.ts`. |
| T14.6 | ✅ Fatto | **Interactive Tools Search & History Filter (CLI + TUI Parity)**: Filtro di ricerca testuale dinamico in tempo reale per la vista Tool Inspector (`F2` / `/tools`) e per il comando CLI `/tools [query]` su nome tool, tier di sicurezza (`SAFE`/`RESTRICTED`/`DANGEROUS`) ed esecuzioni; suite `tests/test_multiline_tools_filter.ts`. |
| T14.7 | ✅ Fatto | **Real-Time Inference Telemetry & Latent Space Inspector Widget**: Widget autonomo posizionato nella sidebar (tra Agent Profile e Files Explorer) per monitorare lo stato di prefill (KV Cache ingestion), Time To First Token (TTFT), velocità di decode (tok/s), confidenza del modello e top token candidati latenti (`logprobs`); suite `tests/test_inference_telemetry.ts`. |
| T14.8 | ✅ Fatto | **Hardware Status LEDs Widget (Compact Mode)**: Widget compatto a indicatori LED luminosi (`[RDY]`, `[PRE]`, `[THK]`, `[DEC]`, `[TOL]`) per un monitoraggio visivo immediato senza percentuali matematiche, selezionabile e configurabile tramite layout engine (`F7` / `/layout`); suite `tests/test_inference_telemetry.ts`. |
| T14.9 | ✅ Fatto | **Telemetria di Inferenza Reale**: Rimossi i valori sintetici del widget T14.7 (confidenza calcolata da `chunkCount`, riga logits mai popolata, tok/s che includeva il prefill). Nuovo canale `setInferenceTelemetrySink` in `provider.ts` (stesso pattern di `setLogSink`/`setTimeoutPromptHandler`): TTFT misurato dall'inizio del tentativo corrente, finestra di decode separata dal prefill, conteggio token da `logprobs.content` con fallback per-delta. `ChatStats` estesa con `ttftMs`/`decodeMs`/`prefillTokensPerSecond` e `tokensPerSecond` ridefinita sulla sola finestra di decode (aggregazione multi-round coerente in `Agent`). Logprobs reali opt-in (`inferenceLogprobs`, default `false`) con disattivazione automatica **loggata** e ritentativo se il backend rifiuta il parametro; senza logprobs il widget non mostra né barra di confidenza né riga logits. Suite `tests/test_inference_telemetry.ts` (13 test, inclusi 3 sul provider reale con stream simulato). |
| T14.10 | ✅ Fatto | **Il Tasto `?` Digitabile nel Prompt**: `?` non è più una scorciatoia globale che intercetta la digitazione (`isHelpShortcut` in `inputParser.ts`): l'help resta su `F12` (sempre attivo) e `?` apre la cheatsheet solo con il focus fuori dall'input e nessuna modale aperta. Etichette dell'header allineate (`F12 Help`). |

| T14.11 | ✅ Fatto | **Dispatch Data-Driven della TUI (Leggibilità)**: Sostituite le catene di condizioni con tabelle di dati. `handleCommand` (569 righe, 26 rami `if`) diventa il registry `src/tui/commands/` (`name`/`aliases`/`description`/`hidden`/handler, raggruppati per dominio) più un dispatcher di 20 righe, con `assertMenuCoverage()` a impedire divergenze tra menu e handler e `runCliWorkflow` al posto del blocco try/catch/finally copiato per `/goal`, `/team`, `/call`, `/benchmark`. `src/tui/navigation.ts` (`TUI_TABS`) diventa l'unica fonte di tasti funzione, etichette per larghezza, zone di click del mouse (prima colonne hardcoded 95-106) e voci della cheatsheet (prima incompleta: mancavano F7 e F12). `ModalView.renderOverlay` passa a `BOX_BUILDERS` per tipo con composizione condivisa; lo `switch` su `AgentEvent` nel bridge diventa una tabella tipizzata sull'unione con `backToThinking()`/`patchCurrentToolCalls()` estratti. Suite `tests/test_tui_data_driven.ts`. |

| T14.12 | ✅ Fatto | **Navigazione Directory nel Files Explorer**: Esplorazione iterativa dell'albero del workspace (`src/tui/fileExplorer.ts`): `→` entra nella cartella selezionata, `←` risale, `Enter` è contestuale (cartella → entra, file → anteprima), voce `.. (up)` come prima riga fuori dalla root e titolo del pannello come breadcrumb. Ogni risoluzione passa da `resolveSafePath`, quindi nessuna sequenza di tasti esce dalla workspace jail; `i`/`Space` e il click inseriscono ora il percorso completo relativo alla root invece del solo nome file. Suite `tests/test_files_explorer.ts`. |

| T14.13 | ✅ Fatto | **Wiki GitHub Generato dalla Documentazione**: `scripts/buildWiki.ts` (`npm run wiki:build`) costruisce le pagine wiki da una tabella `PAGES` derivandole da `docs/`, da sezioni dei README e dalla tabella dei comandi (`Slash-Commands` nasce da `TUI_COMMANDS`, quindi alias e descrizioni non possono divergere dal codice); riscrive i link — rimandi tra documenti → pagine wiki, riferimenti al codice → URL assoluti `blob/main` — perché il wiki è un repository separato. `Home`, `_Sidebar` e `_Footer` sono generati; workflow `.github/workflows/wiki.yml` ripubblica su push a `main` (la prima pagina va creata a mano dal browser, GitHub crea il repo del wiki solo allora). Aggiunti `tsconfig.check.json` + `npm run typecheck` (`npm run build` compila solo `src/`) e corretti 4 link `file:///` locali nei docs. Suite `tests/test_wiki_build.ts`. |

| T14.14 | ✅ Fatto | **Schemi dei Tool Differiti (`coreTools` + `load_tools`)**: il prefisso fisso del prompt era quasi tutto schemi di tool (89% su `developer`), ripagato a ogni round del loop ReAct. `resolveToolSet` (`src/core/toolSet.ts`) fa dichiarare a un ruolo un `coreTools` sempre presente per intero; il resto è differito (solo il nome nel prompt) e si attiva a runtime col tool `load_tools` (`src/tools/impl/loadTools.ts`), senza mai allargare `allowedTools`. Corretto anche un bug di chiave (`request_goal/team/call.json` usavano `"schema"` invece di `"parameters"`: il modello li vedeva senza parametri). `developer`: 4.254→1.868 token di soli schemi (−56%); su un modello non profilato il prefisso fisso totale passa da 5.478 a 1.909 token (−65%). Suite `tests/test_deferred_tools.ts` (36 test). |

| T14.15 | ✅ Fatto | **Rumore nella Memoria Iniettata nel Prompt**: uno store reale con 200 fatti ne aveva 168 di tipo `run`, quattro ripetuti dieci volte ciascuno. Deduplica in scrittura (`memory.ts`, `addFact`: una ripetizione fonde nel fatto esistente invece di aprirne uno nuovo) e guarigione al `load()` degli store scritti prima del fix. `formatForPrompt` selezionava per sola recency mentre l'eviction classificava già i `run` come da buttare per primi — ora riusa lo stesso punteggio (`rankByRetentionValue`): una regola sola, due viste. Isolamento dei test reso strutturale (`tests/isolateMemory.ts`, importato da 26 suite): una suite lanciata da sola non tocca più `memory/memory.json` dell'utente. Suite `tests/test_memory_dedup.ts` (17 test). |

| T14.16 | ✅ Fatto | **`/benchmark` nella TUI & Autodiscovery del Modello all'Avvio**: `require('../../cli/commands/benchmark')` in `workflowCommands.ts` puntava a un file inesistente (`handleBenchmark` vive in `cli/commands/provider.ts`) — il comando falliva sempre a runtime pur superando `assertMenuCoverage()`, che verifica solo che il *nome* del comando sia registrato, non che il suo `require()` risolva davvero. Corretto il percorso e rafforzato il test perché lo stesso bug non possa ripassare inosservato. Aggiunta anche `TuiApp.discoverModelAtStartup()`: all'avvio la TUI chiamava solo `detectContextWindow` sul modello già scritto in config, mai `probeProvider` — un modello configurato ma non più servito dal backend, o un modello diverso caricato in RAM, passavano inosservati fino al primo `/provider` manuale. Ora riconcilia config e server allo startup nello stesso spirito di `handleProvider`. |

| T14.17 | ✅ Fatto | **Spinner CLI Sotto la TUI: Terminale Corrotto e Schermo Congelato**: `CLITheme.createSpinner` restituiva sempre un'istanza `ora` reale, che scrive ANSI grezzo sullo stesso stdout posseduto dal renderer double-buffered della TUI — `/benchmark`, con `spinner.text` aggiornato più volte al secondo per modello, era il caso più visibile. Sotto `TSUKA_TUI`, `createSpinner` ora restituisce uno shim che non tocca mai stdout: `succeed`/`fail` passano da `logSink` come ogni altro messaggio `CLITheme`. Il fix ha esposto un secondo problema, non previsto in origine: silenziare gli aggiornamenti intermedi toglieva anche l'unico motivo per cui lo schermo si ridisegnava durante un workflow lungo — l'input restava visivamente "congelato" per minuti. Nuovo canale `core/progressSink.ts` (gemello di `logSink`, ma per testo effimero): lo spinner vi inoltra ogni passo, l'header lo mostra in tempo reale sotto la barra di stato (`TuiGenerationStatus.detail`). Suite `tests/test_cli_spinner.ts` (4 test) + nuovo blocco in `tests/test_tui_data_driven.ts` (4 test). |

| T14.18 | ✅ Fatto | **Fedeltà del Renderer Markdown (CLI + TUI)**: `renderMarkdownToLines` (`src/cli/markdown.ts`, condiviso da CLI e TUI) convertiva l'HTML di `marked` in testo scartando ogni tag — grassetto, corsivo, codice inline e link perdevano ogni distinzione visiva, e i link perdevano proprio l'URL; le tabelle non avevano un `case` dedicato e cadevano nel `default`, che stampava ogni cella su una riga separata; le liste ordinate mostravano sempre `•`, mai la numerazione. Nuovo `inlineHtmlToAnsi` (stack di stili generico: un tag non mappato è un no-op, non serve un caso per ciascuno) applica ANSI reale a grassetto/corsivo/barrato/codice inline e mantiene l'URL dei link come `(url)` in coda; nuovo `case 'table'` allinea le colonne rispettando `:--`/`--:`/`:-:`, restringendole proporzionalmente se non entrano nella larghezza disponibile; le liste ordinate numerano davvero. Trovati e corretti in corsa anche checklist (`- [ ]`/`- [x]`, checkbox assente prima) e immagini (`![alt](src)`, sparivano senza traccia). +9 casi in `tests/test_markdown_render.ts` (MD6–MD9). |

| T14.19 | ✅ Fatto | **Cambio Modello nella TUI Non Chiedeva Mai il Caricamento al Server**: `/models` in TUI (sia il picker `SystemModals.openModelModal` sia `/models <nome>` diretto in `configCommands.ts`) aggiornava solo il puntatore interno di TSUKA (`provider.setCurrentModel` + config) — a differenza della CLI, non chiamava mai `warmUpModel` (la vera richiesta che forza il server a caricare il modello), quindi lo swap restava differito in silenzio al primo messaggio di chat vero, che si mangiava tutta la latenza di caricamento senza preavviso. La conferma interattiva della CLI (`prompts()`) non può renderizzarsi nella TUI, quindi non è "chiedere in modo sicuro" ma "saltare del tutto". Estratte `warmUpIfNeeded`/`syncModelOnServer` (`cli/commands/provider.ts`) dalla vecchia `maybeWarmUp`: warm-up automatico senza conferma nei percorsi TUI, con progresso live nell'header (riuso T14.17: `isGenerating`/`progressSink`, mai rubati a un turno reale già in corso — guardia `wasIdle`). `pickModel` in CLI resta invariato (chiede prima). Suite `tests/test_model_warmup.ts` (9 test, isolata via `TSUKA_HOME` temporaneo perché `syncModelOnServer` costruisce un `ConfigManager` reale). |

| T14.20 | ✅ Fatto | **Elenco Memoria Illeggibile (Contenuto Tutto Uguale, Data Non Leggibile)**: il picker `/memory` della TUI etichettava ogni fatto con ~40 caratteri grezzi di `content` — la maggior parte dei fatti condivide un prefisso lungo (`[Goal] `, `AGENTE: `, …), quindi la parte che li distinguerebbe davvero è proprio quella tagliata via — e una data che era in realtà solo un orario (`toLocaleTimeString()`, niente giorno/mese/anno): due fatti salvati in giorni diversi alla stessa ora sembravano identici. Nuovo campo `summary` su `MemoryFact` (`core/memory.ts`), sempre popolato — esplicito se fornito, altrimenti derivato dalla prima riga di `content` (stesso tetto di 72 caratteri di un oggetto di commit); i vecchi fatti su disco senza il campo vengono sanati al `load()` (stesso schema di guarigione di T14.15); su una ripetizione vince la sintesi più recente, coerente col resto di `mergeDuplicate`. Il tool `save_memory` ora **richiede** `summary` (l'agente deve sintetizzare in poche parole cosa sta memorizzando, non solo scrivere il contenuto) — rifiutato se assente o oltre 72 caratteri. I 4 punti dove è il sistema stesso a scrivere in memoria (`goal.ts`, `agent.ts` ×2, `spawnAgent.ts`) ora passano una sintesi esplicita invece di affidarsi alla derivazione. Elenco TUI (`systemModals.ts`) e CLI (`cli/commands/memory.ts`) mostrano `summary` al posto dello slice di `content`, con una data assoluta `YYYY-MM-DD HH:MM` (nuovo `formatFactDate`) al posto del solo orario — la CLI aveva già la data giusta, solo la TUI ne mostrava metà. Suite `tests/test_memory_summary.ts` (15 test: sintesi esplicita/derivata, troncamento a 72 caratteri in entrambi i casi, merge su ripetizione, guarigione di un fatto legacy senza il campo, validazione del tool). |

| T14.21 | ✅ Fatto | **La Guarigione di T14.20 Riproduceva lo Stesso Bug su un Fatto Reale**: verificato subito contro un fatto vero — una traccia di reasoning salvata prima di T14.20 mostrava ancora `Reasoning trace complete (2381 chars) on "non mi pare d...` invece di una sintesi leggibile. Causa: la derivazione di fallback (prima riga, troncata a 72 caratteri) è generica, ma i 4 punti dove è il sistema stesso a scrivere in memoria (`goal.ts`, `agent.ts` ×2, `spawnAgent.ts`) producono un unico pointer su una riga sola, con la parte che distingue un fatto dall'altro (quale goal, quale task) sempre oltre il carattere 72 — esattamente il bug originale, solo con un taglio leggermente più largo. Questi formati sono stringhe fisse scritte dal nostro stesso codice, quindi `deriveSummary` (`core/memory.ts`) ora le riconosce per prime con un elenco di pattern noti (`[Goal] X:`, `[Compressed history]`, `Reasoning trace ... on "..."`, `[Subagent @X] Task: "..."`) e produce la stessa sintesi che quel fatto avrebbe avuto se `summary` fosse esistito fin dall'inizio; solo un contenuto libero non riconosciuto (tipico di un `save_memory` salvato prima che `summary` diventasse obbligatorio) ricade nel troncamento generico. +5 casi in `tests/test_memory_summary.ts` (MS10–MS14, uno per pattern noto più il fallback), 15 totali. |

| T14.22 | ✅ Fatto | **Un Tool Auto-Creato Poteva Dichiararsi SAFE e Fare Qualunque Cosa**: `create_tool` accettava il `riskLevel` dichiarato dall'agente stesso (default `SAFE`) e `checkPermission` ritorna `true` senza alcun prompt per tutto ciò che è SAFE — nessun controllo verificava mai che il codice generato corrispondesse al livello dichiarato. In più il modulo generato faceva `require('fs')` sul modulo Node reale: a differenza dei tool nativi (che passano tutti da `resolveSafePath`), un tool auto-creato aveva accesso pieno al filesystem, fuori dalla workspace jail. Un `fs.rmSync(args.path, {recursive:true, force:true})` dichiarato SAFE sarebbe stato scritto su disco, hot-registrato e poi eseguibile senza mai chiedere nulla all'utente. Tre correzioni: (1) `riskLevel` non è più un parametro — un tool generato è **sempre** RESTRICTED, l'utente approva ogni chiamata, perché l'autodichiarazione di chi ha scritto il codice non è una prova; (2) nuovo `src/tools/impl/jailedFs.ts`, wrapper di `fs` che passa ogni percorso da `resolveSafePath`, iniettato al posto del modulo reale sia nel file generato sia nella VM di validazione (il file su disco viene ricaricato con un `require()` normale a ogni avvio successivo — la sandbox VM valida la *forma* del codice una volta sola, non è un jail di esecuzione permanente); (3) blocklist estesa da 6 a 9 pattern: `constructor.constructor` (escape noto verso il Function constructor via prototype chain, che non contiene mai il testo `new Function`), `import()` dinamico (aggirava `require()`), e le API `process` distruttive (`kill`/`abort`/`binding`/`dlopen`). +8 casi in `tests/test_self_authoring.ts` (X4.6–X4.10, 17 totali). |

| T14.23 | ✅ Fatto | **Traduzione Integrale in Inglese — Schemi dei Tool & Regola**: chiusa la regola AGENTS.md #1 su schema dei tool e system prompt (vedi commit `fc4cce8`); tradotti 25 dei 28 `tools_schemas/*.json` (i restanti 3 erano già in inglese). I letterali enum del protocollo di coordinamento (`APPROVO`/`RIFIUTO`/`COMPLETATO`/`FALLITO`/`AGENTE:`/`FINE`/...) lasciati **deliberatamente** in italiano: sono token abbinati come stringhe letterali dal codice di parsing in `team.ts`/`goal.ts`/`strategies/*.ts` (`status === 'COMPLETATO'`, `vote === 'APPROVO'`, ecc.) — tradurli è un cambio di protocollo che tocca quel codice, non solo prosa, e resta fuori da questo task (vedi T14.25). Trovato in corsa un bug reale in `src/core/loop.ts`: `checkAcceptance` cercava un marker italiano che `executeCommandTool` non produce in nessuna lingua — un comando di verifica fallito non veniva mai rilevato; corretto e testato (`tests/test_loop.ts`). Corretti anche due riferimenti a intestazioni README ormai stale in `scripts/buildWiki.ts` dopo la compattazione del README (modifica dell'utente, concorrente a questo task) e rimosse le due pagine wiki TUI-Dashboard/Dashboard-TUI, la cui sezione sorgente è stata assorbita in una tabella e non esiste più come prosa estraibile. |

| T14.24 | 🔲 Da fare | **Traduzione Integrale in Inglese — Commenti in `tests/`**: ~9.800 righe su 65 file in `tests/` contengono ancora commenti, banner di log o messaggi di `check()` in italiano — un ordine di grandezza più grande degli schemi dei tool (T14.23). Già tradotti in questa sessione: `test_call.ts`, `mocks/mockCtx.ts`. Suddiviso in 7 lotti, vedi dettaglio sotto. |

| T14.25 | 🔲 Da fare | **Traduzione dei Token di Protocollo Multi-Agente**: `APPROVO`/`COMPLETATO`/`FALLITO`/`AGENTE: @nome`/`FINE` sono letterali italiani abbinati come stringhe esatte nel codice di parsing (`strategies/*.ts`, `goal.ts`), non solo negli schemi JSON. Cambio di protocollo, non traduzione di prosa — fuori scope di T14.23/T14.24, non iniziato. Vedi dettaglio sotto. |
| T15.1 | ✅ Completato | **Retrieval per modelli piccoli**: prefix-match sui token, stop-words e scoring a coverage ratio in `search()`. Guard: `test_memory.ts` (M1b/M1c) e `test_memory_phase3.ts` (T8.3) verdi **senza modifiche**. |
| T15.2 | ✅ Completato | **Decadimento temporale nell'eviction**: half-life per kind in `evictionScore`/`rankByRetentionValue` (solo fatti non-pinned; il touch di `search()` rigenera il decay). Guard: Gruppi D/E di `test_memory_dedup.ts`, M1c. |
| T15.3 | ✅ Completato | **`save_memory`: summary opzionale**: fallback su `deriveSummary`, cap 72 a valle se fornito, parametro `kind` opzionale validato; schema tradotto in inglese (era rimasto italiano). **Aggiorna l'asserzione MS15** (certificava proprio la policy che si toglie). |
| T15.4 | ✅ Completato | **Tag automatici dal contenuto**: `addFact` deriva top-K token significativi quando `tags` non è fornito. Verificato: nessun test asserisce `tags === undefined`. |
| T15.5 | ✅ Completato | **Quota per kind nell'eviction**: cap sul `run` (30% di `maxFacts`) applicato **solo in overflow** del totale — mai sacrifica fatti se lo store non è pieno. Guard: M1c. |
| T15.6 | ✅ Completato | **Persistenza robusta**: scrittura atomica (tmp + rename) in `save()` e backup del file corrotto (`memory.json.corrupt-<ts>`) con warning `logSink` in `load()` — niente reset silenzioso. Nuova suite `test_memory_persistence.ts`. |
| T15.7 | ✅ Completato | **Tool `update_memory`/`forget_memory`** (SAFE): impl + schemi inglesi, `MemoryStore.updateFact(id, patch)`; aggiunta ai ruoli che già elencano `save_memory` + `AMBIENT_TOOLS` in `goalPrompts.ts`; metriche e conteggi aggiornati (README/it, AGENTS.md, docs). Nuova suite. |
| T15.8 | ✅ Completato | **Iniezione prompt con badge di tipo** (`[LESSON]`/`[DECISION]`/`[FACT]`/`[RUN]`) + data compatta in `formatForPrompt`/`formatRelevant`. Default `memoryMaxChars` **invariato (600)** per non toccare T8.3-CFG-*. Aggiorna docs/memory.md §7/§9. |
| T16.1 | 🔲 Da fare | **Trappole a difficoltà graduata**: 3 nuovi fixture `benchmarks/` (`40_instruction_vincoli`, `41_json_esca`, `42_tool_catena3`) con vincoli interagenti+distrattore, campo esca JSON e catena a 3+ hop con risultato intermedio corrotto; peso > 1 sui test difficili per aprire lo score. I 7 fixture esistenti restano intatti. |
| T16.2 | 🔲 Da fare | **`/benchmark --deep` (repliche + variazione prompt)**: campo `repeats` + varianti di wording del prompt tra le repliche; score a mediana robusta + varianza; il percorso fast resta 1 colpo/test. Risultati deep in un campo separato del profilo (non invalidano il tier fast). |
| T16.3 | 🔲 Da fare | **Check simmetrici per step**: `tool_not_called` con `value` = nome tool distrattore (ora risolve solo "zero chiamate"); distrattori espliciti su ogni step di `30_tool_catena`/`31_tool_trappola`. |
| T16.4 | 🔲 Da fare | **Soglie calibrate**: soglie tier (`computeTier`) configurabili da `tsuka.config.json` con default invariati; la calibrazione usa `--deep` su un modello debole noto vs. frontier in docs. |
| T17.1 | ✅ Fatto | **Retrieval BM25/TF-IDF** (livello 3 migliorato): `search()` sostituisce `matches × 1000 + coverage-boost` con BM25 (`k1=1.2`, `b=0.75`), zero dipendenze; IDF calcolata per query sui fatti visibili; conservati stemming, stop-word e `tokenMatches` (exact + prefix in avanti), quindi il guard T6.1a resta valido. **Bug trovato in revisione**: il loop della document frequency passava la `Map` invece delle sue chiavi (`matchesAny(qt, d.freqs)`), e iterare una Map produce coppie `[token, count]` — il confronto era stringa-contro-array, sempre falso. Risultato: `n` sempre 0 e **IDF identica per ogni token**, cioè la ponderazione per cui esiste BM25 era disattivata, mentre il loop di scoring destrutturava correttamente e teneva viva la TF (per questo tutte le suite restavano verdi). Era anche un errore di tipo: `npm run build` e `npm run typecheck` fallivano. Corretto con `d.freqs.keys()`. Nuova suite `tests/test_memory_bm25.ts` (8 test): R1/R2 sono i guard di regressione — verificato che falliscono sul codice rotto e passano sul fix; R3 saturazione/lunghezza, R4 stop-word, R5 prefix, R6 nessun match spurio, R7 determinismo. Docs §5/§12 e tabella `recall_memory` allineate in EN+IT (il §12 elencava ancora BM25 fra i lavori *futuri*). |

| T18.1 | ✅ Fatto | **Esecuzione Graduata: Classificare il Comando, non il Tool**: `execute_command` era DANGEROUS come capacità, quindi ogni invocazione costava una conferma interattiva piena — e la conseguenza pratica era che nessun ruolo autonomo poteva averlo: `developer` non lo aveva affatto in `allowedTools` (1 ruolo su 21, solo `sysadmin`), cioè scriveva codice senza poter lanciare né test né build. Nuovo `src/safety/commandRisk.ts`: la capacità resta DANGEROUS, la *singola chiamata* viene graduata (`git status` → SAFE, `npm test` → RESTRICTED, ignoto → DANGEROUS). RESTRICTED ha già "approva per la sessione", quindi il ciclo di debug costa una conferma invece di una per iterazione. Nuovo hook opzionale `Tool.classifyRisk(args)` nel registry, con fallback al `riskLevel` statico se assente, malformato o se lancia. Corretto anche un buco preesistente: `spawn` non impostava `cwd`, quindi la shell ereditava la directory del processo harness mentre i tool file erano confinati da `resolveSafePath` — ora parte da `getWorkspaceRoot()`. `developer` ha ora `execute_command` (differito, non in `coreTools`). Suite `tests/test_command_risk.ts` (25 test, di cui 8 di bypass). |
Tutti i task pianificati e di backlog sono completati; la serie T15 (memoria, modelli <30B) è implementata e chiusa con 72 suite di test verdi. Pianificata la serie **T16 (benchmark significativi)** su architettura a due velocità: **`/benchmark` fast** (1 colpo/test, deterministico — resta il gate del tier) e **`/benchmark --deep`** (repliche con variazione del prompt, mediana+varianza, per validazione/calibrazione). Pianificato anche **T17.1** (retrieval BM25/TF-IDF), il primo livello del percorso di apprendimento documentato in `docs/memory.md` §12. Valore di ritorno — i benchmark attuali saturano in alto e non discriminano tra i modelli, ma il gating dei tool (`registry.ts`) dipende proprio da quel tier: se tutto diventa `large` il gating è codice morto. Restano da fare T14.24 (commenti tests/ in inglese), T14.25 (token di protocollo multi-agente) e le serie T16/T17.

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
| T7.2 | ✅ Fatto | Comando CLI `tsuka init [--preset core\|full] [--pack <nome,...>] [--force]` in `src/cli/initCmd.ts`, gestito in `index.ts` prima del REPL. Creazione della struttura `.tsuka/{memory,workflow_logs,output,roles,traits,characters,teams}`, copia asset dai manifest preset/pack, discovery dei server LLM locali e scrittura di `config.json`. Risoluzione gerarchica in `src/core/apphome.ts` (`homePath` predilige `.tsuka/` della workspace). Test `tests/test_init.ts` (12 check: init pulito, re-init senza `--force` bloccato, `--force` abilitato, `--pack osint`). 41 suite test OK e TypeScript strict verificato. |

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
| T8.11 | ✅ Fatto | Secondo timer `MAX_GENERATION_MS` (300s, costante accanto a `FIRST_TOKEN_TIMEOUT_MS`, deliberatamente fuori da `config.ts`), armato insieme al primo ma **mai azzerato all'arrivo del primo token**, riusa `attemptAbort`. Errore distinto `[Timeout generazione]` invece di `[Mancata risposta]`: dichiara che il modello *stava* rispondendo, altrimenti si diagnostica il problema sbagliato. **Interpretazione dichiarata dall'agente:** un timeout di generazione **non** fa retry (ripetere un tentativo che ha già occupato 300s raddoppierebbe l'attesa in silenzio); la logica di retry esistente sul primo token resta intatta e il nuovo ramo è indipendente. `max_tokens: 8192` aggiunto come tetto vero, non tarabile. Soglia iniettabile **solo nei test** via `__setMaxGenerationMsForTest`, per test deterministici da 100-300ms invece di 5 minuti. `tests/test_generation_timeout.ts` (13 check), inclusa la verifica che i timer siano sempre ripuliti via `process.getActiveResourcesInfo()`. Sabotaggio del `clearTimeout` nel `finally` → 2 FAIL. Commit `4cbf068`. |
| T8.12 | ✅ Fatto | `getModelTier(modelName, effort?)` propaga l'effort a `getModelProfile` invece di ricadere sempre su `@xhigh`; `listForLLM(modelName, allowedTools?, effort?)` lo inoltra; `Agent.run()` passa l'effort già risolto a ogni round del ciclo — è il punto che decide davvero quali tool sono eseguibili. **Effetto: un `/benchmark` ora serve**, un modello misurato a un livello e girato a quel livello riceve il tier misurato e non l'euristica del nome. `loadSystemPrompt`/`notifyIfUnprofiled` guadagnano `effort?` in coda, backward-compatible. `test_fingerprinting.ts` (+4) e `test_reasoning_effort.ts` (+3, catena end-to-end tier→tool) estesi, nuova `tests/test_effort_propagation.ts` (18 check). Sabotaggio → 8+2+2 FAIL mirati. **Coda aperta:** i chiamanti reali (`index.ts`, `call.ts`, `common.ts`, `hybrid.ts`, `spawnAgent.ts`) non passano ancora l'effort a `loadSystemPrompt`; il default prudente `'xhigh'` rende la cosa sicura — capacità non sfruttata, non rottura. Commit `b934151`. |
| T8.13 | ✅ Fatto | `reasoningEffort` opzionale negli argomenti di `spawn_agent` (enum `none\|low\|medium\|xhigh`), validato e normalizzato (trim + lowercase) prima di toccare provider e registry, con lo stesso stile del controllo di lunghezza del `task` già presente; passato come `reasoningEffortOverride` a `subAgent.run()`. È il livello "chiamante" della cascata, prima irraggiungibile. **Verifica invece di assunzione:** l'agente ha accertato leggendo `agent.ts` che `spawnAgent.ts` non passava — né passa ora — un effort di costruzione all'`Agent` del figlio, quindi omettendo l'override il comportamento resta identico a prima; nessuna cascata introdotta dove non esisteva. Schema con guida esplicita su quando abbassare (compiti meccanici). `tests/test_spawn_agent_reasoning_effort.ts` (21 check, incluso il payload reale dell'SDK). Sabotaggio → 6 FAIL. Commit `4cbf068`. |
| T8.14 | ✅ Fatto (con una coda, vedi sotto) | Pin globale in `src/core/effortControl.ts`, stato di processo mai scritto in `tsuka.config.json`: `withEffortPin(cascaded)` si applica **sopra** la cascata di T8.10 (mai riscritta) nei 3 punti che già la invocano — `cli/index.ts` (`recreateAgent`), `strategies/common.ts` (`runMemberTurn`, quindi tutte e 4 le modalità `/team` più `/goal`) e `tools/impl/spawnAgent.ts`, dove il pin vince anche sull'override esplicito del chiamante di T8.13. Comando `/effort`: senza argomenti mostra livello attivo, **provenienza** e tier di tool conseguente; `<livello>` fissa il pin; `auto` lo rimuove; `ask` alterna la modalità di conferma. Impostare o togliere il pin ricrea l'agente e **confronta il set di tool prima/dopo** (`describeToolDiff`), annunciando quanti e quali cambiano — è l'effetto collaterale di T8.12 che il task chiedeva di non nascondere. Modalità `ask`: **log-only** in `/team`, `/goal` e figli di `spawn_agent`, mai un prompt; il vincolo è verificato in modo attivo mockando `InteractiveMenu.select` perché lanci se venisse mai chiamata — sabotando il routing, il test muore all'istante invece di passare in silenzio. `tests/test_effort_command.ts` (59 check), inclusa la non persistenza provata sia sui byte di `tsuka.config.json` sia su un processo figlio fresco. Sabotaggio di `withEffortPin` → 7 FAIL mirati. `npm test` 38 suite OK, 0 fallite, verificato due volte. Commit `f2ba6b8`. **Coda aperta, causata da un difetto della specifica (non dell'esecuzione):** il task definiva la divergenza come «effort effettivo ≠ livello di riferimento (pin, o default di config)». Con un pin attivo l'effettivo **è** il pin per costruzione, quindi la segnalazione non compare mai proprio nel caso in cui servirebbe di più — quando il pin sta sovrascrivendo il livello che ruolo o personaggio avrebbero chiesto. Il confronto giusto è **pin contro ciò che la cascata avrebbe prodotto**. Vedi T8.15. |
| T8.15 | ✅ Fatto | Aggiornata `confirmEffortDivergence` in `src/core/effortControl.ts`: quando un pin manuale è attivo (`activePin !== null`), l'effort effettivo del turno viene confrontato rispetto al pin stesso (intento esplicito dell'utente). Se l'effort eseguito coincide col pin (es. `low`), ritorna `effective` senza chiedere alcuna conferma o emettere divergenza (`diverged: false`). Nuovo scenario di test in `tests/test_effort_propagation.ts` (20 check OK). 41 suite test verdi e TypeScript strict OK. |
| T8.16 | ✅ Fatto | Configurazione `llmTimeoutMs` in `src/core/config.ts` (`getLlmTimeoutMs`), funzione `setLlmTimeoutMs` in `src/core/provider.ts` invocata all'avvio in `src/cli/index.ts`. Timeout a orologio combinato per l'intera generazione LLM per prevenire stalli indefiniti. Test `GT.5a` e `GT.5b` in `tests/test_generation_timeout.ts` (15 check OK). 41 suite test verdi ed assenza di errori TS. |
| T8.17 | ✅ Fatto | Estensione `ChatOptions` ed inoltro parametri di campionamento numerici (`temperature`, `top_p`, `presence_penalty`, `frequency_penalty`) all'SDK OpenAI in `src/core/provider.ts`. Preset umani leggibili (`creativity`: `'precise'` \| `'balanced'` \| `'creative'`) con risoluzione in `resolveSamplingParams`. Attribuzione del campo `creativity` nei ruoli e personaggi (`roles/*.json`, `characters/*.json`, `resolveCreativity` in `src/cli/shared.ts`). Nuova suite `tests/test_sampling_params.ts` (15 check OK). 42 suite test verdi ed assenza di errori TS. |
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
- Aggiungere `max_tokens` alla richiesta come **soglia**, generosa (~8k), non un valore
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
  corretta: `max_tokens` generoso come soglia (~8k, mai raggiunto in condizioni normali —
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

Sostituire l'attuale funzione Regex in [`src/tools/impl/browseUrl.ts`](src/tools/impl/browseUrl.ts) con una libreria avanzata di parsing HTML e content extraction (`node-html-markdown`).

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

---

## T14.3 — Workspace File Viewer Modal (Anteprima Rapida File)

**Dipende da:** T14.1, T14.2 · **Sforzo:** basso · **Priorità:** media

Permettere l'anteprima e l'ispezione immediata del contenuto di qualsiasi file all'interno del workspace selezionandolo nel pannello `Files Explorer` e premendo `Enter` (o doppio clic mouse):

- Implementare `FileViewerModal` (`src/tui/modals/fileViewerModal.ts`):
  - Lettura sicura del file confinata nel workspace tramite `resolveSafePath`.
  - Visualizzazione con numeri di riga formattati, box ANSI pulito, indicatore di dimensione e totale righe.
  - Supporto navigazione e scrolling: `▲`/`▼`, `PageUp`/`PageDown`, `Home`/`End`, rotellina del mouse e tasto `Esc` / `Enter` per chiusura rapida.
- Integrare l'attivazione in `src/tui/views/Files.ts` e `src/tui/app.ts` / `src/tui/modals/keyHandler.ts`.

**Accettazione:** Premendo `Enter` su un file selezionato nel Files Explorer si apre la modale di visualizzazione con contenuto e numeri di riga corretti; premendo `Esc` si chiude all'istante tornando alla vista precedente.

---

## T14.4 — Session Export to Markdown (`/export` Command)

**Dipende da:** T14.1 · **Sforzo:** basso · **Priorità:** media

Aggiungere il comando `/export [filename]` (e alias `/save`) nella TUI per esportare l'intera cronologia di chat attiva, i blocchi di reasoning/CoT e le chiamate tool in un file Markdown pulito:

- Implementare il comando `/export` in `src/tui/controllers/commandController.ts`:
  - Se non viene fornito un argomento, genera un nome file con timestamp in `exports/session-YYYY-MM-DD-HHmmss.md`.
  - Genera un documento Markdown completo con:
    - Header e metadati (Agente, Modello, Timestamp, Token totali, Turni).
    - Messaggi utente e risposte dell'assistente formattati.
    - Blocchi di pensiero racchiusi in tag collassabili `<details><summary>💭 Chain of Thought (N tokens)</summary>...</details>`.
    - Dettagli delle chiamate ai tool con argomenti ed output formattati in blocchi di codice.
  - Salva il file su disco assicurandosi che la cartella `exports/` esista.
  - Emette una notifica toast nella TUI con il percorso del file salvato.

**Accettazione:** Digitando `/export` viene creato un file `.md` valido e leggibile contenente tutti i messaggi della sessione, con notifica visiva nella TUI. Suite di test aggiornata.

---

## T14.5 — Multi-line Input Prompt & Paste Preservation

**Dipende da:** T14.1 · **Sforzo:** basso · **Priorità:** media

Supportare la composizione di prompt complessi e blocchi di codice su più righe all'interno del box di input della TUI, senza invii prematuri del messaggio durante l'incollamento o la formattazione:

- **Inserimento Nuova Riga**:
  - `Shift+Enter` o `Ctrl+J` / `Alt+Enter`: inserisce un carattere `\n` nella posizione corrente del cursore nel buffer di input (`inputText`), senza committare il turno.
  - `Enter` standard: committa il prompt multiline per l'esecuzione da parte dell'agente.
- **Preservazione del Paste Multi-linea**:
  - Quando l'utente incolla testo contenente interruzioni di riga (`\r\n` o `\n`), il parser di input aggrega i frammenti preservando la formattazione senza scatenare invii a raffica.
- **Rendering & Navigazione Cursore 2D**:
  - Aggiornare `InputView.render` per visualizzare le righe multiple con scroll verticale interno quando il testo supera l'altezza disponibile del box.
  - Navigazione con frecce `▲`/`▼` su righe diverse quando l'input è multilinea, riservando la cronologia ai limiti superiore/inferiore del buffer.

**Accettazione:** Incollando o digitando con `Shift+Enter`/`Ctrl+J` più righe di testo nel box di input, il prompt rimane intero su più righe e viene inviato solo alla pressione di `Enter`; suite di test automatizzata.

---

## T14.6 — Interactive Tools Search & History Filter

**Dipende da:** T14.1 · **Sforzo:** basso · **Priorità:** media

Introdurre una barra di ricerca e filtraggio in tempo reale nella vista `Tools Inspector` (`F2` / `/tools`) per individuare all'istante tool specifici tra i 27 nativi e tracciare esecuzioni passate:

- **Filtro Dinamico Live**:
  - Possibilità di digitare una query di ricerca (es. premendo `/` o digitando nel campo filtro della vista `ToolsView`).
  - Filtraggio in tempo reale per:
    - **Nome Tool**: es. `grep`, `file`, `browse`, `command`.
    - **Tier di Rischio**: `SAFE`, `RESTRICTED`, `DANGEROUS`.
    - **Stato Esecuzione**: `running`, `completed`, `failed`.
- **Navigazione & Reset**:
  - `Esc`: cancella il filtro attivo o chiude la ricerca.
  - Scorciatoie e badge visivi dei risultati trovati (`Trovati: N/27 tool`).

**Accettazione:** Nella vista F2, impostando una query di ricerca, l'elenco dei tool e lo storico delle esecuzioni si restringono istantaneamente alle sole voci corrispondenti; suite di test aggiornata.

---

## T14.7 — Real-Time Inference Telemetry & Latent Space Inspector Widget

**Dipende da:** T14.1, T14.2 · **Sforzo:** basso · **Priorità:** alta

Integrare un micro-widget autonomo (`InferenceTelemetryWidget.ts`) nella sidebar della TUI (posizionato tra Agent Profile e Files Explorer o integrato nei widget modulari) per eliminare i momenti di "attesa cieca" durante l'inferenza di llama.cpp/Ollama:

- **Stati di Inferenza & Telemetria Live**:
  - `IDLE`: `● IDLE` (pronto).
  - `PREFILL (KV Cache Ingestion)`: Monitoraggio visivo dei secondi di elaborazione del prompt (`⚡ PREFILL: N tok @ X t/s`) prima dell'emissione dei token.
  - `DECODE (Streaming)`: Monitoraggio della velocità di generazione in tempo reale (`🌊 DECODING: X tok/s`).
  - `TTFT (Time to First Token)`: Misurazione in millisecondi del tempo trascorso tra invio del prompt e primo token emesso.
- **Ispezione Spazio Latente & Top Candidati (`logprobs`)**:
  - Quando disponibile o calcolabile dal backend, visualizzazione della barra di confidenza percentuale e delle alternative probabilistiche valutate nello spazio dei logits.
- **Integrazione UI Reattiva**:
  - Registrato nello store Flux (`TuiStore`), aggiornato tramite eventi stream ad alta frequenza e renderizzato nel flusso sidebar.

**Accettazione:** Durante l'esecuzione di un prompt, il widget nella sidebar mostra in tempo reale la transizione di stato (`PREFILL` $\to$ `DECODE`), la velocità e il TTFT senza blocchi o sfarfallii; suite di test automatizzata.










---

## T14.9 — Telemetria di Inferenza Reale (Rimozione Metriche Sintetiche)

**Dipende da:** T14.7, T14.8 · **Sforzo:** medio · **Priorità:** alta

Il widget `InferenceTelemetryWidget` introdotto in T14.7 mostra tre valori che **non provengono
dal backend**: la barra `Conf` è calcolata come `85 + (chunkCount % 14)`, la riga `Logits:` non
viene mai popolata (`topCandidates` non è scritto da nessuna parte) e `tokensPerSec` conta i
*chunk* dello stream divisi per il tempo trascorso **dall'inizio del turno**, quindi include il
prefill e sottostima la velocità di decode. In un progetto didattico una metrica inventata
presentata come lettura dello spazio latente insegna una cosa falsa: va sostituita con dati
misurati o rimossa.

- **Canale di telemetria dal provider** (`src/core/provider.ts`):
  - Introdurre un sink globale opzionale (`setInferenceTelemetrySink`), stesso pattern già usato
    per `setTimeoutPromptHandler` / `setLogSink`: il core non stampa e non conosce la TUI, si
    limita a emettere eventi (`first_token`, `decode`, `complete`).
  - Misurare il **TTFT reale** dall'inizio del tentativo corrente (non dal primo turno, così un
    retry non falsa la misura) e la **finestra di decode** separata dal prefill.
  - Contare i token generati da `logprobs.content` quando disponibile, con fallback a un delta
    per chunk; il totale esatto resta `usage.completion_tokens`.
- **Logprobs reali & opt-in** (`inferenceLogprobs` in `tsuka.config.json`, default `false`):
  - Quando attivo, la richiesta include `logprobs: true` / `top_logprobs: 3`; confidenza e top
    candidati derivano da `Math.exp(logprob)` del token effettivamente emesso.
  - Se il backend rifiuta il parametro, disattivazione automatica per la sessione con log
    visibile (mai degradazione silenziosa) e ritentativo della richiesta senza `logprobs`.
  - Se i logprobs non ci sono, il widget **non mostra** barra di confidenza né riga logits.
- **Statistiche onestamente definite** (`ChatStats`, `src/core/agent.ts`):
  - `tokensPerSecond` = token generati / finestra di **decode** (esclude il prefill).
  - Nuovi campi `ttftMs`, `decodeMs`, `prefillTokensPerSecond` (= `promptTokens / TTFT`, cioè la
    velocità di ingestione del prompt misurata lato client); aggregazione multi-round in `Agent`
    coerente (somma delle finestre di decode, TTFT del primo round).
- **UI** (`src/tui/bridge.ts`, `src/tui/widgets/InferenceTelemetryWidget.ts`):
  - Rimozione totale dei valori sintetici; il bridge non fabbrica più numeri, si limita a
    inoltrare allo store ciò che il provider misura.
  - In fase di prefill il conteggio token è marcato come stima (`~N tok est.`) perché prima della
    risposta il numero esatto non esiste; diventa esatto quando arriva `usage.prompt_tokens`.

**Accettazione:** nessun valore mostrato dal widget è calcolato senza un dato reale del backend;
con `inferenceLogprobs: false` (default) barra di confidenza e riga logits non compaiono; con il
flag attivo su un backend che espone `logprobs` mostrano probabilità reali. Suite di test
aggiornata.

---

## T14.10 — Il Tasto `?` Deve Poter Essere Digitato nel Prompt

**Dipende da:** T14.1 · **Sforzo:** basso · **Priorità:** alta

Nella TUI il tasto `?` è intercettato come scorciatoia globale per l'help (`src/tui/app.ts`)
**prima** dello smistamento per pannello attivo: digitando una domanda nel box di input si apre
la cheatsheet invece di inserire il carattere, rendendo impossibile scrivere un prompt
interrogativo.

- L'help resta su un tasto funzione dedicato: `F12` (globale, sempre attivo, già presente).
- `?` apre l'help **solo** quando il focus non è sull'input e nessuna modale è aperta (comodo
  scorrendo la chat o i tool), altrimenti è un normale carattere digitabile.
- Aggiornare le etichette della UI che pubblicizzano `?` come scorciatoia (`Header.ts`) in `F12`,
  coerentemente con `QuickKeysWidget` che già indica `F12`.

**Accettazione:** con il focus sull'input, digitando `Come faccio X?` il carattere `?` finisce nel
buffer e nessuna modale si apre; premendo `F12` (da qualsiasi focus) o `?` con focus su chat/tool
la cheatsheet si apre come prima. Suite di test aggiornata.

---

## T14.11 — Dispatch Data-Driven della TUI (Leggibilità)

**Dipende da:** T14.1, T14.2 · **Sforzo:** medio · **Priorità:** alta

Tre punti della TUI erano cresciuti come catene di condizioni, cioè come comportamento
travestito da controllo di flusso. Il rimedio è lo stesso già adottato per il layout engine
(`tui.layout.json`) e per i tasti (`keybindings.json`): **una tabella di dati e una funzione
che la percorre**.

- **Comandi slash** (`src/tui/commands/`):
  - `TuiCommandController.handleCommand` era un metodo unico da 569 righe con 26 rami `if`, con
    gli alias (`/save`, `/kill`, `/model`, `/h`, `/?`) nascosti dentro le condizioni.
  - Nuova tabella `TUI_COMMANDS`: ogni voce dichiara `name`, `aliases`, `description`, `hidden`
    e il proprio handler; i comandi sono raggruppati per dominio in `sessionCommands.ts`,
    `workflowCommands.ts`, `configCommands.ts`.
  - Il controller resta un dispatcher: `parseCommandLine` → `findCommand` → `run`.
  - I quattro workflow CLI (`/goal`, `/team`, `/call`, `/benchmark`) condividevano lo stesso
    blocco copiato quattro volte (echo del prompt, stato generating, try/catch/finally): ora è
    `runCliWorkflow` e ogni comando fornisce solo i propri dati.
  - `assertMenuCoverage()` verifica che menu slash (`commands/menu.json`) e handler coincidano:
    nessuna voce di menu senza comando, nessun comando visibile fuori dal menu.
  - Rinominato `src/tui/commands.json` in `src/tui/commands/menu.json`: con la cartella
    `commands/` accanto, Node risolveva `./commands` sul JSON invece che sull'indice.
- **Navigazione** (`src/tui/navigation.ts`):
  - `TUI_TABS` descrive ogni scheda una volta sola: tasto funzione, etichette per le tre fasce di
    larghezza, descrizione per la cheatsheet, modale associata.
  - Da lì derivano: la riga di tab dell'header (prima tre array duplicati in `Header.ts`), le zone
    di click del mouse (prima intervalli di colonne scritti a mano, `mouse.col >= 95 && <= 106`,
    che si disallineavano ad ogni rinomina di etichetta) e l'elenco tasti della cheatsheet (prima
    scritto a mano e già incompleto: mancavano `F7` e `F12`).
  - `activateTab` è l'unico punto che apre schede e modali, condiviso tra tastiera e mouse.
- **Modali** (`src/tui/views/Modal.ts`): `renderOverlay` (162 righe) diventa una mappa
  `BOX_BUILDERS` per tipo di modale più una funzione di composizione condivisa; la duplicazione
  della centratura sullo schermo (presente due volte) sparisce.
- **Bridge** (`src/tui/bridge.ts`): lo `switch` da 140 righe su `AgentEvent` diventa una tabella
  di handler tipizzata sull'unione (`{ [K in AgentEvent['type']]: … }`, quindi un evento nuovo
  non può essere dimenticato); estratti `backToThinking()` e `patchCurrentToolCalls()`, che erano
  ripetuti rispettivamente quattro e due volte.

**Accettazione:** nessuna modifica di comportamento osservabile; aggiungere un comando o una
scheda richiede una riga in una tabella e nessun tocco al dispatcher. Suite
`tests/test_tui_data_driven.ts` (10 test: alias, parsing, coerenza menu/handler, zone di click
allineate a ciò che l'header disegna, export Markdown). 63/63 suite verdi.

---

## T14.12 — Navigazione delle Directory nel Files Explorer

**Dipende da:** T14.1, T14.3 · **Sforzo:** basso · **Priorità:** alta

Il pannello `Files Explorer` mostrava solo il livello corrente: `Enter` su una cartella si
limitava a notificare "'nome' is a directory" e non esisteva alcun modo di entrarci o di
risalire. L'esplorazione diventa iterativa, con la jail del workspace come unico confine.

- **Navigazione** (`src/tui/fileExplorer.ts`, funzioni pure su un percorso relativo alla root):
  - `→` entra nella cartella selezionata, `←` risale di un livello (all'arrivo alla root la
    pressione successiva è un no-op notificato, non un'uscita dal workspace).
  - `Enter` è contestuale: su una cartella entra, su un file apre il File Viewer (T14.3).
  - Voce `.. (up)` come prima riga quando non si è alla root, così l'azione è raggiungibile
    anche con il mouse.
  - Ogni risoluzione passa da `resolveSafePath`: un percorso che uscirebbe dalla workspace
    lascia la posizione invariata invece di seguire il link (`..`, `../../..`, path assoluti).
  - Entrare in un file o in una cartella inesistente non cambia la posizione.
- **Stato e vista**: nuovo campo `filesCwd` in `TuiState` (`''` = root). Il titolo del pannello
  fa da breadcrumb (`📁 src/tui (12)`); l'elenco viene letto al render, quindi i file creati o
  cancellati durante la navigazione compaiono senza refresh esplicito.
- **Percorsi coerenti**: `i` / `Space` e il click inseriscono nel prompt il percorso completo
  relativo alla root (`src/tui/app.ts`), non più il solo nome del file, che dentro una
  sottocartella era inutilizzabile dagli agenti.
- **Mouse**: primo clic seleziona, secondo clic agisce (entra nella cartella o apre l'anteprima),
  coerentemente con il comportamento già esistente sui file.
- **Cheatsheet** (`F12`): aggiunte le righe `→ / ←` e `Enter` per il pannello file.

**Accettazione:** con il focus sul Files Explorer, `→` (o `Enter`) su una cartella ne mostra il
contenuto, `←` torna al livello superiore, `Enter` su un file apre l'anteprima; nessuna sequenza
di tasti permette di uscire dalla workspace. Suite `tests/test_files_explorer.ts` (8 test su
albero temporaneo isolato con `withWorkspaceOverride`).

---

## T14.13 — Wiki GitHub Generato dalla Documentazione

**Dipende da:** T14.11 · **Sforzo:** basso · **Priorità:** media

Il wiki di GitHub vive in un repository separato (`<repo>.wiki.git`) che nessun test del progetto
può controllare: copiarci dentro `docs/` significherebbe creare una seconda fonte di verità
destinata a divergere al primo task. Le pagine vengono quindi **derivate**, mai scritte a mano.

- **Generatore** (`scripts/buildWiki.ts`, `npm run wiki:build -- --out ../tsuka.wiki [--push]`):
  - Tabella `PAGES` (una riga per pagina: nome, titolo, lingua, controparte nell'altra lingua,
    sintesi, sorgente) con tre tipi di sorgente: documento intero di `docs/`, sezioni selezionate
    di un README, contenuto generato.
  - Riscrittura dei link, indispensabile perché il wiki sta in un altro repository: i rimandi tra
    documenti diventano pagine wiki (`docs/multi-agent.md` → `Multi-Agent-Workflows`), tutto ciò
    che punta al codice diventa un URL assoluto `blob/main`, link esterni e ancore restano intatti.
    Recupera anche gli eventuali `file:///…/harness/…` lasciati da un editor.
  - Pagine generate: `Home` (indice bilingue dalla tabella), `_Sidebar.md`, `_Footer.md` (versione
    da `package.json`) e `Slash-Commands`, costruita da `TUI_COMMANDS`: comandi, alias e
    descrizioni non possono disallinearsi dal software.
  - Intestazione automatica su ogni pagina con lo switch di lingua e il link al file sorgente
    ("edit that file in the repository, not this page").
- **Pubblicazione** (`.github/workflows/wiki.yml`): su push a `main` che tocchi `docs/`, i README,
  `src/tui/commands/` o il generatore, clona il wiki con `GITHUB_TOKEN`, rigenera e committa solo
  se qualcosa è cambiato. La **prima pagina va creata a mano dal browser**: GitHub crea il
  repository del wiki solo in quel momento e nessuna API lo fa al posto tuo.
- **Contorno**: `tsconfig.check.json` + `npm run typecheck` (con step in CI) perché `npm run build`
  compila solo `src/` e `scripts/` sarebbe rimasto senza alcun controllo di tipi; corretti 4 link
  `file:///f:/progetti_ai/harness/…` in `docs/architecture-it.md`, `docs/multi-agent-it.md` e
  `TASKS.md`, rotti per chiunque non fosse su quella macchina.

**Accettazione:** `npm run wiki:build` produce 18 file pubblicabili senza un solo link relativo al
repository; rigenerare due volte dà lo stesso risultato. Suite `tests/test_wiki_build.ts` (9 test
su riscrittura dei link, estrazione delle sezioni, pagine prodotte e derivazione dei comandi).
---

## T14.14 — Schemi dei Tool Differiti (`coreTools` + `load_tools`)

**Dipende da:** T8.9 · **Sforzo:** medio · **Priorità:** alta

Il costo fisso del prompt è quasi tutto negli schemi dei tool, e viene ripagato a **ogni round**
del loop ReAct, non una volta per turno. Misurato sul ruolo `developer`: ~4.3k token di prefisso,
di cui ~3.8k di soli schemi (89%). Il `systemPrompt` del ruolo pesa 58 token, il tratto 32: lì non
c'era niente da spremere. Con `maxToolRounds: 25` quegli schemi possono valere ~96k token di
prefill per singolo turno utente.

- **Ripartizione dichiarata dal ruolo** (`src/core/toolSet.ts`, `resolveToolSet`): un ruolo può
  elencare `coreTools`, il sottoinsieme di `allowedTools` il cui schema completo viaggia sempre.
  Il resto diventa **differito**: nel system prompt compare solo il nome. Un ruolo *senza*
  `coreTools` si comporta esattamente come prima — la modifica è opt-in, ruolo per ruolo, e il
  flag `deferredToolsEnabled` (default `true`) la disattiva ovunque in un colpo solo.
- **Attivazione a runtime** (`load_tools`, `src/tools/impl/loadTools.ts`): il modello chiede i tool
  che gli servono e dal round successivo ne riceve lo schema completo. L'Agent implementa
  `ToolSetController` (`registry.ts`) e riceve la propria vista sul tool set dentro
  `ToolExecutionContext`: il registry resta condiviso e non conosce l'Agent concreto.
- **Il perimetro non si allarga mai**: si può attivare soltanto ciò che `allowedTools` già
  consentiva. Un `coreTools` che nomina un tool non autorizzato non lo concede, e
  `Agent.activateTools` rifiuta qualunque nome non dichiarato differito.
- **Tool di contesto sempre attivi** (`alwaysActive`): protocollo di coordinamento (`report_status`),
  blackboard (`post_note`, `read_notes`) e memoria dei sub-agenti non sono mai differiti — chiedere
  al modello di *caricare* un tool che gli stiamo ordinando di chiamare sarebbe un giro a vuoto.
- **Elenco testuale senza descrizioni** (`shared.ts`): per i modelli senza function calling nativo
  misurato, T8.9 aveva già reso condizionale la sezione "Available tools", ma quando veniva scritta
  ripeteva nome **e** descrizione di ogni tool — le stesse descrizioni che viaggiano comunque
  nell'array `tools` della richiesta. Ora è un elenco di soli nomi: 1.111 token in meno per
  `developer`, su ogni round, per i modelli non profilati.
- **Bug corretto**: `request_goal.json`, `request_team.json` e `request_call.json` usavano la chiave
  `"schema"` invece di `"parameters"`. `loadToolSchema` non la leggeva e ripiegava su un oggetto
  vuoto: il modello vedeva quei tre tool **senza parametri** e doveva indovinarne i nomi, mentre
  `validateToolArgs` non aveva nulla da validare. Chiavi corrette e `"schema"` accettata come alias
  storico, perché la usano anche gli schemi scritti a mano dagli utenti.

Ruoli convertiti (i cinque più pesanti; gli altri 16 restano invariati):

| Ruolo | Prima | Dopo | Risparmio |
|---|---|---|---|
| `developer` | 4.254 | 1.868 | −56% |
| `sysadmin` | 3.958 | 1.571 | −60% |
| `security_auditor` | 3.313 | 1.862 | −44% |
| `architect` | 3.037 | 1.587 | −48% |
| `researcher` | 2.996 | 1.572 | −48% |

(Solo array `tools`, token stimati a 3,5 caratteri/token — la stessa convenzione di `Agent`. Il
"prima" include gli ~830 token che il fix delle tre chiavi ha *aggiunto*: prima di quello
`developer` misurava 3.835.) Sommando l'elenco testuale, su un modello **non profilato** come quelli
in uso oggi il prefisso fisso di `developer` passa da **5.478 a 1.909 token per richiesta, −65%**.

Ripulita anche una contraddizione preesistente che la modifica avrebbe allargato: `/call` e la fase
di discussione di `/team` passano al modello un array `tools` vuoto (o il solo `cast_vote`), ma
`loadSystemPrompt` riceveva comunque il registry e gli elencava tutti i tool del ruolo — proprio
sopra la riga "No tools available — just your voice". Ora quei due punti non passano il registry:
prompt coerente e qualche centinaio di token in meno per ogni turno di discussione.

Nota sul backend locale: il guadagno di queste due leve è doppio perché agiscono sul **prefisso**
del prompt e lo lasciano stabile. Potare o comprimere la cronologia risparmia token ma invalida la
KV cache di prefisso di llama-server da quel punto in poi, quindi non risparmia tempo; togliere
schemi dalla testa del prompt sì. Per lo stesso motivo `load_tools` costa un re-prefill quando
scatta: conviene che il modello chieda in una sola chiamata tutti i tool della fase corrente, ed è
quello che dice la sua description.

**Accettazione:** un agente `developer` parte con 8 schemi invece di 18 e attiva i restanti su
richiesta senza perdere alcuna capacità; `deferredToolsEnabled: false` ripristina il comportamento
precedente. Suite `tests/test_deferred_tools.ts` (36 test su ripartizione, perimetro di sicurezza,
giro completo nel loop ReAct con ispezione dell'array `tools` realmente inviato a ogni round,
testo del prompt e parametri degli schemi di escalation).
---

## T14.15 — Rumore nella Memoria Iniettata nel Prompt

**Dipende da:** T6.1, T8.2 · **Sforzo:** basso · **Priorità:** media

Il prompt riserva `memoryMaxChars` (600 di default) alla memoria persistente. Su uno store reale
quel budget veniva speso quasi tutto in rumore: 200 fatti di cui 168 di tipo `run`, con quattro
contenuti ripetuti **dieci volte ciascuno** — fra cui `[Goal] Pike: AGENTE: @developer — do work
FINE`. Due cause distinte, entrambe corrette.

- **Nessuna deduplica in scrittura** (`memory.ts`, `addFact`): ogni ripetizione creava una voce
  nuova, che occupava uno slot del cap di eviction e una riga del prompt. Ora una ripetizione si
  fonde nel fatto esistente tenendo la versione più forte di ogni campo (il `kind` più durevole, i
  timestamp più freschi, i tag uniti, `pinned` se presente in una qualsiasi) e incrementando `hits`:
  un fatto ripetuto dieci volte è **un** fatto che è contato dieci volte, non dieci fatti. La chiave
  normalizza spazi e maiuscole, ma **non** lo scope: la stessa frase in scope diversi resta distinta.
- **Guarigione degli store esistenti**: i file scritti prima di questa modifica vengono deduplicati
  al `load()`. Una pulizia manuale che nessuno lancia non è una soluzione.
- **Selezione per sola recency** (`formatForPrompt`): prendeva i fatti più recenti via `getRecent`,
  mentre `evictionScore` classificava già i `run` come la prima cosa da buttare. Il prompt mostrava
  cioè esattamente ciò che la memoria considerava privo di valore. Ora la selezione riusa lo stesso
  punteggio di ritenzione (`rankByRetentionValue`): **una regola sola, due viste** — ciò che la
  memoria protegge più a lungo dall'eviction è ciò che mostra per primo. `getRecent` resta
  cronologico, perché alimenta l'elenco di `/memory`, dove "i più recenti" è la risposta giusta.

- **Isolamento dei test reso strutturale** (`tests/isolateMemory.ts`): `MemoryStore.getInstance()`
  punta alla memoria reale dell'utente se `TSUKA_MEMORY_FILE` non è impostata. `run_tests.ts` la
  imposta prima di lanciare ogni suite, quindi `npm test` era sicuro — ma una suite lanciata **da
  sola** (`npx tsx tests/test_memory.ts`, il modo documentato per fare debug) non ereditava niente,
  scriveva sullo store reale, e la `clear()` finale di `test_memory.ts` cancellava la memoria
  dell'utente in modo irrecuperabile (`memory/` è in `.gitignore`). Un commento che avverte non è
  una guardia: funziona solo se lo leggi prima. Ora 26 suite importano `./isolateMemory` come primo
  import, che dirotta su una cartella temporanea quando la variabile non c'è ed è un no-op quando il
  runner l'ha già impostata — le due strade non possono più divergere. Violava la direttiva 6 di
  AGENTS.md ("mai mutare la `memory.json` dell'utente").

**Accettazione:** venti ripetizioni della stessa nota non possono più espellere dal prompt l'unica
decisione reale; uno store con 40 voci e 4 contenuti distinti si riduce a 4 fatti al primo caricamento;
una suite lanciata da sola non tocca `memory/memory.json`. Suite `tests/test_memory_dedup.ts`
(17 test su deduplica in scrittura, merge dei campi, guarigione al load, ordinamento per valore di
ritenzione e budget di caratteri).

---

## T14.16 — `/benchmark` nella TUI & Autodiscovery del Modello all'Avvio

**Dipende da:** T14.11 · **Sforzo:** basso · **Priorità:** alta

Segnalato dall'utente: `/benchmark` dalla TUI falliva sempre, e la TUI non si accorgeva mai se il
modello effettivamente servito dal backend non corrispondeva a quello scritto in config.

- **`require` a un file inesistente** (`src/tui/commands/workflowCommands.ts`): `/benchmark`
  chiamava `require('../../cli/commands/benchmark')`, ma quel file non esiste — `handleBenchmark`
  vive in `cli/commands/provider.ts`. Il comando falliva a runtime a ogni utilizzo pur superando
  `assertMenuCoverage()`, che verifica solo che il *nome* del comando sia registrato, non che il
  suo `require()` lazy risolva davvero. Corretto il percorso.
- **Il test non poteva intercettarlo**: nuovo caso in `tests/test_tui_data_driven.ts` che scansiona
  ogni `require('../../cli/commands/x')` lazy nei file di `src/tui/commands/`, lo risolve per
  davvero e verifica che il nome destrutturato sia effettivamente esportato dal modulo. Verificato
  a ritroso reintroducendo il bug: il test fallisce con lo stesso errore reale (`Cannot find
  module`), poi torna verde col fix.
- **Nessuna autodiscovery all'avvio** (`src/tui/app.ts`): la TUI chiamava solo `detectContextWindow`
  sul modello già scritto in config — mai `probeProvider` (`src/core/discovery.ts`), la stessa
  funzione che `/provider` e `/models` già usano in CLI. Un modello configurato ma non più servito
  dal backend, o un modello diverso caricato in RAM dopo un riavvio del server, passavano
  inosservati fino al primo `/provider` manuale. Nuovo `TuiApp.discoverModelAtStartup()`, chiamato
  una volta in `start()`: se il modello in config non è tra quelli serviti, passa automaticamente al
  primo disponibile e avvisa (stesso auto-recovery di `handleProvider` dopo uno switch manuale); se
  un modello diverso è caricato in RAM, solo avviso — niente swap forzato, ricaricare un modello
  locale è costoso (stessa logica opt-in di `maybeWarmUp` in CLI); calibra comunque la context
  window dallo stesso scan, senza una seconda chiamata di rete.

**Accettazione:** `/benchmark` dalla TUI esegue invece di fallire; un modello rimosso dal server o
sostituito in RAM viene segnalato all'apertura della TUI senza dover lanciare `/provider` a mano.
Nessuna suite dedicata nuova — copertura nel blocco `require()` esteso di `test_tui_data_driven.ts`.

---

## T14.17 — Spinner CLI Sotto la TUI: Terminale Corrotto e Schermo Congelato

**Dipende da:** T14.16 · **Sforzo:** medio · **Priorità:** alta

Segnalato dall'utente dopo il fix di T14.16: `/benchmark` ora eseguiva, ma "sporcava" il prompt, e
in un tentativo successivo l'input è rimasto visivamente congelato mentre l'header mostrava
"thinking" senza mai dire su cosa.

- **Causa radice**: `CLITheme.createSpinner` (`src/cli/ui.ts`) restituiva sempre un'istanza `ora`
  reale, che scrive sequenze ANSI di controllo cursore direttamente su `process.stdout` — corretto
  su una CLI nuda, ma la TUI possiede lo stesso stdout col proprio renderer double-buffered
  (`TuiScreen`), quindi i due scrittori si contendono il cursore. Ogni altro messaggio `CLITheme`
  (`success`/`error`/`warning`/`info`, usati da `/goal`, `/team`, `/call`) passa già da `logSink`,
  che la TUI intercetta e trasforma in bolle di chat pulite — solo lo spinner bypassava quel
  meccanismo, e `/benchmark` lo usa più intensamente di chiunque altro (`spinner.text = ...`
  aggiornato più volte al secondo per modello), rendendo il problema molto più visibile lì.
- **Primo fix**: sotto `TSUKA_TUI` (stesso flag già letto da `InteractiveMenu.select`),
  `createSpinner` restituisce ora uno shim (`TuiSpinner`) che non tocca mai stdout — solo gli eventi
  finali `succeed`/`fail` passano da `logSink`, come ogni altro messaggio `CLITheme`.
- **Effetto collaterale scoperto provando il fix**: silenziare gli aggiornamenti intermedi
  (`spinner.text = ...`) toglieva anche l'unico motivo per cui lo schermo si ridisegnava — la TUI
  ridisegna solo quando lo store cambia stato (`store.subscribe → requestRender`). Durante un
  benchmark lungo, senza quegli aggiornamenti, passavano minuti senza un solo cambio di stato: lo
  schermo restava fermo sull'ultimo frame (input "congelato"), finché il primo evento vero non
  arrivava e ridisegnava tutto in un colpo — da cui l'impressione di un comando "comparso sotto"
  quello vecchio.
- **Fix del secondo problema**: nuovo canale `src/core/progressSink.ts`, gemello di `logSink` ma per
  testo effimero (un `succeed`/`fail` va ricordato come riga di chat, un "step 3 di 8" no — instrada
  qui invece di spammare la chat con una riga per tick). `TuiSpinner` vi inoltra ogni `.text = ...`
  e il testo iniziale di `.start()`; `TuiApp.start()` lo registra e aggiorna
  `generationStatus.detail`; l'header (`src/tui/views/Header.ts`) mostra una riga live sotto la
  barra di stato quando presente (`└─ Benchmarking 'llama3' — step 3 di 8`), troncata con ellissi se
  più larga dello schermo, assente quando non c'è nulla da dire.

**Accettazione:** nessuna corruzione del terminale durante `/benchmark` o `/goal` (che usa lo stesso
spinner per i gruppi paralleli); lo schermo si ridisegna regolarmente durante un workflow lungo
invece di restare fermo; l'header mostra cosa si sta effettivamente elaborando. Suite
`tests/test_cli_spinner.ts` (4 test: nessuna riga prima che lo spinner si "assesti", inoltro al
progressSink in ordine, fallback su `succeed()`/`fail()` senza argomento, comportamento invariato
fuori TUI) + nuovo blocco "TUI header live-progress detail line" in `test_tui_data_driven.ts`
(4 test: nessuna riga extra se non c'è nulla da dire, riga corretta durante la generazione, pulizia
a fine turno nonostante il merge shallow di `setState`, troncamento con ellissi oltre larghezza).

---

## T14.18 — Fedeltà del Renderer Markdown (CLI + TUI)

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** media

Segnalato dall'utente: la resa markdown nello schermo della TUI "non sempre è corretta" quando il
modello scrive. `renderMarkdownToLines` (`src/cli/markdown.ts`) è condiviso da CLI e TUI
(`src/tui/views/Chat.ts`), quindi il problema toccava entrambe.

- **Formattazione inline scartata del tutto**: `htmlToText` convertiva l'HTML prodotto da `marked`
  in testo scartando ogni tag invece di renderizzarlo — grassetto, corsivo e codice inline
  perdevano ogni distinzione visiva, e un link perdeva persino l'URL (`[link](https://x.com)`
  diventava il solo testo "link", senza modo di sapere dove punterebbe).
- **Tabelle senza `case` dedicato**: lo `switch` su `t.type` non gestiva `'table'`, che cadeva nel
  `default` — lo stesso strip-tag grezzo applicato all'HTML completo della tabella (`<table>
  <thead>...`) produceva una cella per riga, senza intestazioni né allineamento: illeggibile.
- **Liste ordinate senza numerazione**: il `case 'list'` non distingueva `ordered` da `unordered`,
  mostrando sempre `•` anche per `1. 2. 3.`.
- **Nuovo `inlineHtmlToAnsi`**: un convertitore HTML→ANSI generico con uno stack di stili (tag non
  mappati sono no-op invece di richiedere un caso per ciascuno) sostituisce `htmlToText` in tutti i
  casi (paragrafi, titoli, liste, citazioni, default). Grassetto/corsivo/barrato ottengono stile
  ANSI reale; il codice inline resta racchiuso tra backtick colorati (leggibile anche senza colori
  attivi); i link mantengono l'URL come `(url)` in coda al testo.
- **Nuovo `case 'table'`**: colonne allineate rispettando `align` (`:--`/`--:`/`:-:`), larghezza
  naturale calcolata per colonna e ristretta proporzionalmente (minimo 4 caratteri) se la tabella
  non entra in `innerWidth`; celle troncate con `wrapAnsi` (sicuro sull'ANSI) invece di uno slice
  manuale che romperebbe le sequenze di escape.
- **Liste ordinate**: numerano davvero, rispettando anche uno `start` diverso da 1.
- **Trovati e corretti in corsa** (stesso meccanismo generico, costo marginale): le checklist
  (`- [ ]`/`- [x]`) non mostravano alcun checkbox — ora `☐`/`☑`; le immagini (`![alt](src)`)
  sparivano senza traccia — ora `🖼 alt (src)`.

**Accettazione:** grassetto/corsivo/codice inline/link visibilmente distinti nel terminale, link con
URL preservato; una tabella markdown renderizzata come tabella (colonne allineate), non come un
elenco di celle sparse; liste ordinate numerate. Suite `tests/test_markdown_render.ts` estesa
(MD6–MD9, 9 nuovi casi su 15 totali): stile ANSI di grassetto/corsivo, testo e URL del link
preservati, tabella su righe allineate con separatore, numerazione anche non da 1, checkbox resi.

---

## T14.19 — Cambio Modello nella TUI Non Chiedeva Mai il Caricamento al Server

**Dipende da:** T14.17 · **Sforzo:** basso · **Priorità:** alta

Segnalato dall'utente: cambiando modello da `/models` nella TUI, Unsloth Studio riceve davvero la
richiesta di caricarlo?

- **La risposta era no**: `/models` in TUI ha una propria implementazione (`configCommands.ts` per
  l'arg diretto, `SystemModals.openModelModal` per il picker) — nessuna delle due chiamava mai
  `maybeWarmUp`/`warmUpModel`. Il codice di warm-up esiste solo in `cli/commands/provider.ts`,
  dietro un `if (process.env.TSUKA_TUI || (ctx as any).isTui || !process.stdin.isTTY) return;`
  pensato per una conferma interattiva (`prompts()`) che non può disegnarsi nella TUI — quindi
  quel ramo salta sempre sotto la TUI, e la selezione del modello in TUI non passava affatto da lì.
- **Conseguenza pratica**: `/models` cambiava solo il puntatore interno di TSUKA
  (`provider.setCurrentModel` + config); il modello restava quello vecchio in RAM finché non
  arrivava il primo messaggio di chat vero, che si mangiava in silenzio l'intera latenza di
  caricamento, senza nessun "loading model..." a spiegare perché.
- **Fix**: estratte `warmUpIfNeeded` (invia la richiesta reale se un modello diverso risulta
  caricato) e `syncModelOnServer` (fa anche lo scan `probeProvider` per scoprire cosa è caricato,
  per i chiamanti che non lo sanno già) da `maybeWarmUp` in `cli/commands/provider.ts`. La CLI
  interattiva resta invariata (chiede conferma, poi chiama `warmUpIfNeeded`); i percorsi TUI
  (`configCommands.ts`, `systemModals.ts`) le chiamano direttamente, senza chiedere — non c'è
  nulla su cui chiedere, e l'alternativa non è "chiedere in sicurezza", è "non fare nulla in
  silenzio". `openModelModal` ora usa `probeProvider` invece del solo `listModels()`, quindi mostra
  anche il badge "● loaded" come già faceva il picker della CLI.
- **Progresso visibile, non un secondo freeze**: entrambi i punti TUI avvolgono la chiamata con
  `isGenerating`/`generationStatus` (riuso diretto di T14.17 — spinner TUI-safe, `progressSink`,
  riga di dettaglio nell'header), ma solo se lo store è già inattivo (`wasIdle`): un warm-up in
  background non deve mai rubare o azzerare il flag "sta generando" di un turno di chat reale che
  fosse già in corso.

**Accettazione:** cambiare modello da `/models` (arg diretto o picker) nella TUI invia davvero la
richiesta di caricamento al server quando risulta caricato un modello diverso; l'header mostra il
progresso mentre il warm-up è in corso; nessuna richiesta per provider remoti o quando il modello
richiesto è già quello in RAM. Suite `tests/test_model_warmup.ts` (9 test, isolata via `TSUKA_HOME`
temporaneo perché `syncModelOnServer` costruisce un `ConfigManager` reale che altrimenti
scriverebbe sul `tsuka.config.json` vero dell'utente).

---

## T14.20 — Elenco Memoria Illeggibile (Contenuto Tutto Uguale, Data Non Leggibile)

**Dipende da:** T14.15 · **Sforzo:** medio · **Priorità:** media

Segnalato dall'utente: il modal `/memory` è quasi inutile — mostra un elenco di dati tutti uguali,
la data non si riesce a leggere, non si capisce cosa c'è in memoria senza aprire ogni voce.

- **Due cause distinte**, entrambe nella TUI (`SystemModals.openMemoryModal`):
  - **Etichetta = slice grezzo di `content`** (~40 caratteri): la maggior parte dei fatti condivide
    un prefisso lungo e ripetuto (`[Goal] `, `AGENTE: `, un nome agente) — la parte che
    distinguerebbe una voce dall'altra è quasi sempre oltre il quarantesimo carattere, tagliata via
    proprio dove servirebbe.
  - **`hint: Date: ${new Date(f.timestamp).toLocaleTimeString()}`**: `toLocaleTimeString()` mostra
    *solo l'ora*, mai giorno/mese/anno. Due fatti salvati in giorni diversi alla stessa ora
    apparivano identici. La CLI (`cli/commands/memory.ts`) aveva già la data giusta
    (`timestamp.replace('T',' ').slice(0,16)`) — il bug era solo nella TUI.
- **Nuovo campo `summary` su `MemoryFact`** (`core/memory.ts`): un'etichetta breve — l'oggetto di un
  commit, non il diff — distinta da `content` (il dettaglio pieno, invariato). Sempre popolato:
  esplicito se un chiamante lo passa (`AddFactOptions.summary`), altrimenti derivato dalla prima
  riga di `content`, con lo stesso tetto di 72 caratteri in entrambi i casi. I fatti già su disco
  senza il campo vengono sanati in `normalizeFact()` al `load()` — stessa guarigione "self-healing"
  già usata da T14.15 per la deduplica, non serve una migrazione manuale. Su una ripetizione
  (`mergeDuplicate`), vince la sintesi più recente, come già timestamp/lastUsed.
- **Il tool `save_memory` ora richiede `summary`** (schema + `saveMemoryTool`, rifiutato se assente
  o oltre 72 caratteri): è il punto centrale della richiesta dell'utente — l'agente deve sintetizzare
  esplicitamente in poche parole cosa sta memorizzando, non solo scrivere il contenuto e sperare che
  la UI lo tronchi in modo leggibile. Un chiamante che salta il parametro è esattamente il chiamante
  a cui serve essere fermato, non un fallback silenzioso.
- **I 4 punti dove è il sistema stesso a scrivere in memoria** (non un agente via tool call):
  `condenseAgentOutput` in `goal.ts`, la cronologia compressa e le tracce di reasoning in `agent.ts`,
  il report dei sub-agenti in `spawnAgent.ts` — sono proprio la fonte dei "168 fatti `run`" di
  T14.15. Ora passano tutti una sintesi esplicita invece di affidarsi alla derivazione automatica.
- **Elenco aggiornato in TUI e CLI**: `systemModals.ts` mostra `summary` al posto dello slice di
  `content`, più un nuovo `formatFactDate` (`YYYY-MM-DD HH:MM`, assoluto e indipendente dalla
  locale — niente "2h fa" che cambia significato invecchiando) al posto del solo orario;
  `cli/commands/memory.ts` (lista, menu interattivo, box del dettaglio) migrato allo stesso campo
  per coerenza CLI/TUI, mantenendo la data che aveva già.

**Accettazione:** una voce dell'elenco memoria si distingue dalle altre a colpo d'occhio, senza
doverla aprire; la data mostra giorno/mese/anno, non solo l'ora; `save_memory` senza `summary` (o
con uno oltre 72 caratteri) viene rifiutato con un errore che spiega perché; un fatto scritto prima
di questa modifica continua a mostrare un'etichetta sensata. Suite `tests/test_memory_summary.ts`
(sintesi esplicita conservata, sintesi derivata dalla prima riga, troncamento a 72 caratteri in
entrambi i casi, la sintesi più recente vince su una ripetizione, un fatto legacy senza il campo
viene sanato al load, validazione del tool su summary assente/troppo lungo/valido — più i casi di
T14.21 qui sotto, 15 in totale).

---

## T14.21 — La Guarigione di T14.20 Riproduceva lo Stesso Bug su un Fatto Reale

**Dipende da:** T14.20 · **Sforzo:** basso · **Priorità:** media

Trovato nel giro di minuti provando T14.20 su una memoria vera: nell'elenco compariva ancora
`[agent] Reasoning trace complete (2381 chars) on "non mi pare d....` — esattamente il tipo di
etichetta illeggibile che T14.20 doveva eliminare.

- **Causa**: `deriveSummary` (il fallback per un fatto senza `summary` esplicito) prendeva la prima
  riga di `content` e la troncava a 72 caratteri — generico, e infatti sbagliato proprio dove conta
  di più. I 4 punti dove è il sistema stesso a scrivere in memoria (`condenseAgentOutput` in
  `goal.ts`, la cronologia compressa e le tracce di reasoning in `agent.ts`, il report dei
  sub-agenti in `spawnAgent.ts`) producono ciascuno un unico pointer su una riga sola — la parte che
  distingue un fatto dall'altro (quale goal, quale task, quale sub-agente) arriva sempre dopo il
  carattere 72, quindi la sintesi derivata era ancora un frammento a metà frase, indistinguibile
  dagli altri: lo stesso identico bug di prima, con un taglio solo leggermente più largo. Su una
  memoria reale questi sono anche la maggioranza dei fatti (i "168 fatti `run`" di T14.15), quindi
  è il caso comune, non un margine.
- **Fix**: questi quattro formati sono stringhe fisse scritte dal nostro stesso codice — non testo
  libero da indovinare. `deriveSummary` ora prova prima un piccolo elenco di pattern noti
  (`[Goal] X:`, `[Compressed history]`, `Reasoning trace (complete|interrupted) (N chars) on "..."`,
  `[Subagent @X] Task: "..."`) e produce, per un fatto sanato al `load()`, la stessa sintesi che
  avrebbe ricevuto se `summary` fosse esistito fin dall'inizio in quel punto del codice — non una
  seconda approssimazione. Solo un contenuto che non corrisponde a nessun pattern noto (tipicamente
  un `save_memory` libero salvato prima che `summary` diventasse obbligatorio) ricade nel
  troncamento generico di prima.

**Accettazione:** una traccia di reasoning, un goal condensato, una cronologia compressa o un report
di sub-agente salvati prima di questa modifica mostrano nell'elenco la stessa etichetta breve che
avrebbero avuto se scritti oggi, non un frammento troncato a metà frase. +5 casi in
`tests/test_memory_summary.ts` (MS10–MS14: uno per ciascun pattern noto, più il fallback generico
per contenuto non riconosciuto), 15 totali nel file.

---

## T14.22 — Un Tool Auto-Creato Poteva Dichiararsi SAFE e Fare Qualunque Cosa

**Dipende da:** T13.1 · **Sforzo:** medio · **Priorità:** alta

Domanda dell'utente: quando un agente scrive un nuovo tool, potrebbe dichiararlo `SAFE` e invece
formattare il filesystem? Verificato sul codice: sì, e la catena era corta.

- **Il `riskLevel` era autodichiarato, senza alcun riscontro**: `create_tool` leggeva
  `args.riskLevel` e defaultava a `SAFE` se assente; `checkPermission` (`safety/permissions.ts`)
  ritorna `true` immediatamente per tutto ciò che è SAFE — nessun prompt, nessuna coda. Nulla
  verificava mai che il comportamento del codice generato corrispondesse al livello dichiarato:
  l'unica fonte era la parola dell'agente che aveva scritto quel codice.
- **`fs` era il modulo Node reale, non jailato**: i tool nativi che toccano file
  (`read_file`/`write_file`/`delete_file`) passano tutti da `resolveSafePath` e non possono uscire
  dalla workspace; il modulo generato da `create_tool` faceva invece `require('fs')` diretto —
  accesso pieno, ovunque il processo potesse arrivare. Il sandbox `node:vm` non copriva questo: la
  VM valida la *forma* del codice una volta sola alla creazione, mentre il file su disco viene poi
  ricaricato con un `require()`/`import()` normale a ogni avvio successivo (`tools/index.ts`) — non
  è un jail di esecuzione permanente, e non era mai stato pensato per esserlo.
- **La blocklist non copriva le operazioni distruttive**: i 6 pattern vietati riguardavano
  `child_process`, `eval`, `new Function`, `process.exit`, `process.env`, `require` — niente su
  `fs.rmSync`/`unlinkSync`, che con un `fs` non jailato erano perfettamente raggiungibili.

Tre correzioni, in ordine di quanto chiudono:

1. **Mai fidarsi dell'autodichiarazione**: `riskLevel` non è più un parametro dello schema — un tool
   generato è **sempre** `RESTRICTED`, quindi l'utente approva ogni singola chiamata. Un tool è
   liberissimo di descriversi innocuo; non gli è più permesso di *saltare la conferma* sulla forza
   di quella descrizione. (`DANGEROUS` non era comunque raggiungibile.)
2. **`fs` jailato per costruzione** (`src/tools/impl/jailedFs.ts`): wrapper che fa passare ogni
   percorso da `resolveSafePath`, iniettato al posto del modulo reale sia nel codice generato (che
   ora fa `require('…/jailedFs').jailedFs`) sia nella VM di validazione — le due strade non possono
   divergere, e la seconda non può essere più permissiva della prima. Deliberatamente **non** un
   proxy completo di `fs`: espone solo i metodi sincroni che un tool generato usa plausibilmente, e
   qualunque altra cosa semplicemente non esiste su quell'oggetto (fallisce rumorosamente invece di
   ricadere silenziosamente sul modulo vero). Vale anche per un tool che l'utente approva: la
   conferma autorizza *l'operazione*, non l'uscita dalla workspace.
3. **Blocklist estesa da 6 a 9 pattern**: `constructor.constructor` (escape classico verso il
   Function constructor attraverso la prototype chain — non contiene mai il testo `new Function`,
   quindi il pattern esistente non lo vedeva), `import()` dinamico (aggirava il divieto su
   `require()`), e le API `process` distruttive rimaste (`kill`, `abort`, `binding`, `dlopen`,
   `_linkedBinding`).

**Accettazione:** un tool creato dichiarandosi `SAFE` risulta comunque `RESTRICTED` nel registry e
richiede conferma a ogni chiamata; un tool generato che tenta di leggere o scrivere fuori dalla
workspace fallisce col messaggio della jail invece di riuscire; `constructor.constructor`,
`import()` e `process.kill` vengono rifiutati in creazione. +8 casi in
`tests/test_self_authoring.ts` (X4.6/X4.6b: livello forzato e riportato correttamente all'agente;
X4.7a-c: il tool si crea, l'accesso fuori workspace fallisce a runtime, il file generato richiede
davvero il wrapper e non `'fs'`; X4.8-X4.10: i tre nuovi pattern), 17 totali nel file.

---

## T14.23 — Traduzione Integrale in Inglese: Schemi dei Tool & Regola

**Dipende da:** nessuno · **Sforzo:** medio · **Priorità:** media

Domanda dell'utente durante T14.22: "le istruzioni dei tools non sarebbe meglio se fossero sempre
in inglese?" Censimento: 27 dei 28 `tools_schemas/*.json` erano in italiano (solo `audit_code.json`
già in inglese), nonostante AGENTS.md direttiva 1 dicesse già "must always be written in English"
— la scappatoia era "user-facing CLI prompts and docs may be bilingual", abbastanza vaga da far
passare per "docs" quello che in realtà è contenuto di prompt (`description`/`parameters` viaggiano
verbatim nell'array `tools` di ogni richiesta al modello).

- **AGENTS.md direttiva 1 riscritta**: chiude esplicitamente la scappatoia — schema dei tool
  inclusi, `tests/` incluso, nessuna eccezione se non i documenti di pianificazione per l'utente
  (`TASKS.md`, `PLANNING-QUALITA.md`, mai inviati a un modello). Separata la lingua di scrittura
  (sempre inglese) dalla lingua di risposta (quella dell'utente) — la seconda non era mai codificata
  nel system prompt reale: aggiunta una riga esplicita in `loadSystemPrompt` (`src/cli/shared.ts`).
- **25 schemi tradotti** (`browse_url.json` → `write_file.json`, alfabetico, esclusi i 3 già in
  inglese/tradotti in T14.20-22). I letterali enum del protocollo di coordinamento (`APPROVO`/
  `MODIFICARE`/`RIFIUTO`, `COMPLETATO`/`DA_CONTINUARE`/`FALLITO`, `AGENTE: @nome`/`FINE`) lasciati
  **deliberatamente** in italiano — sono token abbinati come stringhe letterali dal codice di
  parsing (`strategies/*.ts`, `goal.ts`: `status === 'COMPLETATO'`, `vote === 'APPROVO'`), non
  prosa; tradurli è un cambio di protocollo, non uno schema — vedi T14.25.
- **Bug trovato in corsa** (`src/core/loop.ts`): `checkAcceptance` cercava il marker
  `'[Il processo è terminato con codice di errore:'` per rilevare un comando di verifica fallito —
  `executeCommandTool` non lo produce in **nessuna lingua** (emette `[Process exited with code: N]`
  solo quando N≠0, mai un marker di successo). Il controllo non scattava mai: un comando di
  accettazione fallito passava sempre come riuscito. Corretto sui marker reali; verificato a
  ritroso ripristinando la stringa vecchia per confermare che il nuovo test la intercetta.
- **`scripts/buildWiki.ts` disallineato** da una compattazione del README (modifica concorrente
  dell'utente, non di questo task): due intestazioni sezione stale corrette in place; le pagine
  wiki `TUI-Dashboard`/`Dashboard-TUI` rimosse perché la loro sezione sorgente è stata assorbita in
  una riga di tabella e non esiste più come prosa estraibile — generare una pagina da una sezione
  assente sarebbe peggio che non generarla.

**Accettazione:** nessuno schema in `tools_schemas/` (eccetto i letterali di protocollo) contiene
italiano; `loadSystemPrompt` istruisce esplicitamente a rispondere nella lingua dell'utente; un
comando di verifica fallito viene rilevato da `checkAcceptance`. 70/70 suite verdi, typecheck e
build puliti.

---

## T14.24 — Traduzione Integrale in Inglese: Commenti in `tests/`

**Dipende da:** T14.23 · **Sforzo:** alto · **Priorità:** bassa

Stessa regola di T14.23 (AGENTS.md direttiva 1), applicata a `tests/`: ~9.800 righe su 65 file
contengono ancora commenti, banner `console.log`, id/messaggio di `check()` o messaggi di `Error`
in italiano. Un ordine di grandezza più grande degli schemi dei tool — non un find-replace, va
fatto a lotti con verifica intermedia.

- Tradurre in ogni file: commenti a blocco/inline, banner `console.log` di apertura/chiusura,
  `id`/messaggio di ogni chiamata a `check()`, messaggi di `Error` sollevati per diagnosticare un
  fallimento del test stesso.
- **Non tradurre mai** un dato di fixture italiano usato *di proposito* per testare un
  comportamento legato alla lingua — es. `test_markdown_render.ts` MD1/MD2 verificano la decodifica
  di apostrofi e accenti italiani (`"Un po' di testo con l'apostrofo"`): tradurlo toglierebbe
  proprio i caratteri che il test deve esercitare.
- Dove un test verifica contenuto HTML/testo di esempio non legato alla lingua (es. il markup di
  prova in `test_browser_evolution.ts`, con parole italiane solo per comodità dell'autore), va bene
  tradurre fixture *e* le asserzioni corrispondenti insieme, nello stesso file — non lasciarle
  spaiate.
- Nessun file di `src/` coinvolto: il censimento di T14.23 ha trovato una sola riga fuori da
  `tests/` (`src/core/loop.ts`), già corretta lì.
- Già tradotti in questa sessione (non richiedono altro lavoro): `tests/test_call.ts`,
  `tests/mocks/mockCtx.ts`.

Lotti (eseguire e verificare `npm test` verde uno alla volta — un lotto può far scoprire
un'asserzione altrove che verifica una sottostringa italiana specifica di uno di questi file, come
già successo in T14.23 con `test_spawn_agent_reasoning_effort.ts`/`meccanic` dopo la traduzione di
`spawn_agent.json`):

1. File di supporto, piccoli: `fixtures/roster.ts`, `manual/README.md`, `manual/test_browser.ts`,
   `manual/test_ollama.ts`, `manual/test_search.ts`, `manual/test_search_debug.ts`,
   `manual/test_sysadmin_live.ts`, `mocks/mockProvider.ts`, `run_tests.ts`, `test_benchmark_dsl.ts`
2. `test_blackboard.ts`, `test_browser_evolution.ts`, `test_completer.ts`, `test_config_limits.ts`,
   `test_context_budget.ts`, `test_context_detection.ts`, `test_continue_command.ts`,
   `test_download_file.ts`, `test_effort_command.ts`, `test_effort_propagation.ts`
3. `test_escalation_tools.ts`, `test_fingerprinting.ts`, `test_generation_timeout.ts`,
   `test_goal_orchestrator.ts`, `test_init.ts`, `test_interrupt.ts`, `test_loop.ts` (parziale — già
   toccato da T14.23, resta la parte pre-esistente), `test_malformed_toolcall_retry.ts`,
   `test_markdown_render.ts` (occhio a MD1/MD2, vedi sopra), `test_memory.ts`
4. `test_memory_phase3.ts`, `test_memory_scope.ts`, `test_memory_summary.ts` (già in gran parte
   inglese da T14.20/21, resta il residuo), `test_mention_completion.ts`, `test_mock_provider.ts`,
   `test_model_warmup.ts` (idem, da T14.19), `test_multi_skill.ts`, `test_parallel_workspace.ts`,
   `test_permission_queue.ts`, `test_phase1_fixes.ts`
5. `test_phase2_fixes.ts`, `test_phase3_fixes.ts`, `test_platform.ts`, `test_presets.ts`,
   `test_prompt_overhead.ts`, `test_protocol_parsing.ts`, `test_reasoning_budget.ts`,
   `test_reasoning_effort.ts`, `test_reasoning_memory.ts`, `test_roles.ts`
6. `test_sampling_params.ts`, `test_security_agent.ts`, `test_self_authoring.ts` (parziale — già
   toccato da T14.22, resta la parte pre-esistente), `test_spawn_agent_context.ts`,
   `test_spawn_agent_reasoning_effort.ts` (idem, T14.19), `test_team.ts`, `test_team_loop.ts`,
   `test_team_modes.ts`, `test_think_parser.ts`, `test_tier_pruning.ts`
7. Ultimo lotto, piccolo: `test_token_calibration.ts`, `test_toolcall_sanitization.ts`,
   `test_traits.ts`, `test_workspace_jail.ts`, `test_write_file_append.ts`

**Accettazione:** nessun file in `tests/` contiene più commenti, banner o messaggi diagnostici in
italiano, eccetto i dati di fixture che testano deliberatamente un comportamento linguistico
(elencati sopra). `npm test` verde dopo ogni lotto, non solo alla fine.

---

## T14.25 — Traduzione dei Token di Protocollo Multi-Agente

**Dipende da:** T14.23 · **Sforzo:** medio · **Priorità:** bassa

`APPROVO`/`MODIFICARE`/`RIFIUTO` (voto), `COMPLETATO`/`DA_CONTINUARE`/`FALLITO` (stato),
`AGENTE: @nome`/`FINE` (instradamento) sono letterali italiani lasciati intenzionalmente intatti in
T14.23 perché non sono prosa: sono token di protocollo abbinati come stringhe esatte in più punti
del codice di parsing (`src/cli/commands/strategies/{common,hybrid,orchestrated,roundRobin,
pipeline}.ts`, `src/cli/commands/goal.ts`/`goalParsing.ts` — regex di fallback testuale, T1.3),
oltre che negli `enum` di `report_status.json`/`cast_vote.json`/`route_next.json`.

- Grep esaustivo di ogni occorrenza letterale di ciascun token **prima** di toccare qualunque file:
  un confronto testuale spaiato (uno tradotto, l'altro no) non dà errore — smette semplicemente di
  scattare mai, in silenzio. Esattamente il tipo di bug trovato in T14.23 su `loop.ts`.
- Aggiornare in un solo cambio coerente: gli `enum` nei tre schemi JSON, ogni `===`/regex di
  confronto nei file di parsing sopra elencati, e la documentazione che descrive il protocollo
  (`docs/architecture.md`, `AGENTS.md` direttiva 5, `docs/multi-agent.md` se esiste).
- Considerare se mantenere un fallback di compatibilità sui vecchi marker testuali italiani per le
  sessioni/log salvati prima del cambio, o se è accettabile una rottura netta (nessun dato persistente
  dipende da questi marker oltre alla durata di un singolo turno di team/goal, da verificare).

**Accettazione:** nessuna occorrenza dei vecchi letterali italiani resta nel codice di parsing;
`npm test` verde, in particolare `test_protocol_parsing.ts`, `test_team_modes.ts`,
`test_goal_orchestrator.ts` che esercitano questi marker direttamente. Non iniziato.

---
---

# FASE 7 — Memoria Persistente per Modelli Piccoli (Retrieval, Eviction, Tool, Prompt)

Stato: in pianificazione. Serie T15, modelli target <30B (nessun embedding): migliora le capacità della
memoria persistente senza incrementare il peso dei prompt. Ogni chiusura di task richiede `npm test`,
`npm run build` e `npm run typecheck` verdi (direttiva AGENTS.md #7).

## T15.1 — Retrieval per Modelli Piccoli: Prefix-Match, Stop-Words e Coverage Ratio

**Dipende da:** — · **Sforzo:** medio · **Priorità:** alta

`src/core/memory.ts` `search()` oggi suddivide la query in token e fa match per singola parola. Per i
modelli locali <30B, che confondono varianti e sinonimi, si rafforza lo scoring mantenendo l'ordinamento
attuale (nessun cambiamento di forma o segnaletica verso l'esterno):

- Tokenizzazione query identica a `normalizeToken` (già con stemmer-essenziale e compositi utili).
- **Prefix-match per token corti**: un token query è considerato corrisposto se è prefisso del token a
  unicode del fatto (o viceversa per i primi N caratteri), così `mem` copre `memoria`/`memory`.
- **Stop-words ignorate**: articoli, congiunzioni, preposizioni di senso vuoto (`il`, `di`, `per`, `that`,
  `and`, ...) non contano né nel denominatore né nel numeratore del coverage.
- **Coverage ratio**: `matches / totalMeaningfulTokens`, con soglia minima di hit diversa da zero per file
  e un boost, non un taglio duro, per i fatti con coverage ≥ 0.75.
- **Peso ricordi rilevanti**: i fatti già toccati da `touch()`/hits alti salgono, senza mai eclissare la
  pertinenza lessicale (la somma dei due fattori sostituisce il solo conteggio parole attuale).

Conseguenza su `search(): Fact[]`: seleziona sempre i **top-N con punteggio > 0**.

**Guard (regressione):** `test_memory.ts` M1b (match parziale) e M1c (match esatto) e
`test_memory_phase3.ts` T8.3 devono restare verdi **senza alcuna modifica** ai file di test.

**Accettazione:** query con varianti/morfologia recuperano fatti oggi non recuperati; la precisione su
fatti non attinenti non peggiora; M1b/M1c/T8.3 verdi verbatim; `npm test` + `npm run build` +
`npm run typecheck` verdi.

---

## T15.2 — Decadimento Temporale nell'Eviction

**Dipende da:** T15.1 · **Sforzo:** medio · **Priorità:** alta

Le valutazioni in `src/core/memory.ts` (`evictionScore`, `rankByRetentionValue`) usano `recency * 10`
senza tempo: un fatto di 9 ore e uno di 9 giorni sono uguali. Si introduce un **decay esponenziale con
half-life per kind**: run ~ 2h, fatto ~ 48h, decisione ~ 7g, lezione ~ 30g. `log10(hoursSinceAccessEscapes)`
bias pacchetti di picchi, quindi si usa `log1p(hours)` normalizzato.

- Il decay si applica **solo ai fatti pinned** − i `pinned` restano sempre agli ultimi posti della coda
  di evizione (nessuna regressione della politica di conservazione).
- Il **touch di `search()` rigenera il decay**: un fatto riusato è di nuovo "giovane" (comportamento odierno).
- Ordine di arresto di caso a parità di punteggio: ultimo-hit più recente vince.

**Guard:** Gruppi D (eviction) ed E (dedup) di `test_memory_dedup.ts` restano verdi **verbatim**; M1c.

**Accettazione:** fatti nuovi prevalgono sui vecchi a parità di altri fattori; `pinned` e fatti nuovi non
vengono sacrificati; suite di regressione verdi senza modifiche; gate verde.

---

## T15.3 — `save_memory`: Summary Opzionale + Traduzione Schema

**Dipende da:** — · **Sforzo:** basso · **Priorità:** alta

`src/tools/impl/saveMemory.ts` oggi **richiede** `summary` (max 500, cap 72). Con `deriveSummary` già
disponibile in memoria, il summary diventa **opzionale**: se omesso, `MemoryStore.addFact` lo deriva dal
contenuto (conservando la protezione attuale del cap come fallback a valle). Si aggiunge il parametro
opzionale `kind` (con i 4 valori noti: `fatto`/`run`/`decisione`/`lezione`), validato contro l'enum; se
non fornito, `addFact` assegna il default.

**Fix di coerenza diretto AGENTS.md #1**: `tools_schemas/save_memory.json` è tuttora in italiano
(l'ultimo schema rimasto non tradotto di T14.23) — traduzione integrale in inglese di `description`,
parametri, `enum` (`facts`/`run`/`decision`/`lesson`), più il nuovo `kind` e la nota testuale "Specify a
kind when...". Questo file è contenuto verbatim nei prompt, non semplice documentazione.

**Aggiornamento test (cambio policy documentato):** `tests/test_memory_summary.ts` MS15 asserisce che
`save_memory` con summary vuoto rifiuta; qui la policy cambia in una direzione meno rigorosa (il summary
è derivato dal contenuto), quindi **MS15 va aggiornato** per certificare lunghezze oltre il cap e la
derivazione automatica quando omesso. Non è un casuale indebolimento: il rationale è documentato in
docs/memory.md §10.

**Accettazione:** `save_memory` accetta chiamate senza summary e senza kind; entrambi derivati a monte;
MS15 aggiornato; schema `save_memory.json` interamente in inglese; gate verde.

---

## T15.4 — Tag Automatici dal Contenuto

**Dipende da:** T15.1 · **Sforzo:** basso · **Priorità:** media

`addFact` oggi memorizza `tags` solo se forniti dal chiamante. Con la stessa tokenizzazione di T15.1 si
derivano **fino a 5 tag automatici** quando `tags` è assente: i top-K token significativi (lo stop-word
list abbiamo già filtrato in T15.1) del contenuto, e keyword per **vietato appare —** non si mettono
keyword per/ti posizione, si riusa il coverage esistente.

**Verificato:** l'assenza di un test che asserisca `tags === undefined` rende innocuo il cambio.

**Accettazione:** `addFact({content, kind})` produce fatti con tag coesi al contenuto; `search()` su
keyword di un tag ritrova il fatto; guard M1c/T8.3 verdi; gate verde.

---

## T15.5 — Quota per Kind: `run` (e `fatto`) nell'Eviction

**Dipende da:** T15.2 · **Sforzo:** medio · **Priorità:** media

Lo store oggi evita gli overflow generici ma permette che il **run** (effimero, generato per turno dalla
compressione in `agent.ts` e dal workflow goal) saturi lo store, scacciando i fatti durevoli. Si introduce
una **quota vigente di applicazione solo in caso di overflow del totale**: `run` ≤ 30% di `maxFacts`,
quando lo store deve comunque fare spazio, i `run` in eccesso vengono rimossi **sempre**, senza sacrificare
mai fatto/pinned quando il totale è sotto il tetto.

- Preferenza **età** per i `run`: il più vecchio prima.
- Niente duro quando `maxFacts` è raggiunto solo parzialmente.
- Le quote non si applicano mai ai `pinned`.

**Guard:** M1c invariato, `test_memory_dedup.ts` D/E; eventuale interazione con la nuova persistenza
T15.6 verificata insieme.

**Accettazione:** store pieno di `run` continua a conservare almeno il 70% di fatti durevoli; store sotto
tetto non perde nulla; quota documentata in docs/memory.md §9; gate verde.

---

## T15.6 — Persistenza Robusta: Scrittura Atomica + Backup su File Corrotto

**Dipende da:** — · **Sforzo:** basso · **Priorità:** alta

`src/core/memory.ts` oggi salva con `writeFileSync` diretto (una interruzione a metà scrittura corrode il
file) e, se `load()` incontra JSON non valido, **resetta con un messaggio senza recupero del dump**.

- `save()`: scrive su `memory.json.tmp` nella stessa directory poi `rename` (operazione atomica su stessa
  filesystem; rename sostituisce il vecchio file) — niente più finestre di mezzo file.
- `load()`: se il JSON è corrotto, **rinomina** il file in `memory.json.corrupt-<epoch>` e avvia lo store a
  vuoto, **con warning via `logSink`** (visibile nella TUI e nei log), non un reset silenzioso. Se il reset
  è comunque dovuto a T15.5 (quota), il log non deve spaventare: solo il caso corrotto fa backup.
- `.tmp` puliti all'avvio: file orfani da crash rimossi.
- Nuova suite `tests/test_memory_persistence.ts` (mock store, temp dir): successo di save/load, file
  corrotto → backup rinominato + warning, tmp orfano ripulito, interleaving quota (T15.5) non rotto.
- Registrazione in `tests/run_tests.ts`.

**Accettazione:** crash a metà scrittura non corrode lo store; file corrotto produce backup recuperabile e
warning, mai silenzio; suite nuova verde e teste registrati; gate verde.

---

## T15.7 — Tool `update_memory` e `forget_memory` (+ `updateFact`)

**Dipende da:** T15.6 · **Sforzo:** medio · **Priorità:** media

Finora la memoria si scrive solo in aggiunta (`save_memory`). Servono la correzione e la rimozione
controllata per fatti con `id`, senza mutazioni brute sul file:

- `MemoryStore.updateFact(id, patch)`: aggiorna `content`/`tags`/`kind`, aggiorna `updatedAt`, innesca
  dedup; ritorna il fatto aggiornato o `null` se non trovato.
- `MemoryStore.forgetFact(id)`: rimozione con conferma di esistenza.
- `src/tools/impl/updateMemory.ts` e `forgetMemory.ts` (SAFE, pattern di `recallMemory.ts`), schemi
  inglesi `tools_schemas/update_memory.json`/`forget_memory.json`; ritornano JSON navigabile con id→esito.
- Registrazione nei ruoli che già elencano `save_memory` e in `AMBIENT_TOOLS` di `goalPrompts.ts`
  (trovati con grep, non assunti).
- Metriche aggiornate quando sono ancora il conteggio: README/it, AGENTS.md §29 → 30 tool, conteggio suite
  70 → 71 (la nuova suite di persistenza), docs/memory.md §8.
- Nuova suite `tests/test_memory_tools.ts` (mock store, temp dir) registrata in `run_tests.ts`.

**Accettazione:** aggiornamento e rimozione funzionano a record; le risposte dei tool sono consumabili via
regex dinamiche dell'agente; conteggi/metriche/documentazione consistenti; gate verde.

---

## T15.8 — Badge di Tipo e Data Compatta nei Prompt

**Dipende da:** T15.4 · **Sforzo:** basso · **Priorità:** media

`formatForPrompt`/`formatRelevant` oggi espongono i fatti senza tipo né freschezza leggibile. Si antepone
un badge di tipo traducibile per l'LLM (`[LESSON]`, `[DECISION]`, `[FACT]`, `[RUN]`) e una data compatta
(`YYYY-MM-DD`) quando il fatto non è pinned; il badge vintage per i pinned resta
`[PINNED]` — i modelli piccoli non devono mai essere un cuscino di memoria senza segnale.

- Non tocca `maxHistoryTokens` né la forma del JSON interno (nessun impatto su prune).
- **`memoryMaxChars` default resta 600** (riga T8.3-CFG-03/04 lo asserisce; si aggiorna la sola
  documentazione).

**Accettazione:** prompt di esempio mostra badge e data; T8.3-CFG-* verdi verbatim; docs/memory.md §7/§9
aggiornati; gate verde.

---

## T16.1 — Trappole a Difficoltà Graduata per Categoria

**Dipende da:** — · **Sforzo:** medio · **Priorità:** alta

I benchmark attuali saturano in alto: `computeTier` assegna `large` con soglie raggiungibili da un modello
medio, quindi la suite **non discrimina** tra 7B, 70B e frontier — e se tutto diventa `large`, il gating dei
tool in `registry.ts` (`currentTierLevel < requiredTierLevel`) smette di proteggere nulla. Il punto è che i
test facili devono restare (soffitto di aderenza) ma servono trappole con grado crescente di difficoltà e
**peso maggiore**, così lo score di categoria si apre.

- 3 nuovi fixture in `benchmarks/` (numerati `40_`, `41_`, `42_` per stare in coda all'ordine di filename):
  - `40_instruction_vincoli.json` — istruzioni con 4+ vincoli interagenti e un **distrattore** (parola simile
    alla vietata ma non vietata; il modello che sbaglia il vincolo negativo scrivendola deve perdere punti).
  - `41_json_esca.json` — JSON con un **campo esca** plausibile da NON includere nello schema e un valore che
    richiede un calcolo (ordinamento/filtro per attributo), non l'estrazione verbatim.
  - `42_tool_catena3.json` — catena di tool a **3+ hop** con risultato intermedio corrotto/ambiguo che forza
    la ri-lettura o la disambiguazione prima di proseguire (lo step `toolResult` deve poter essere "rotto").
- `weight > 1` sui test-trappola: il punteggio di categoria smette di essere una media livellata verso l'alto.
- I 7 fixture esistenti non si toccano: i loro `weight` e le loro check restano identici.
- Nota: inserire nuovi fixture cambia `getBenchmarkTestsHash` → i profili esistenti si **invalidano da soli**
  (`getModelProfile` li scarta), comportamento previsto e corretto.
- Suite `tests/test_benchmark_traps.ts` (mock store + `MockLLMProvider`): i 3 fixture nuovi validano il parse,
  le check eseguono e — criterio chiave — un provider mock che cade nella trappola scoreggia **meno** di uno
  che la evita (cioè il fixture discrimina davvero). Registrazione in `run_tests.ts`.

**Accettazione:** lo score di categoria mostra varianza misurabile per gli stessi 3 casi tra un mock "debole"
e uno "forte"; fixture vecchi e `test_benchmark_dsl.ts` verdi verbatim; gate verde.

---

## T16.2 — `/benchmark --deep`: Repliche, Variazione del Prompt e Mediana Robusta

**Dipende da:** T16.1 · **Sforzo:** medio · **Priorità:** media

`runBenchTest` esegue ogni test **una volta sola**: un parse fortunato vale punteggio pieno, rumore altissimo
e score "giocabile". In più, replicare lo *stesso* prompt N volte cattura solo la varianza di generazione, non
il fatto che un modello possa essere tarato sul wording esatto dei fixture. Per questo la replica e la
variazione vanno in una **modalità profonda** separata, non nel percorso fast.

- Nuovo flag `/benchmark --deep` (in `cli/commands/provider.ts`): il fast resta esattamente com'è — 1 colpo
  per test, deterministico, è il gate del tier. Il deep è un one-off di validazione/calibrazione.
- Campo `repeats` opzionale su `BenchTest` (default 1) e **varianti di prompt**: ogni test può dichiarare
  `variants` (riformulazioni superficiali dello stesso compito: stesso task, wording/ordine degli esempi
  diverso). Nel deep, ogni replica pesca una variante → il modello non può memorizzare la domanda.
- Aggregazione robusta: score = **mediana** (non media) tra le repliche; `BenchTestResult` esteso con `stdDev`.
- Risultati deep salvati in un campo separato del profilo (es. `deepResult`), **senza toccare** il tier fast:
  il profilo fast resta quello che alimenta `getModelTier`/`computeTier`.
- L'hash della suite (`getBenchmarkTestsHash`) resta basato **solo sul contenuto** dei file: cambiare `repeats`
  o `variants` NON invalida i profili fast salvati.
- `/benchmark --deep` mostra per-test: punteggio + varianza (solo quando `repeats > 1`).
- Test in `tests/test_benchmark_traps.ts`: mediana con mock che alterna successo/fallimento, varianti applicate
  (il mock riceve wording diversi tra le repliche), stdDev calcolato, default fast invariato.

**Accettazione:** con `repeats: 3` + `variants` un mock che passa 2 su 3 restituisce la mediana giusta e le
repliche ricevono wording diverso; il fast non cambia comportamento; varianza nel profilo deep e nel comando;
suite verde; gate verde.

---

## T16.3 — Check Simmetrici per Step: Chiamato E Non Chiamato

**Dipende da:** T16.1 · **Sforzo:** basso · **Priorità:** alta

Oggi `tool_not_called` in `benchmarkTests.ts` è un binario grezzo: `!toolCalls || toolCalls.length === 0` —
non distingue "ha chiamato il tool sbagliato" da "non ha chiamato nulla", e non può asserire **in uno stesso
step** "ha chiamato il giusto E NON il distrattore". Con un solo `firstCall`sotto esame, l'astensione e la
selezione sbagliata collassano nello stesso caso.

- `benchmarkTests.ts`: `tool_not_called` con `value` = nome tool → passa se non c'è alcuna chiamata **oppure**
  la prima chiamata NON è quel tool; senza `value` mantiene la semantica attuale (zero chiamate). Così ogni
  step può esigere il positivo (`tool_called`) e il negativo (`tool_not_called` sul distrattore) insieme.
- Aggiornare i fixture `30_tool_catena.json` e `31_tool_trappola.json`: aggiungere `tool_not_called` con
  `value` sui distrattori (`USR-2209`, `USR-8817` nella catena; `get_weather` nella trappola) per ogni step
  dove oggi c'è solo il positivo — senza cambiare ciò che già testano.
- Qualsiasi altro uso esistente di `tool_not_called` (senza `value`) resta semanticamente identico.
- Test in `tests/test_benchmark_dsl.ts`: nuovi casi per la semantica con `value` (chiamata giusta+distrattore
  evitato passa; chiamata del distrattore fallisce; nessuna chiamata passa con e senza `value`).

**Accettazione:** uno step può esigere "tool giusto chiamato + distrattore non chiamato"; fixture aggiornati
senza perdere check; suite verde; gate verde.

---

## T16.4 — Soglie del Tier Calibrate e Riferimento Empirico

**Dipende da:** T16.1, T16.2 · **Sforzo:** basso · **Priorità:** media

Le soglie di `computeTier` (`src/core/modelProfile.ts`) sono numeri magici: `large` = toolCalling≥0.9 ∧
instruction≥0.85 ∧ json≥0.85, `medium` = toolCalling≥0.6 ∧ json≥0.5. Senza un riferimento misurato non c'è
modo di sapere se siano raggiungibili da un 3B o da un 70B — e la calibrazione è esattamente ciò che decide
se il gating dei tool ha senso.

- Soglie configurabili: `tsuka.config.json` → `benchmarkTierThresholds` (`large`/`medium`), default = valori
  attuali. `computeTier` le legge via `ConfigManager` senza cambiare firma per i chiamanti esistenti.
- Procedura di calibrazione documentata (nuova sezione in `docs/architecture.md` §benchmark o un
  `docs/benchmark.md`): eseguire **`/benchmark --deep`** su un modello debole noto (es. un 3B locale) e su un
  riferimento forte (es. un frontier), riportare in tabella le tre categorie con mediana+varianza. La tabella
  diventa il riferimento usato per giustificare (e ritoccare) le soglie default — i numeri smettono di essere
  magic.
- Metrica suite: 72 → resta 72 (nessuna nuova suite; test della configurazione aggiunti alla suite esistente
  `test_benchmark_traps.ts`). README/AGENTS.md già coerenti, nessun conteggio da toccare.
- `/benchmark` chiarisce la fonte: "soglie config" quando sovrascritte, "default" altrimenti; il report di
  calibrazione esplicita il comando deep usato per misurarle.

**Accettazione:** soglie leggibili da config senza cambio di comportamento di default; procedura di
calibrazione documentata su `--deep` con modello di riferimento; test verdi; gate verde.

---

## T17.1 — Retrieval BM25/TF-IDF: Dal Prefix-Match al Peso Lessicale

**Dipende da:** T15.1 · **Sforzo:** medio · **Priorità:** media

`search()` (`src/core/memory.ts`) punteggia con `matches × 1000 + coverage-boost + hitsScore`: un
token della query vale quanto un altro, e il matching è exact o prefix (`tokenMatches`). Questo è il
**livello 3** della scala documentata in `docs/memory.md` §10/§12 — lessicale e deterministico, ma
cieco all'importanza relativa dei token: "postgres" conta quanto "il". BM25/TF-IDF è il
miglioramento a costo zero che resta sullo stesso livello: pesa ogni token per quanto è
discriminante nell'intero store.

- **Ponderazione TF-IDF**: sostituire la formula di score con BM25 —
  `Σ IDF(token) × (tf × (k1+1)) / (tf + k1 × (1 − b + b × len/avgLen))`, con `k1=1.2`, `b=0.75`.
  - `tf` = frequenza del token normalizzato nel fatto; `idf` = `ln(1 + (N − n + 0.5)/(n + 0.5))`
    su N fatti visibili e n fatti che contengono il token.
- **Cosa resta**: la normalizzazione dei token (stemming leggero) e le stop-word di T15.1, e il
  predicato `tokenMatches` (exact o prefix in avanti) come definizione di "hit" di un termine — così
  il guard T6.1a (`type` non matcherebbe `TypeScript`) continua a valere. Il prefix match è
  conservato *sotto* BM25, non rimosso.
- **Cosa se ne va**: il `COVERAGE_BOOST` (500 a coverage ≥ 0.75) diventa ridondante — BM25 già
  somma IDF×TF per termine, quindi un fatto che copre più token sale da solo. Via anche il
  `matches × 1000` grezzo. Hit e recency restano fattori terziari di tie-break.
- **IDF**: calcolato per query sui fatti visibili (200 max ⇒ costo irrilevante); nessuna cache
  necessaria, nessuna nuova dipendenza (`node:*` puro, matematica intera a virgola mobile).
- **Guard da tenere verdi senza modifiche se possibile**: `test_memory.ts` (M1b/M1c),
  `test_memory_phase3.ts` (T8.3-CFG), `test_memory_scope.ts` (T6.1a),
  `test_memory_dedup.ts` (gruppi D/E). Dove BM25 cambia un **ranking** asserito (non una semantica),
  l'aggiornamento dell'asserzione va fatto in modo deliberato e documentato nel report, non in
  silenzio — stesso criterio di T15.3/MS15.
- **Nuovi test** (`tests/test_memory_bm25.ts`): un token raro ("postgres") pesa più di uno comune
  ("il"/"server"); un fatto che copre più termini della query si classifica sopra uno che ne copre
  uno solo (senza boost esplicito); stop-word ignorate; determinismo (doppia esecuzione identica);
  prefix match ancora attivo. Registrazione in `tests/run_tests.ts`.
- **Documentazione**: aggiornare `docs/memory.md`/`docs/memory-it.md` §5 (scoring) per descrivere
  BM25 al posto della formula a coverage; il §12 (percorso di apprendimento) segna il punto 1 come
  fatto.

**Accettazione:** BM25 sostituisce coverage/×1000 senza nuove dipendenze; i guard restano verdi o
le sole asserzioni di ranking aggiornate sono documentate; la suite nuova passa e
`test_memory_bm25.ts` è registrata; gate verde.

### Esito

Implementato, ma la revisione ha trovato un bug che rendeva BM25 **inerte** e che nessuna delle 7
suite di memoria intercettava.

- **Il bug** (`memory.ts`, loop della document frequency): `matchesAny(qt, d.freqs)` passava la
  `Map` invece delle sue chiavi. Iterare una `Map` produce coppie `[token, count]`, quindi dentro
  `tokenMatches` il confronto era stringa-contro-array (sempre falso) e `factToken.length` valeva
  2 — la lunghezza dell'array — finendo sotto `MIN_PREFIX_LEN`. Conseguenza: `n` sempre 0 per ogni
  token, quindi **IDF identica per tutti** (3.0910 con N=10): un token presente in ogni fatto
  pesava quanto uno presente in un fatto solo. Restavano attive solo saturazione TF e
  normalizzazione per lunghezza — cioè proprio la proprietà per cui si adotta BM25 era spenta.
- **Perché nessun test lo vedeva**: il loop di *scoring* destrutturava correttamente
  (`for (const [factToken, count] of d.freqs)`), quindi le TF funzionavano e il recall restava
  plausibile. Le suite esistenti asseriscono tutte il recall ("torna il fatto giusto?"), mai la
  discriminazione ("il token raro vale più di quello comune?").
- **Era anche un errore di tipo**: `npm run build` e `npm run typecheck` fallivano su `main`
  (TS2345), contro la regola di gate di AGENTS.md. Corretto con `d.freqs.keys()`.
- **Guard di regressione**: R1 mette a confronto due fatti che corrispondono a **un solo** token
  ciascuno, con stessa TF e stessa lunghezza — così TF e normalizzazione si annullano e l'IDF è
  l'unica variabile rimasta; il candidato comune è inserito per ultimo apposta, perché con l'IDF
  costante i punteggi vanno in pareggio esatto e il tie-break per recency lo porterebbe in testa.
  R2 verifica che gli **stessi due fatti** si invertano di posizione quando si specchia il corpus.
  Entrambi verificati in entrambe le direzioni: falliscono sul codice rotto, passano sul fix.
  Un primo tentativo di guard (che asseriva "vince il fatto che copre più token della query")
  passava anche col bug ed è stato scartato: quella proprietà è vera con o senza IDF.
- **Divergenze dalla spec**: nessuna sostanziale. La suite è stata rinominata da
  `test_memory_retrieval.ts` a `test_memory_bm25.ts` per rispettare il nome scritto qui, ed è
  stato aggiunto il check di determinismo previsto (R7).
- **Extra**: il regex del runner contava solo `"N passati"`, mostrando `?` per ogni suite già
  tradotta in inglese (T14.24); ora accetta entrambe le forme.

73/73 suite verdi, `npm run build` e `npm run typecheck` puliti.

---

## T18.1 — Esecuzione Graduata: Classificare il Comando, non il Tool

**Dipende da:** T14.22 · **Sforzo:** medio · **Priorità:** alta

Domanda dell'utente: un personaggio sviluppatore non riesce a debuggare, perché non può eseguire
il codice che genera. Verificato, ed è più netto della premessa: non è un problema di permessi
negati, è che **`execute_command` non è in `allowedTools` di `developer`** — il tool non viene
proprio offerto al modello. Un solo ruolo su 21 (`sysadmin`) lo possiede.

Il quadro trovato:

- `execute_command` è `DANGEROUS`, e a differenza di `RESTRICTED` **non ha un "always"**:
  `allowAllWrite` copre solo le scritture, quindi ogni singolo comando richiede un y/n nuovo.
- Nessuna allowlist: `git status` e `rm -rf /` passano dallo stesso identico prompt.
- `spawnOptions` non impostava `cwd`: la shell ereditava la directory del processo harness. La
  workspace jail protegge i tool file (`resolveSafePath`), **non** la shell.

Messe insieme, queste tre cose significano che **l'unico meccanismo di sicurezza sull'esecuzione
era che un umano dicesse sì ogni volta**. Da cui il vincolo di progetto: non si può auto-approvare
per rendere autonomo il developer, perché si toglierebbe l'unico controllo esistente. Vanno prima
aggiunti controlli reali, poi si allenta il prompting.

- **L'unità di fiducia è il comando, non il tool** (`src/safety/commandRisk.ts`). La capacità resta
  DANGEROUS; la singola invocazione viene graduata:
  - `SAFE` — sola ispezione, non scrive nulla fuori dal proprio stdout (`git status/diff/log`,
    `ls`, `cat`, `--version`, `tsc --noEmit`).
  - `RESTRICTED` — effetti confinati al progetto (`npm test`, `npm run build`, `npm install`,
    `git add/commit`, `node script.js`). Sta qui *apposta*: RESTRICTED ha già "approva per il resto
    della sessione", quindi un agente che itera sul proprio codice paga una conferma sola invece
    di una per iterazione. È tutto il senso della divisione in tier.
  - `DANGEROUS` — tutto il resto.
- **Tre regole rendono l'allowlist un controllo e non una superficie di bypass**:
  1. *Deny by default*: ciò che non è riconosciuto positivamente è DANGEROUS. Le liste concedono,
     non negano.
  2. *Mai match su prefisso*: `npm test; rm -rf /` comincia con un comando consentito. I pattern
     sono ancorati al comando intero.
  3. *Mai interpretare gli operatori di shell*: un comando con `;` `|` `&&` `>` backtick `$(…)`
     viene escalato senza tentare di analizzarlo. Decidere se una riga composta è sicura significa
     reimplementare la shell, e ogni tentativo prima o poi perde contro il quoting.
- **Hook `Tool.classifyRisk(args)`** nel registry, opzionale: se assente si usa il `riskLevel`
  statico. Un classificatore che lancia o restituisce un valore non valido ricade sullo statico,
  mai su qualcosa di più permissivo. Non è una superficie di attacco nuova per i tool auto-creati:
  il template di `create_tool` genera solo `name`/`riskLevel`/`execute`, non può iniettarlo.
- **`cwd` sulla shell**: `spawn` parte da `getWorkspaceRoot()`. È contenimento, non una jail — `cd ..`
  esce comunque — ed è esattamente il motivo per cui il classificatore escala tutto ciò che non
  riconosce.
- **`developer` ottiene `execute_command`**, differito (non in `coreTools`), quindi lo schema non
  pesa sul prompt finché non serve.

**Accettazione:** un `developer` può lanciare test e build pagando una conferma per sessione, non
per comando; un comando composto o ignoto continua a chiedere sempre. Suite
`tests/test_command_risk.ts` (25 test): 13 di classificazione, **8 di bypass** (`;`, `&&`, pipe,
redirezione, backtick, `$(…)`, newline, flag distruttiva su un comando altrimenti SAFE), 4 su input
degenere (vuoto, `undefined`, non-stringa) che non devono mai cadere su una risposta permissiva.

**Modifica deliberata a un test esistente:** `test_goal_orchestrator.ts` G5d fissa un budget token
sul catalogo agenti inviato all'orchestratore. Aggiungere `execute_command` a `developer` ha portato
la media da 60 a 61 token/agente. Soglia del *proxy* alzata a 64 e documentata inline; il tetto
assoluto (< 1600, la vera garanzia) resta invariato e ha ancora ~145 token di margine. `execute_command`
è un tool discriminante — dice all'orchestratore chi può davvero lanciare test — quindi vale il token
che costa.

### Non fatto (passo successivo naturale)

Un **tetto per ruolo** (`executionPolicy: none | readonly | workspace | full`): oggi `allowedTools`
è binario, quindi un ruolo che ha `execute_command` può arrivare a DANGEROUS *previa conferma*. In un
`/goal` autonomo il rischio è che l'utente approvi per sbloccare il workflow. Un tetto per ruolo
negherebbe in partenza, senza nemmeno chiedere. Richiede di far arrivare il ruolo fino al registry
(che oggi non lo conosce): plumbing non banale, task a sé.

## T18.2 — Parametri di Campionamento per Famiglia di Modello (Qwen3.8) da File JSON

**Dipende da:** T8.17 · **Sforzo:** basso · **Priorità:** media

Le model card pubblicano i parametri di campionamento consigliati, e per Qwen3.8 sono **due set
distinti**: uno per la modalità thinking (`temperature 1.0`, `top_p 0.95`, `top_k 20`, `min_p 0.0`,
`presence_penalty 0.0`, `repetition_penalty 1.0`) e uno per la modalità instruct (`temperature 0.7`,
`top_p 0.80`, `presence_penalty 1.5`, resto invariato). L'harness inviava solo i preset di
creatività (T8.17) e, in loro assenza, **nessun parametro**: il backend applicava i propri default
(llama.cpp parte da `temperature 0.8`), diversi da quelli per cui il modello è stato tarato.

- **Tabella per famiglia** (`MODEL_SAMPLING_PROFILES` in `src/core/provider.ts`): una riga per
  famiglia, con i due set. Aggiungere un modello significa aggiungere una riga, non un ramo `if`.
  Il match è una regex sull'id del modello, quindi copre prefisso del provider e suffisso di
  quantizzazione (`unsloth/Qwen3.8-27B-GGUF`).
- **Modalità dedotta dallo sforzo**: `reasoningEffort === 'none'` → set instruct; qualunque altro
  valore, **sforzo assente incluso**, → set thinking, perché Qwen ragiona di default.
- **Override da file JSON** (`samplingProfiles` in `tsuka.config.json`): chiave = sottostringa
  case-insensitive sull'id del modello, oppure `/regex/` se racchiusa fra slash; valore =
  `{ thinking: {...}, instruct: {...} }` o un blocco piatto valido per entrambe le modalità. Fra più
  chiavi che matchano vince la più lunga, così una quantizzazione specifica batte la famiglia.
  Chiavi sconosciute e valori non numerici vengono scartati con un avviso, non fanno saltare il file.
- **Precedenza**: valore esplicito nella chiamata → preset di creatività → JSON di configurazione →
  tabella interna. Il config *tara* i default di fabbrica, non li sostituisce in blocco: i parametri
  che non ridefinisce restano quelli della tabella.
- **Parametri fuori schema OpenAI**: `top_k`, `min_p` e `repetition_penalty` non esistono nell'API
  OpenAI; llama.cpp e vLLM li leggono comunque dal body. `repetition_penalty` viaggia in coppia con
  l'alias `repeat_penalty` (il nome usato da llama.cpp). Se un backend rifiuta la richiesta per uno
  di questi nomi, il provider li rimuove **per il resto della sessione** e riprova senza consumare
  budget di retry — stesso schema già usato per `logprobs` (T14.9) e `reasoning_effort`.

**Accettazione:** `tests/test_sampling_params.ts` sale a 35 test — thinking vs instruct, modello
fuori tabella che non riceve nulla, precedenza esplicito/preset/famiglia, override dal config
(anche per un modello assente dalla tabella) e inoltro reale di `top_k`/`min_p` nel body della
richiesta HTTP.

### Non fatto

Nella tabella c'è **solo Qwen3.8**: i valori delle altre famiglie in `models_profile.json`
(Qwen3.5, Qwen3.6, gemma-4) non sono stati inventati per analogia. Finché non se ne cita la card,
si configurano da `samplingProfiles` — che è esattamente il motivo per cui il livello di config
esiste.

## T18.3 — Crash del Renderer Markdown su Codice Inline nelle Tabelle

**Dipende da:** T14.16 · **Sforzo:** basso · **Priorità:** alta

`Error: Token with "codespan" type was not found` sollevato da `marked` dentro
`renderMarkdownToLines`, con lo stack che risale fino a `TuiApp.renderFrame`: non un messaggio
malformato, **un intero frame della TUI che non viene disegnato**.

Causa: il case `table` renderizzava le celle con `marked.parser(c.tokens)`. Le celle però
contengono token **inline** (`text`, `codespan`, `strong`, `link`), mentre `marked.parser` è il
parser di *blocco* e conosce solo i tipi di blocco. Finché una cella conteneva solo `text` funzionava
per caso — `Parser.parse` gestisce `text` — ma bastava un codice inline in una cella per far
lanciare il parser. Una tabella con nomi di parametri, cioè esattamente il caso d'uso più frequente
in questo progetto, era una mina.

- **`Parser.parseInline(tokens)`** per intestazione e corpo (`inlineTokensToAnsi` in
  `src/cli/markdown.ts`): è l'API giusta per una sequenza di token inline. Lo stile resta quello
  del resto del renderer, quindi il codice inline in cella si vede con i backtick come nei paragrafi.
- **Il ramo `default` non può più far cadere il frame**: se `marked.parser` lancia su un token
  inaspettato si ricade su `parseInline`. Meglio una riga resa in modo povero che una schermata vuota.

**Accettazione:** `tests/test_markdown_render.ts` (MD10a/b/c) copre codespan, grassetto e link
nelle celle e nell'intestazione. Prima del fix MD10a falliva con il crash.

**Nota operativa:** lo stack arrivava da `dist/`, quindi la correzione si vede nella TUI solo dopo
`npm run build`.

## T18.4 — Pensiero Live Leggibile e Click che Colpisce la Riga Disegnata

**Dipende da:** T14.16 · **Sforzo:** medio · **Priorità:** alta

Due difetti nello stesso punto, segnalati insieme: mentre il modello ragiona il pensiero era
compresso in **una riga sola** (la coda del testo fra virgolette), quindi la parte più
interessante mentre si aspetta non si poteva leggere senza cliccare; e cliccando un pensiero
vecchio **durante l'elaborazione non succedeva nulla**.

La seconda non era un problema di input: `handleMouseEvent` non ha nessun guardia su
`isGenerating`, l'evento arrivava. Il problema era la geometria. `ChatView.render` costruiva le
righe in un modo, e i due hit-tester (`getMessageAtRow`, `getThinkingHeaderAtRow`) la
**ricalcolavano per conto proprio** con tre divergenze:

1. `render` spinge una riga vuota di spaziatura **anche dopo l'ultimo messaggio**, gli hit-tester
   la toglievano (`lineCursor - 1`) → una riga di sfasamento appena la conversazione supera
   l'altezza del pannello.
2. `render` aggiunge la card di attività (⚡ THINKING / 🔧 TOOL EXECUTION) **più una riga vuota**
   quando `isGenerating`, gli hit-tester non la conoscevano → altre due righe di sfasamento
   esattamente durante l'elaborazione, cioè il caso segnalato.
3. L'estensione del blocco di pensiero espanso era stimata contando le righe **non wrappate** del
   testo, mentre il renderer le manda a capo → il fondo di un pensiero aperto non era cliccabile.

Con lo scroll a zero (conversazione corta) le formule coincidevano, ed è il motivo per cui il
click "a volte" funzionava.

- **Un solo layout** (`ChatView.layout`): costruisce le righe una volta e registra, per ogni
  messaggio, il range assoluto e il sotto-range del blocco di pensiero. `render` ne prende la
  fetta visibile, gli hit-tester ci cercano dentro la riga cliccata. Le tre divergenze non sono
  state corrette una per una: non esistono più due aritmetiche da tenere allineate.
- **Il pensiero live nasce aperto** (`isThinkingExpanded`): scelta esplicita dell'utente > pensiero
  in corso (aperto) > toggle globale Ctrl+T. Appena arriva la risposta il pensiero torna a
  seguire il toggle globale, quindi la cronologia resta compatta come prima.
- **Coda invece di tutto** (`STREAMING_THOUGHT_TAIL_LINES = 12`): un pensiero lungo scorre
  mostrando le ultime righe, così non spinge fuori schermo il resto della conversazione.
- **Un solo renderer del blocco** (`renderThoughtBlock`): i due rami quasi identici — pensiero in
  corso e pensiero concluso — differivano solo per titolo e finestra di righe.

**Accettazione:** `tests/test_tui_thinking_view.ts` (14 test). I casi di click ricavano la riga
attesa **dal frame renderizzato**, non da un numero fisso: è l'unico modo perché un renderer e un
hit-tester che divergono di nuovo facciano fallire la suite. Sulla versione precedente falliscono
TV1a/TV1b (pensiero live illeggibile), TV6 (feed scrollato) e TV7b (click durante l'elaborazione).

## T18.5 — Ctrl+T Apriva i Tools invece di Espandere il Ragionamento

**Dipende da:** T18.4 · **Sforzo:** basso · **Priorità:** media

Due funzioni rivendicavano lo stesso tasto. In `handleKeyPress` la risoluzione della navigazione
conteneva un alias esplicito — `key.ctrl && key.name === 't' ? tabByKey('f2') : undefined` — e
girava **prima** del toggle del ragionamento. Quindi Ctrl+T apriva il pannello Tools, e il blocco
sotto (`toggleThinkingExpansion`) era codice morto irraggiungibile: nessuno se n'era accorto perché
la funzione c'era, i test la chiamavano direttamente e la cheatsheet documentava *entrambe* le
letture (`F2 / Ctrl+T` fra i tab, `Ctrl+T` nel blocco pensiero della chat).

- **Il tasto va al ragionamento**, che è ciò che la chat annuncia su ogni pensiero
  (`▸ [Click / Ctrl+T]`) e ciò che dice `/thinking`. I Tools restano su F2, etichettato in ogni
  larghezza di terminale: l'alias non aggiungeva niente.
- **`resolveTabShortcut(key, focus, hasModal)`** in `navigation.ts`: un solo posto risponde a "questo
  tasto cambia scheda?". Un accordo con modificatore (`ctrl`/`meta`) non è mai una scorciatoia di
  scheda — le schede vivono sui tasti funzione — quindi il caso non può ripresentarsi aggiungendo
  un altro alias di comodo.
- **Cheatsheet allineata**: `F2` senza alias fra le righe dei tab, e `Ctrl+T — Expand / collapse
  reasoning traces` fra le scorciatoie generali. La cheatsheet ora documenta il binding che gira.

**Accettazione:** `tests/test_tui_thinking_view.ts` sale a 21 test. TV9 fissa la risoluzione dei
tasti (Ctrl+T non è una scheda, F2 e F12 lo restano, `?` apre l'aiuto solo fuori dal prompt), TV10
legge la cheatsheet renderizzata e verifica che documenti il toggle del ragionamento e non più
l'alias Tools.

## T18.6 — Roster dei Subagent: lo Spawn Successivo Cancellava il Precedente

**Dipende da:** T14.16 · **Sforzo:** basso · **Priorità:** media

Segnalazione: spawnando un agente, aspettando che torni e spawnandone un altro, del primo non
restava niente — né i token consumati né i dettagli. Tre cause distinte, tutte nella stessa zona.

1. **Il widget nascondeva la storia.** `PersonaWidget` aveva un `else if`: box dettagliato **oppure**
   elenco dei subagent passati, mai insieme. Con un subagent in corso l'elenco spariva, e siccome
   un subagent nuovo è quasi sempre "in corso" quando lo si guarda, i precedenti erano invisibili.
2. **Gli id potevano collidere.** `id: sub_${Date.now()}` — due spawn nello stesso millisecondo
   condividevano l'id, e `setSpawnedAgent` filtra la storia per id prima di inserire: il secondo
   **espelleva il primo**. Con gli spawn ravvicinati (o due nello stesso turno) succede davvero.
3. **I token non erano per agente.** `subagentUsedTokens` è il misuratore del contesto effimero
   in volo, azzerato quando un subagent rientra; veniva però **riletto e copiato** dentro il record
   dell'agente. Un contatore condiviso non può descrivere due agenti.

- **`renderSubagents`**: intestazione con quanti sono stati spawnati e il totale token, poi il box
  dettagliato di quello in corso (se c'è) e **sotto** l'elenco di quelli rientrati, ciascuno con
  esito, token e durata. Cap a `MAX_LISTED_SUBAGENTS = 5` con `… +N more`, perché la sidebar
  scrolla ma non è infinita.
- **`sub_${Date.now()}_${++this.subagentSeq}`**: il timestamp resta leggibile, la sequenza rende
  l'id unico per costruzione.
- **`store.addSpawnedAgentTokens(added)`**: i token si sommano sul record dell'agente attivo (e
  sulla sua voce di storia). Il misuratore globale continua a fare il suo mestiere, ma non è più
  la fonte del dato per-agente.
- **Durata** (`startedAt`/`completedAt`, già presenti nel tipo e mai mostrati) sia nel box sia
  nell'elenco.

**Accettazione:** `tests/test_tui_subagent_queue_copy.ts` (15 test). Il caso nuovo spawna due
subagent **nello stesso millisecondo** — la condizione che faceva sparire il primo — e verifica
roster di due elementi con id distinti, token separati (120 e 300), esito conservato, misuratore
in volo ancora a 300 e widget che mostra insieme il box di quello in corso e la riga di quello
rientrato.

## T18.7 — Click Spostato di una Riga e Incolla Multi-riga Spezzato in Turni

**Dipende da:** T18.4 · **Sforzo:** basso · **Priorità:** alta

Due segnalazioni nella stessa sessione, entrambe sul confine fra terminale e stato.

### Il click selezionava la riga sotto

Nel Files Explorer (e nella chat) la conversione da riga del terminale a riga di contenuto era:
`mouse.row - headerHeight - profileHeight - 1`. Le righe del mouse sono **1-based**, l'header
occupa 3 righe, ma ogni pannello **disegna un bordo superiore prima della prima riga di
contenuto**: era quel bordo a mancare nel conto. Risultato: la riga calcolata era una più in
basso di quella sotto il cursore. Non era un difetto del solo explorer — la stessa sottrazione
sbagliata era anche nel ramo della chat, che è il motivo per cui il comportamento sembrava
generale.

- **`TuiScreen.paneContentRow(screenRow, headerHeight, paneBodyOffset)`**: l'inverso di
  `drawBox`, e sta accanto a `drawBox` apposta — chi aggiunge il bordo e chi lo toglie devono
  stare sotto gli occhi insieme. Entrambi i rami del click ci passano.
- **`FilesView.indexAtRow(state, height, contentRow)`**: il pannello risponde su quale voce
  disegna a una certa riga. Il click sommava `state.filesScrollOffset` grezzo, mentre `render`
  lo **clampa** al fondo della lista: con la lista scrollata a fine cartella i due numeri
  divergevano di nuovo. Ora l'offset lo clampa una funzione sola.
- **`FilesView.visibleFiles(state)`**: unica sorgente della lista, prima duplicata in
  `FilesView.render` e in `app.currentFiles()`.

### L'incolla multi-riga eseguiva la prima riga

La TUI non attivava il **bracketed paste** (DECSET 2004). Senza, il terminale consegna il testo
incollato come byte normali: ogni a capo è un CR, ogni CR è Invio, quindi il prompt inviava la
prima riga e accodava le altre come turni separati — esattamente il sintomo descritto.

- **`\x1b[?2004h` all'avvio, `\x1b[?2004l` all'uscita** (`screen.ts`).
- **`InputParser`** riconosce `\x1b[200~ … \x1b[201~` ed emette **un solo evento** `paste` col
  testo letterale, CR e CRLF normalizzati a `\n`. Un incolla lungo arriva spezzato su più chunk
  di stdin: il testo parziale resta in `pendingPaste` finché non arriva il marcatore di chiusura.
- **`app.handleKeyPress`** tratta `paste` come testo e non come tasti: porta il fuoco sul prompt
  e inserisce, qualunque pannello fosse attivo. `store.insertInputText` conserva gli a capo — il
  buffer del prompt è già multi-riga (Shift+Invio), mancava solo la strada per riempirlo.

**Accettazione:** `tests/test_files_explorer.ts` sale a 12 test: il caso chiave ricava la riga
attesa **dal frame renderizzato** (la prima voce sta subito sotto il bordo) e verifica voce per
voce, più i casi di bordo, riga vuota e offset da clampare. `tests/test_tui_paste.ts` (6 test,
nuova suite) copre incolla multi-riga come evento singolo, normalizzazione CRLF, incolla spezzato
su due chunk, tasti prima e dopo i marcatori, CR isolato che resta Invio, e inserimento nel buffer
col cursore che finisce in fondo al blocco.

## T18.8 — Pipe nel Codice Inline Spezzava le Tabelle del README

**Dipende da:** — · **Sforzo:** basso · **Priorità:** media

Nella tabella dei comandi del README la riga `` `/benchmark [model|all]` `` finiva su due colonne:
"all]" scivolava nella cella successiva e da lì la tabella si disallineava. Non è un difetto del
renderer: per il parser markdown **il pipe resta un separatore di cella anche dentro i backtick**,
e va scritto `\|`. GFM documenta esattamente questa via d'uscita.

Righe corrette: `/benchmark [model\|all]` e `/memory [clear\|id]` in `README.md` e `README-it.md`,
più una riga di `TASKS.md` (T8.17) che elencava i preset `'precise' | 'balanced' | 'creative'` e
per lo stesso motivo produceva 5 celle su un'intestazione da 3.

**Accettazione:** `tests/test_markdown_tables.ts` (3 test, suite nuova) passa in rassegna la
documentazione pubblicata (README, README-it, SECURITY, AGENTS, TASKS, `docs/*.md`), salta i blocchi
di codice recintati e verifica che nessuna riga di tabella contenga un pipe non escapato dentro il
codice inline e che **ogni riga abbia le celle della propria intestazione**. Il secondo controllo è
quello che vale: prende anche gli sbilanciamenti che non nascono da un backtick. Un primo test di
sanità pretende almeno 20 righe di tabella trovate, così una scansione che smette di trovare i file
fallisce invece di passare a vuoto.
