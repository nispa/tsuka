# Piano Qualità — Determinismo e debito tecnico [COMPLETATO & ARCHIVIATO]

> **Stato (15 Agosto 2026):** Tutte le Fasi (0, 1, 2, 3, 4 e 5) sono state **interamente completate**: MockProvider, suite di test deterministiche, protocollo su tool call, workspace jail per blocchi paralleli e calibrazione token.

> Complementare a `PLANNING.md` (evoluzione funzionale). Questo piano non aggiunge feature:
> consolida quelle esistenti. Obiettivo: eliminare i bug non deterministici eliminabili e
> rendere **osservabili** quelli intrinseci al paradigma LLM.

**Principio guida:** un sistema multi-agente su LLM locali non può essere deterministico a
runtime, quindi si lavora su due assi:

1. rendere deterministico tutto ciò che può esserlo — parsing, protocolli, test;
2. dove il non-determinismo è essenziale, renderlo osservabile — **mai degradare in silenzio**.

L'ordine delle fasi segue la dipendenza tecnica: la Fase 1 è prerequisito di tutte le
successive, perché senza test deterministici ogni refactor è al buio.

---

## Fase 0 — Igiene (mezza giornata, rischio nullo)

1. **Commit dello stato attuale.** Il branch `feat/adaptive-routing` ha 30+ file modificati e
   8 moduli nuovi non tracciati. Ogni refactor parte da uno snapshot pulito, altrimenti non si
   distinguono le regressioni dalle modifiche in corso.
2. **Output degli agenti fuori dalla root del repo.** File come `zmar3.txt` vanno in una
   cartella dedicata (`output/` o `work-disk-it/`), con riga in `.gitignore`.
3. **Attivare `workspaceRoot` in `tsuka.config.json`.** La jail esiste già
   (`resolveSafePath` in `src/tools/impl/utils.ts`) ma non è configurata: oggi
   `allowAllWrite` = scrittura ovunque sul disco. Un rigo di config attiva la protezione
   già scritta.
4. **Versione coerente:** `package.json` dice 1.0.0, il tag di commit dice 0.1.
   Allineare (proposta: 0.2.0 a fine piano).

## Fase 1 — MockProvider + test dell'orchestrazione (la fondazione)

*Il cuore del problema: oggi le 4 modalità team e `/goal` sono verificabili solo con un LLM
vero, quindi mai due volte uguali.*

1. **`tests/mocks/mockProvider.ts`** — stessa interfaccia di `LLMProvider`, ma risponde da un
   copione: una coda di risposte predefinite (testo, `tool_calls`, marker `STATO:`, decisioni
   `AGENTE: @nome`). Scriptabile per scenario: ogni test dichiara la sequenza di risposte che
   il "modello" darà.
2. **Test per ogni modalità**, uno scenario felice + uno di rottura ciascuno:
   - round-robin: `STATO: COMPLETATO` → early stop; senza marker → stop a max round;
   - orchestrated: routing seguito con agenti validi; risposta non parseabile → fallback
     round-robin **con segnalazione** (cfr. Fase 2);
   - pipeline: catena completa; `STATO: FALLITO` a metà → stop corretto;
   - hybrid/voting: unanimità → completato; un `MODIFICARE` → turno extra;
   - `/goal`: piano con blocco `PARALLELO` → tutti gli step eseguiti, stats raccolte.
3. **Test del parsing di protocollo isolato**: `parsePlan`, `parseOrchestratorDecision`,
   `hasCompletionMarker`, `hasUnanimousApproval` con input sporchi realistici — output di
   modelli 9b con markdown attorno, maiuscole sbagliate, marker a metà frase. I test più
   economici e con più resa: il parsing è dove i bug non deterministici nascono.
4. Aggancio in `tests/run_tests.ts` come le suite esistenti.

*Valore didattico collaterale:* i test con provider mockato sono documentazione eseguibile
del protocollo — l'unico modo per un lettore di "vedere" un'orchestrazione senza eseguirla
live.

## Fase 2 — Protocollo strutturato al posto delle regex

*La fonte n.1 di non-determinismo: coordinamento affidato a stringhe libere parsate con
regex, su modelli piccoli che le sbagliano spesso, con fallback silenzioso a round-robin.*

1. **Tool call dedicate per le decisioni di coordinamento:**
   - `report_status(status, summary, next_hint)` per i membri (sostituisce `STATO: ...`);
   - `route_next(agent | done, reason)` per l'orchestrator (sostituisce `AGENTE: @nome`);
   - `cast_vote(vote, reason)` per il voting (sostituisce `APPROVO/MODIFICARE/RIFIUTO`).
   Schema JSON in `tools_schemas/`, coerenti con l'architettura esistente.
2. **Regex come fallback, non come prima linea** (i modelli small potrebbero non chiamare il
   tool). Ordine: tool call → regex → default. Ogni caduta di livello **emette un evento
   visibile**: riga gialla in UI e voce nel workflow log.
