# Guida Didattica — Il Sistema di Memoria Persistente 🧠

<div align="right">
  <p>Read in <a href="memory.md">🇬🇧 English</a></p>
</div>

> **Premessa Didattica**: I Large Language Model sono funzioni senza stato (*stateless*): ogni richiesta riparte da zero se non viene fornito contesto. Ma come possiamo dotare un agente di memoria a lungo termine senza saturare la finestra di contesto e senza ricorrere a pesanti e complessi database vettoriali esterni?  
> Questa guida analizza l'architettura della memoria persistente di TSUKA: i concetti chiave, le scelte ingegneristiche, il funzionamento passo dopo passo e le lezioni apprese dagli errori commessi durante lo sviluppo.

---

## 1. I Tre Livelli di Coscienza di un Agente

Prima di analizzare formule e codice, è fondamentale distinguere i tre livelli di stato in un harness agentico:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Cronologia del Turno (RAM)                                               │
│    • Ambito: Turno di conversazione corrente                                │
│    • Ciclo di vita: Effimero (azzerato al riavvio, potato durante il turno) │
│    • Scopo: Messaggi del ciclo ReAct (richieste utente, chiamate tool, log) │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Lavagna di Esecuzione / Blackboard (AsyncLocalStorage)                   │
│    • Ambito: Singolo workflow multi-agente (/team o /goal)                  │
│    • Ciclo di vita: Singola esecuzione (distrutta al termine del goal)      │
│    • Scopo: Spazio condiviso per scambiare note intermedie tra gli agenti   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Memoria Persistente a Lungo Termine (memory/memory.json)                 │
│    • Ambito: Condivisa tra tutte le sessioni, i workspace e gli agenti      │
│    • Ciclo di vita: Permanente (su disco, gestita da eviction a punteggio)  │
│    • Scopo: Decisioni architetturali, convenzioni e lezioni apprese         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 💡 L'Errore Comune di Progettazione
Un errore tipico quando si costruisce un harness è accumulare tutta la cronologia passata nel prompt di sistema.
* **Il problema**: I modelli linguistici piccoli e locali (<30B parametri) soffrono di **"diluizione dell'attenzione"** (*attention dilution*): quando migliaia di token di log passati inondano il prompt, il modello si confonde, dimentica le istruzioni recenti e sbaglia i parametri dei tool.
* **La regola architetturale**: I log transitori restano nella RAM di turno; le note di lavoro tra agenti restano nella Blackboard temporanea; solo la conoscenza solida e curata viene promossa nella Memoria Persistente.

---

## 2. La Scala della Memoria — Perché TSUKA adotta il Livello 3

La memoria nei sistemi AI non è una soluzione unica, ma una **scala di compromessi** (*trade-offs*): ogni gradino superiore offre maggiore astrazione semantica a fronte di maggiore complessità architetturale, latenza e perdita di determinismo:

```
Gradino 6: Grafi di Conoscenza Temporale (Zep, Mem0) ── Infrastruttura pesante, motori a grafo
Gradino 5: Memoria Auto-Curata Continua (Letta)      ── LLM costantemente in loop per auto-editing
Gradino 4: Vettori & RAG Semantico                  ── Richiede modelli di embedding e vector DB
────────────────────────────────────────────────────────────────────────────────────────────────
Gradino 3: Ranking Lessicale + Emivita (TSUKA)      ◄── ZERO dipendenze, 100% deterministico e locale
────────────────────────────────────────────────────────────────────────────────────────────────
Gradino 2: Sintesi Mobile (Rolling Summary)         ── Perde dettagli puntuali, costosa in prompt
Gradino 1: Buffer Grezzo di Chat                    ── Esaurisce immediatamente la finestra di contesto
```

### Perché la scelta del Gradino 3?

| Dimensione | RAG Vettoriale / Embedding (Gradino 4) | Lessicale + Emivita (TSUKA - Gradino 3) |
|---|---|---|
| **Dipendenze Esterne** | Richiede modello di embedding + librerie native vector DB | **Zero** (TypeScript puro + `node:fs`) |
| **Latenza & Risorse** | 50–500ms per ogni embedding, RAM GPU/CPU aggiuntiva | **0ms**, scoring istantaneo su CPU |
| **Ispezionabilità & Debug**| Vettori di numeri opachi, ranking difficile da verificare | File JSON in chiaro (`memory/memory.json`), `grep`-pabile |
| **Affidabilità Locale** | Può fallire se il server di embedding va in crash | Totalmente autonomo, funziona sempre offline |
| **Compromesso Accettato** | Riconosce parafrasi ("auto" = "automobile") | Cerca radici e prefissi esatti ("costruire", "costruzione") |

> 🔑 **Intuizione Chiave**: Nello sviluppo software e nell'ingegneria dei prompt, le ricerche riguardano quasi sempre **nomi di file esatti, identificatori, codici di errore, tecnologie e convenzioni specifiche** piuttosto che parafrasi poetiche. L'algoritmo BM25 combinato allo stemming morfologico copre circa il 90% delle reali esigenze con zero complessità infrastrutturale.

---

