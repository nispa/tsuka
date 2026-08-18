# Workflow Multi-Agente e Collaborazione 👥

<div align="right">
  <p>Read in <a href="multi-agent.md">🇬🇧 English</a></p>
</div>

TSUKA supporta interazioni multi-agente avanzate: consente di orchestrare dibattiti collegiali (`/call`), avviare squadre collaborative su workspace condiviso con tool reali (`/team`), o delegare a un orchestratore dinamico (`/goal`) la pianificazione e l'assemblaggio della squadra perfetta a partire da tutti i personaggi disponibili.

---

## 🎭 1. Sistema Personaggi: Ruoli vs Tratti (Personaggio = Agente)

Invece di codificare prompt monolitici, TSUKA scompone l'identità dell'agente in due vettori ortogonali:

* **Ruolo (`roles/*.json`)**: definisce le competenze operative e la lista dei tool autorizzati (es. `developer`, `sysadmin`, `security_auditor`, `supervisor`).
* **Tratto (`traits/*.json`)**: imposta il tono di voce, la postura critica e le direttive stilistiche (es. `professional`, `creative`, `grumpy`, `uncompromising`, `devils_advocate`).

Un **Personaggio (`characters/*.json`)** collega un nome identificativo (`aiName`) a un ruolo (o a più ruoli, con supporto multi-skill e cambio a caldo tramite `switch_skill`) e a un tratto:
* **Geordi** (`geordi.json`): `developer` + `professional`
* **Worf** (`worf.json`): `security_auditor` + `reliable`
* **Pike** (`pike.json`): `supervisor` + `reliable`

---

## 📞 2. Dibattiti e Conferenze Multi-Agente (`/call`)

Il comando `/call` avvia una discussione collegiale a più voci su qualsiasi argomento, senza accesso ai tool:

1. **Invocazione**:
   * **Multiselect interattivo**: digitando `/call` senza argomenti compare un menu a selezione multipla con caselle di controllo.
   * **Menzioni dirette**: indicando i nomi con `@` (es. `/call @spock, @kirk, @doctor`).
2. **Esecuzione del dibattito**:
   * L'utente inserisce il tema di discussione.
   * Il sistema esegue $N$ round: ad ogni turno monta il system prompt del personaggio di turno e include la trascrizione degli interventi precedenti preceduti da `[Nome]: "..."`.
3. **Memoria di trascrizione**:
   * Al termine della chiamata, la trascrizione completa del dibattito viene iniettata nella cronologia principale della chat.

---

## 🚀 3. Squadre Collaborative su Workspace Fisico (`/team`)

Il comando `/team` avvia una sessione operativa in cui gli agenti collaborano su un compito comune eseguendo tool di lettura, scrittura ed esecuzione comandi sul filesystem:

```powershell
/team dev_security
> "Implementa un modulo di logging sicuro e verifica l'assenza di segreti hardcoded"
```

### Le 4 strategie di coordinamento (`mode`):
1. **`orchestrated` (consigliata)**: un agente supervisore dedicato (`orchestrator`, es. `pike`) riceve un digest dei progressi ad ogni turno e decide chi far intervenire tramite il tool `route_next(agent, reason)` (o dichiara `FINE`).
2. **`round-robin`**: sequenza ciclica fissa tra i membri del team per un massimo di round (`teamMaxRounds`, default 3).
3. **`pipeline`**: catena di montaggio a passaggio singolo in cui ogni stazione riceve l'output della precedente, lo perfeziona e lo trasmette alla successiva. Supporta criteri di accettazione oggettivi ([`src/core/loop.ts`](../src/core/loop.ts)).
4. **`hybrid`**: impostando `discussionRounds > 0`, al termine di ogni round operativo si apre una discussione collegiale con votazione formale (`cast_vote`).

### Protocollo di coordinamento a tool call:
* `report_status(status, summary, next_hint)`: chiude il turno dell'agente (`COMPLETATO`, `DA_CONTINUARE`, `FALLITO`).
* `route_next(agent, reason)`: utilizzato dall'orchestratore per indirizzare il turno successivo.
* `cast_vote(vote, reason)`: voto di approvazione nelle discussioni di squadra (`APPROVO`, `MODIFICARE`, `RIFIUTO`).
* *Risoluzione gerarchica*: **Tool call → Regex testuale di fallback (`STATO:`) → Default di sicurezza** (con segnalazione visiva di degrado).

### Blackboard di Run (`post_note` / `read_notes`):
Spazio temporaneo condiviso tra i membri di uno stesso run (isolato tramite `AsyncLocalStorage`) per scambiare decisioni intermedie, note e artefatti senza inquinare la memoria a lungo termine.

---

## 🎯 4. Orchestratore Dinamico di Obiettivi (`/goal`)

Il comando `/goal` analizza l'obiettivo fornito dall'utente e **assembla dinamicamente la squadra ideale** scegliendo tra tutti i 24 personaggi disponibili:

```powershell
/goal Crea un'applicazione CLI in TypeScript con relativi unit test e audit di sicurezza
```

### 1. Fase di Pianificazione (Orchestrator Planner)
L'orchestratore analizza il catalogo dei personaggi e genera un piano strutturato:
```
AGENTE: @una — Progetta l'architettura dei moduli e i contratti TypeScript
PARALLELO:
AGENTE: @geordi — Sviluppa l'implementazione del core
AGENTE: @data — Redige la documentazione tecnica
FINE PARALLELO
AGENTE: @worf — Esegue l'audit di sicurezza sul codice
AGENTE: @pike — Revisiona e valida il risultato finale
FINE
```

### 2. Esecuzione e Concorrenza nei Blocchi `PARALLELO`
* I sotto-compiti indipendenti all'interno dei blocchi `PARALLELO` vengono eseguiti concorrentemente con `Promise.all`.
* **Workspace di staging isolati**: ogni ramo parallelo lavora in una sandbox temporanea (`parallelWorkspace.ts`). A fine blocco le modifiche vengono unite segnalando eventuali conflitti su file modificati contemporaneamente.
* **Coda unificata dei permessi**: le richieste interattive (`[y/N]`) vengono serializzate in ordine di arrivo.

### 3. Monitoraggio del Contesto e Statistiche
* **Doppia barra di contesto**: visualizza la stima pre-turno e il picco reale di token misurato dall'LLM a fine turno.
* **Condensazione della cronologia**: gli output superiori a 1.500 caratteri vengono riassunti salvando il dettaglio in memoria persistente.
* **Rilavorazione guidata dal supervisore**: se il revisore finale riscontra difetti o non conformità, riapre selettivamente lo step precedente per la correzione.
* **Riepilogo statistiche finale**: tabella con token di output, picco di contesto, tempo e velocità per ciascun agente coinvolto.