3. **Campo `protocol` nei log di `workflow_logs/`**: per ogni turno, come è stata presa la
   decisione (`tool_call` / `regex` / `fallback`). Dopo qualche run si sa *quanto spesso* il
   modello degrada.
4. I test di Fase 1 si estendono: scenario "modello che usa il tool" e scenario "modello che
   scrive solo testo".

## Fase 3 — Fix del path parallelo di `/goal`

*L'unico bug concreto già identificato.*

1. **Permessi:** due agenti paralleli che chiedono un tool RESTRICTED producono due `prompts`
   concorrenti sullo stesso stdin. Fix minimo: **mutex sul `PermissionManager`**
   (promise-chain: le richieste si accodano, l'utente risponde una alla volta). Alternativa
   da valutare: pre-autorizzazione del gruppo prima del `Promise.all`.
2. **Filesystem:** `PLANNING.md` (§1.03) prescriveva workspace temporanei per i branch
   paralleli; l'implementazione clona solo la history. Fix: sottocartella per agente
   (`workspace/parallel-<n>/`) via il meccanismo `workspaceRoot` esistente, merge dei file a
   fine blocco con conflitti segnalati all'utente.
3. **Output interlacciato:** buffer per-agente durante il parallelo, flush ordinato a fine
   blocco, indicatore live minimale (`⚡ falco… ⚡ overseer…`). Si rinuncia allo streaming
   live nel parallelo: compromesso onesto.
4. La regressione è coperta dal test di Fase 1.

## Fase 4 — Split di `team.ts` + tipi veri

*Il refactor che rimette il progetto sui binari didattici. Da fare DOPO le fasi 1-2: con i
test verdi e il protocollo strutturato, lo split è quasi meccanico.*

1. **Interfaccia `TeamStrategy`** (`run(ctx, team, task): Promise<TeamResult>`) e quattro
   file: `src/cli/commands/strategies/roundRobin.ts`, `orchestrated.ts`, `pipeline.ts`,
   `hybrid.ts`. `team.ts` resta dispatcher (~100 righe) + utility condivise
   (`runMemberTurn`).
2. **Tipi condivisi in `src/core/types.ts`**: `ChatMessage`, `TeamConfig`, `PlanStep`,
   `TurnOutcome`, `Vote`. È qui che muoiono i 26 `any` di `team.ts` e i 12 di `goal.ts` —
   non con una caccia all'`any` a tappeto, ma tipando il layer di protocollo. Nota: la
   Fase 2 riduce già molti `any` da sola, perché le tool call hanno schema.
3. Ogni strategia deve superare i test di Fase 1 **senza modificarli**: è la prova che lo
   split non ha cambiato comportamento.

## Fase 5 — Rifiniture

1. **Calibrazione token:** `estimateTokens` a 3,5 char/token sbaglia su italiano e codice, e
   ci poggia sopra tutta la gestione contesto. L'API fornisce già `usage.prompt_tokens`
   reale: dopo ogni risposta, aggiornare un rapporto chars/token osservato (media mobile) e
   usarlo al posto della costante. ~20 righe in `agent.ts`.
2. **Tappa 6 nella guida didattica** — "da un agente a N agenti coordinati": le quattro
   strategie come esempi paralleli e confrontabili, il protocollo strutturato come lezione
   ("perché le regex non bastano coi modelli piccoli" è contenuto didattico).
3. **CI minima:** GitHub Actions con `npm test` su push. Le suite girano senza LLM, è solo
   un file yml.
4. **Verifica dei claim della guida:** passata finale su `docs/guida-didattica.md` per
   confermare che ogni affermazione punti a codice ancora vero. Per un progetto didattico è
   il check di rilascio, non un extra.

---

## Riepilogo

| Fase | Cosa risolve | Sforzo | Rischio regressioni |
|------|-------------|--------|---------------------|
| 0. Igiene | repo sporco, jail spenta | mezza giornata | nullo |
| 1. Mock + test | bug invisibili, refactor al buio | 1-2 giorni | nullo (solo test) |
| 2. Protocollo su tool call | degradazione silenziosa, parsing fragile | 1-2 giorni | medio → coperto da F1 |
| 3. Fix parallelo | stdin condiviso, race su fs | 1 giorno | basso |
| 4. Split + tipi | god-object, `any` sul protocollo | 1-2 giorni | medio → coperto da F1 |
| 5. Rifiniture | stima token, Tappa 6, CI | 1 giorno | nullo |

**Regola trasversale, più importante di ogni singola voce:** ogni volta che il sistema
ripiega su un comportamento di emergenza (fallback regex, round-robin forzato, compressione
fallita, tool non parseabile), **lo dice** — a schermo e nel log. I bug non deterministici
non si eliminano in un harness LLM; si eliminano i punti in cui falliscono senza lasciare
traccia.
