# Pianificazione Evolutiva — TSUKA [COMPLETATO & ARCHIVIATO]

> **Stato (15 Agosto 2026):** Tutti i TIER (1, 2, 3 e 4) definiti in questo documento sono stati **interamente implementati e validati** (routing orchestrato, tool `send_message`, blocchi `PARALLELO`, modalità ibrida, voting, `spawn_agent`, modalità `pipeline`, blackboard di run e workflow logs). Per il backlog futuro vedi `TASKS.md`.

## Visione

Trasformare TSUKA da orchestratore turn-based rigido a sistema multi-agente **adattivo** dove gli agenti cooperano, negoziano e si delegano compiti dinamicamente — pur restando in un paradigma sequenziale (lo sciame puro non è possibile via API LLM).

---

## TIER 1 — Fondazioni adattive (più complessi)

### 1.01 Agente-Occhetto per routing dinamico

Invece del loop fisso `for member of team.members`, introdurre un **agente orchestrator** (o il system prompt stesso) che dopo ogni turno decide *chi* deve intervenire dopo:

- Risultato del turno corrente → LLM sceglie `next_agent` tra i membri disponibili
- L'orchestrator può anche decidere `done` (early stop intelligente)
- Il team JSON può opzionalmente specificare un `orchestrator` distinto (es. overseer)

*Complessità:* alta. Richiede modifiche profonde al loop in `team.ts`, un protocollo di risposta strutturato (JSON mode o tool call dedicata), e gestione dei casi limite (nessuno scelto, loop nello stesso agente).

### 1.02 Tool `send_message(agent, message)`

Un tool che permette a un agente di **inviare un messaggio diretto a un altro agente** durante il suo turno, simulando una comunicazione peer-to-peer:

```json
{
  "name": "send_message",
  "riskLevel": "SAFE",
  "parameters": {
    "target": "nome_agente",
    "message": "richiesta, suggerimento o domanda"
  }
}
```

- Il messaggio viene accodato e mostrato all'agente target all'inizio del suo prossimo turno
- L'agente mittente continua il suo turno (non aspetta risposta)
- Nelle iterazioni future si può aggiungere `wait_response: true` per turni sincroni

*Complessità:* medio-alta. Nuovo tool, modifica del seeding history in `team.ts`, UI per mostrare i messaggi in arrivo, gestione code.

### 1.03 Esecuzione parallela di sotto-compiti indipendenti

Quando l'orchestrator identifica sotto-compiti indipendenti, lancerli **in parallelo** (Promise.all) su agenti diversi, poi unire i risultati:

- API LLM chiamate in parallelo → risparmio di tempo reale
- Necessita di merge intelligente dei risultati (file prodotti, messaggi in history)
- Rischio race condition su file system → va usato un workspace temporaneo per branch paralleli

*Complessità:* alta. Richiede fork di contesto, merge, gestione conflitti file system, UI che mostra progresso parallelo.

---

## TIER 2 — Nuovi pattern collaborativi

### 2.01 Modalità ibrida Lavoro+Discussione

Fondere `/call` e `/team`: una sessione che alterna **turni di lavoro** (con tool) a **turni di discussione** (senza tool, stile conferenza):

```
Round 1: Agente A lavora (tool) → Agente B lavora (tool) → Discussione (tutti)
Round 2: Agente C lavora (tool) → Agente A lavora (tool) → Discussione (tutti) → Voto
```

- Configurabile nel team JSON (`mode: "hybrid"`, `discussionInterval: 1`)
- I turni di discussione usano la stessa logica di `/call` (senza tool, max 4 frasi)
- Il voto può essere esplicito o implicito (consensus via linguaggio naturale)

*Complessità:* medio-alta. Unisce due loop esistenti, nuovi parametri di configurazione team, gestione alternanza.

### 2.02 Meccanismo di Voting/Consensus

Alla fine dei round di lavoro, un giro di **votazione strutturata** tra gli agenti:

- Ogni agente vota: `approvo`, `modificare`, `rifiuto` + motivazione
- Se tutti approvano → `STATO: COMPLETATO`
- Se c'è `modificare` → l'agente responsabile fa un ulteriore turno
- Se c'è `rifiuto` → si ricomincia con un approccio diverso

*Complessità:* media. Protocollo già simile a `STATO: COMPLETATO`, da estendere con struttura di voto, conteggio, UI dedicata.

### 2.03 Spawn dinamico di sub-agenti

L'overseer (o un altro agente) può creare un **sub-agente specializzato on-the-fly** per un compito specifico:

- Comando `/spawn <nome> <ruolo> <traito>` o tool `spawn_agent(displayName, role, trait, task)`
- Il sub-agente viene eseguito in un contesto figlio (history separata)
- Il sub-agente ritorna un report al genitore
- Opzionale: sub-agente temporaneo (vive solo per quella task) o permanente (aggiunto al team)

*Complessità:* media. Si appoggia al sistema esistente di character/role/trait, ma richiede creazione e gestione di contesti annidati.

---

## TIER 3 — Miglioramenti ai pattern esistenti

### 3.01 Riassunto inter-round per history più intelligente

Invece di seminare tutta la cronologia grezza, ogni turno produce un **riassunto strutturato** del proprio contributo:

```markdown
## Turno di Falco (Round 1/3)
- Azioni: modifica nginx.conf, riavvio servizio
- Risultato: porta 443 configurata, test SSL passato
- Stato: DA_CONTINUARE
- Messaggio al prossimo: "Verifica le regole firewall sul database"
```

- Riduce il rumore nei messaggi di history (tool output enormi)
- Dà al prossimo agente un contesto più leggibile
- L'agente corrente può decidere cosa è importante riassumere

*Complessità:* medio-bassa. Modifica a `team.ts` nel punto dove si estraggono i nuovi messaggi. Il riassunto può essere fatto dallo stesso LLM con un prompt dedicato, oppure generato dalla struttura degli eventi.

### 3.02 Modalità pipeline (catena di montaggio)

Aggiungere una modalità `pipeline` al team JSON, dove ogni agente passa il suo output al successivo **senza tornare indietro**:

```json
{
  "name": "dev_pipeline",
  "mode": "pipeline",
  "members": ["dev", "reviewer", "tester", "deployer"],
  "artifacts": ["src/*", "dist/*"]
}
```

- Diversa dal round-robin: file prodotti dal primo → secondo → terzo
- Ogni agente vede solo ciò che serve (history filtrata)
- Stop al primo `STATO: FALLITO`

*Complessità:* media. Nuovo parametro `mode`, modifica del loop in `team.ts`, filtraggio history intelligente.

### 3.03 Configurazione team avanzata

Estendere il JSON dei team con:
- `mode`: "round-robin" | "pipeline" | "hybrid" (default round-robin)
- `orchestrator`: nome membro che fa da orchestrator (default nessuno = round-robin puro)
- `maxRoundsPerMember`: limite individuale (default 1)
- `discussionRounds`: numero turni di discussione ibrida (default 0)
- `voting`: boolean per attivare voto finale (default false)

*Complessità:* medio-bassa. Solo aggiunta di campi JSON e logica condizionale in `team.ts`.

---

## TIER 4 — Qualità della vita (più semplici)

### 4.01 Notifiche e progresso UI migliorato

StreamRenderer potenziato per i workflow team:
- Barra di progresso: `[Round 2/3 — Agente 3/4 — Falco 🦅]`
- Pannello riassuntivo a fine team: cosa ha fatto ogni agente, file modificati, tempo impiegato
- Colori diversi per ogni membro del team

*Complessità:* bassa. Solo UI, nessuna logica di orchestrazione.

### 4.02 Test suite per pattern multi-agente

Test che simulano:
- `/call` con 2+ agenti → verifica trascrizione
- `/team` con completamento → verifica early stop
- `/team` senza completamento → verifica max round
- Protocollo `STATO: COMPLETATO` → verifica regex

*Complessità:* bassa. Solo test. Mockare LLMProvider per test deterministici.

### 4.03 Comando `/diff` per confrontare lavori

Tool/confronto che mostra le differenze tra due output di agenti diversi:
- `diff` tra file prodotti da agenti diversi
- Confronto di piani/proposte in formato strutturato

*Complessità:* medio-bassa. Nuovo tool o comando slash.

### 4.04 Persistenza dei team workflow

Salvare su disco i report dei workflow team completati:
- `workflow_logs/<team_name>-<timestamp>.json`
- Contiene: task originale, membri, round fatti, file modificati, stati, trascrizione

*Complessità:* bassa. Scrittura file JSON strutturato, nessuna logica complessa.

---

## Roadmap consigliata

```
Fase 1 (Tier 1): Routing dinamico + send_message tool
    ↓
Fase 2 (Tier 2): Lavoro+Discussione + Voting
    ↓
Fase 3 (Tier 3): Riassunti intelligenti + Modalità pipeline
    ↓
Fase 4 (Tier 4): UI e test — sempre paralleli alle fasi sopra
```

L'ordine segue la **dipendenza tecnica**: il routing dinamico è prerequisito per molti pattern avanzati. Test e UI si possono fare in parallelo a qualsiasi fase.