## 3. La Gerarchia di Durabilità (I 4 Livelli di Ricordo)

Non tutti i ricordi hanno lo stesso valore nel tempo. Un errore di compilazione di dieci minuti fa diventa inutile una volta risolto, ma una convenzione architetturale (*"In PowerShell usa sempre UTF-8 senza BOM"*) deve durare per mesi.

TSUKA classifica i ricordi in **4 livelli di durabilità decrescente**:

```
        ▲  ┌───────────────────────────────┐
        │  │  LEZIONE (Lesson)             │  Peso: 3 | Emivita: 30 giorni
        │  │  "Mai disabilitare TLS"       │  (Regole d'oro, convenzioni permanenti)
        │  ├───────────────────────────────┤
        │  │  DECISIONE (Decision)         │  Peso: 2 | Emivita: 7 giorni
        │  │  "Usiamo Vitest, non Jest"    │  (Scelte di architettura e librerie)
        │  ├───────────────────────────────┤
DURABILITÀ │  FATTO (Fact)                 │  Peso: 1 | Emivita: 48 ore
        │  │  "Config in src/config.ts"    │  (Stato del sistema, snapshot ambiente)
        │  ├───────────────────────────────┤
        │  │  RUN (Run Note)               │  Peso: 0 | Emivita: 2 ore
        │  │  "Passo 3 fallito con timeout"│  (Log transitori, i primi ad essere rimossi)
        ▼  └───────────────────────────────┘
```

* **Protezione Quota Run**: Quando la memoria è piena (`maxFacts = 200`), i log di tipo `run` possono occupare al massimo il 30% dello spazio disponibile durante l'eviction, impedendo che un flusso intenso di lavoro cancelli le lezioni preziose.

---

## 4. Anatomia del Ciclo Vitale della Memoria (Sotto il Cofano)

```
                  ┌──────────────────────────────┐
                  │ 1. Scrittura & Deduplica     │  Normalizzazione testo, auto-tagging, unione hits
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────▼───────────────┐
                  │ 2. Ricerca & Recupero        │  Ranking BM25 + stemming morfologico
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────▼───────────────┐
                  │ 3. Invecchiamento & Eviction │  Decadimento esponenziale a emivita; touch ringiovanisce
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────▼───────────────┐
                  │ 4. Iniezione nel Prompt      │  Task-Aware (BM25) vs Generale (Retention Score)
                  └──────────────────────────────┘
```

---

### Passo 1: Scrittura, Normalizzazione e Deduplica

Quando un agente chiama `save_memory`:
1. **Sicurezza Atomica su Disco**: Scrivere direttamente su `memory.json` rischia di corrompere il file se il processo viene interrotto a metà. TSUKA scrive su un file temporaneo (`memory.json.tmp`) ed esegue una **rinomina atomica a livello di filesystem**. Se il file viene trovato corrotto, i byte vengono salvati in `memory.json.corrupt-<timestamp>` prima di ripartire puliti.
2. **Deduplicazione Normalizzata**: Prima di salvare, il sistema genera una chiave normalizzata:
   ```typescript
   key = `${scope} ${content.trim().replace(/\s+/g, ' ').toLowerCase()}`
   ```
3. **Unione Intelligente (*Smart Merge*)**: Se il ricordo esiste già:
   - Aggiorna il tipo di durabilità se il nuovo è superiore (es. `fatto` $\to$ `decisione`).
   - Incrementa il contatore `hits` del ricordo esistente (un concetto registrato più volte è un concetto che ha valore).
   - Aggiorna i timestamp e unisce i tag.
4. **Auto-Tagging**: Se l'agente non specifica tag, il motore estrae fino a 5 parole chiave significative dal testo, ignorando le stop-words.

---

### Passo 2: Ricerca Intelligente con BM25 e Stemming

Quando gli agenti cercano nella memoria con `recall_memory(query)`:

#### 1. Stemming Morfologico
Le parole vengono ricondotte alla loro radice base (es. `"funzioni"` $\to$ `"funzion"`, `"running"` $\to$ `"runn"`). Questo permette a ricerche in italiano e inglese di intercettare singolari, plurali e coniugazioni.

#### 2. Principi del Ranking BM25 (Best Matching 25)
Invece di un banale controllo di sottostringa, BM25 applica tre principi matematici intuitivi:
* **Rarità dei Termini (IDF)**: Le parole comuni contano pochissimo; i termini rari e distintivi (es. `"OAuth"`, `"PostgreSQL"`, `"deadlock"`) dominano il punteggio.
* **Saturazione di Frequenza**: Ripetere una parola 10 volte non decuplica il punteggio. BM25 applica rendimenti decrescenti, neutralizzando lo "spam" di parole chiave.
* **Normalizzazione della Lunghezza**: Una nota sintetica di 20 parole che contiene il termine cercato ottiene un punteggio superiore rispetto a un paragrafo di 500 parole in cui la parola compare per caso.

---

### Passo 3: Invecchiamento Biologico & Eviction

Quando la memoria supera la capienza massima (`maxFacts = 200`), il sistema elimina il ricordo non bloccato con il punteggio più basso:

```
                                  FORMULA DEL PUNTEGGIO DI EVICTION
  
  Score = (Peso_Durabilità × 100) + (Decadimento_Tempo × 10) + TieBreak_Recente + Bonus_Hits
                 ▲                             ▲
                 │                             │
         Fattore dominante:           Erosione esponenziale
        Lezione batte sempre           in base all'emivita
            i log di Run                (2h, 48h, 7g, 30g)
```

#### Il Meccanismo del "Touch" (Principio Hebbiano: *"Ciò che si usa, si rafforza"*)
* Quando un ricordo viene restituito da `recall_memory(query)`, il sistema lo **tocca** (*touch*):
  - Incrementa `hits` di 1.
  - Aggiorna il timestamp `lastUsed` a **ora**.
* **Effetto**: I ricordi consultati spesso rimangono sempre "giovani" e immuni all'eviction. I ricordi mai richiamati decadono naturalmente e vengono rimossi.
* **Ricordi Fissati (`pinned: true`)**: I fatti contrassegnati come fissati sono permanentemente esenti da decadimento ed eliminazione.

---

### Passo 4: Iniezione nel Prompt (Strategia a Doppio Binario)

Come arrivano i ricordi all'interno del prompt dell'agente?

```
È noto l'obiettivo/task specifico dell'utente?
   │
   ├── SÌ ──► Iniezione Contestuale al Task (formatRelevant)
   │          Cerca con BM25 i ricordi rilevanti per il compito attuale.
   │          (Importante: questa ricerca NON altera gli hits, evitando falsa popolarità).
   │
   └── NO ──► Iniezione per Rilevanza Globale (formatForPrompt)
              Inietta i ricordi più importanti e duraturi (Lezioni e Decisioni).
```

Ogni ricordo viene formattato con badge compatti leggibili immediatamente dai modelli leggeri:
```text
- [2026-08-15][LESSON] (security_auditor) Mai disabilitare la verifica dei certificati TLS negli script di produzione.
- [2026-08-16][DECISION] (architect) Tutti i tool personalizzati devono restituire stringhe JSON strutturate.
```

---

## 5. Strumenti Operativi per gli Agenti

Gli agenti interagiscono con la memoria persistente tramite 4 tool nativi:

### `save_memory`
Salva un nuovo fatto, decisione o lezione nella base di conoscenza.
```json
{
  "content": "Windows PowerShell richiede codifica UTF-8 esplicita per gestire caratteri non-ASCII nei pipe.",
  "summary": "Regola codifica UTF-8 in PowerShell",
  "kind": "lesson"
}
```

### `recall_memory`
Cerca nella memoria con algoritmo BM25 e rinfresca la giovinezza del ricordo.
```json
{
  "query": "PowerShell codifica pipe"
}
```

### `update_memory`
Aggiorna o arricchisce un ricordo già salvato.
```json
{
  "id": "mem_j8x19",
  "content": "Regola aggiornata: PowerShell 7 supporta UTF-8 nativamente; Windows PowerShell 5.1 necessita di chcp 65001.",
  "kind": "lesson"
}
```

### `forget_memory`
Elimina definitivamente un ricordo obsoleto o errato specificandone l'ID.
```json
{
  "id": "mem_j8x19"
}
```

---

## 6. Errori di Sviluppo & Lezioni Apprese

La creazione di questo sistema ha fatto emergere diverse insidie pratiche:

### ⚠️ Errore 1: Salvare automaticamente ogni output nella memoria a lungo termine
* **Cosa accadeva**: Nelle prime versioni, ogni risposta di un tool veniva salvata in `memory.json`.
* **La conseguenza**: La memoria si riempiva rapidamente di frammenti di codice e log di errore temporanei, spazzando via le vere decisioni architetturali dopo poche ore.
* **La soluzione**: La memoria deve essere curata. Solo le lezioni esplicite, le convenzioni e i fatti stabili appartengono alla memoria persistente.

### ⚠️ Errore 2: Lasciare che l'iniezione nel prompt ringiovanisse i ricordi
* **Cosa accadeva**: Ogni volta che un ricordo veniva inserito nel prompt iniziale, il suo contatore `hits` aumentava e la sua data veniva aggiornata.
* **La conseguenza**: I primi 10 ricordi inseriti nel progetto diventavano eterni perché venivano inclusi all'avvio di ogni turno, impedendo a nuove lezioni di emergere.
* **La soluzione**: L'iniezione nel prompt usa `touch: false`. Solo le ricerche esplicite e consapevoli degli agenti (`recall_memory`) contano come reale utilizzo.

### ⚠️ Errore 3: Usare la memoria come sostituto del filesystem
* **Cosa accadeva**: Gli agenti tentavano di salvare interi file sorgente con `save_memory`.
* **La conseguenza**: Saturazione immediata del limite di caratteri e peggioramento delle capacità di ragionamento dell'LLM.
* **La soluzione**: Il filesystem del workspace è l'unica sorgente di verità per il codice; la memoria persistente serve esclusivamente per **meta-conoscenza, regole e convenzioni**.
