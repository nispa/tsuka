# Sistema di Memoria Persistente 🧠

<div align="right">
  <p>Read in <a href="memory.md">🇬🇧 English</a></p>
</div>

TSUKA implementa un livello di memoria persistente e condivisa che sopravvive tra sessioni, workspace e agenti. A differenza della cronologia di turno effimera (RAM) e della blackboard limitata a un singolo run, la memoria persistente è progettata per accumulare conoscenza progettuale nel tempo — convenzioni, decisioni architetturali e lezioni apprese — senza richiedere infrastruttura esterna.

> **Sorgente**: [`src/core/memory.ts`](../src/core/memory.ts) · **Tool**: `save_memory`, `recall_memory` · **Archiviazione**: `memory/memory.json`

---

## 1. Panoramica Architetturale

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      MemoryStore (Singleton)                            │
│                                                                         │
│   filePath: memory/memory.json     scope: hash del workspace root       │
│   maxFacts: 200 (configurabile)    reload: mtime-based hot-reload       │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │  run     │  │  fatto   │  │ decisione│  │ lezione  │   ← tipi       │
│  │ weight:0 │  │ weight:1 │  │ weight:2 │  │ weight:3 │                │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                │
│                                                                         │
│  Dedup in scrittura · Ricerca keyword BM25 con stemming                 │
│  Eviction per kind × recenza × hit · Fatti pinned esenti               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Struttura MemoryFact

Ogni fatto memorizzato è un oggetto tipizzato con metadati ricchi:

```typescript
interface MemoryFact {
  id: string;          // ID univoco stabile (base36 timestamp + random)
  content: string;     // Testo completo (max 500 char, imposto da save_memory)
  summary: string;     // Etichetta breve (max 72 char) — ciò che appare nelle liste
  source: string;      // Nome dell'autore ('agent', 'goal_orchestrator', 'user', ecc.)
  timestamp: string;   // Data/ora ISO 8601 di creazione
  scope: string;       // Slug del workspace oppure 'globale'
  kind: MemoryKind;    // 'fatto' | 'decisione' | 'lezione' | 'run'
  tags?: string[];     // Parole chiave opzionali per boost nella ricerca
  pinned?: boolean;    // Se true, esente dall'eviction
  hits: number;        // Incrementato ogni volta che search() recupera questo fatto
  lastUsed: string;    // ISO 8601 dell'ultimo recupero tramite search()
}
```

### Archiviazione su Disco

I fatti sono persistiti in `memory/memory.json` come un array JSON piatto sotto una chiave `facts`. Il file è:

- **Letto** alla costruzione del singleton e riletto ogni volta che il `mtime` cambia (hot-reload per sicurezza multi-processo).
- **Scritto atomicamente** ad ogni `addFact`, `remove`, `clear` o `search` (quando `touch` è abilitato): lo store scrive un file `.tmp` affiancato e poi lo rinomina sul percorso reale. Un rename sullo stesso filesystem è atomico, quindi un'interruzione a metà scrittura non può mai lasciare un `memory.json` scritto a metà — al peggio resta un `.tmp` orfano.
- **Mai azzerato in silenzio se corrotto**: se il JSON non è parsabile, i byte vengono conservati sotto `memory.json.corrupt-<timestamp>` e un warning indica il backup, *poi* lo store riparte vuoto. Perdere la memoria in silenzio per un file troncato sarebbe indistinguibile dal non averne mai avuta.
- **Delimitato** tramite l'hash del workspace root: `scopeFromWorkspaceRoot()` deriva uno slug stabile dal percorso del workspace + hash SHA1, così i fatti di progetti diversi non si mescolano mai.

---

## 2. Quattro Tipi — Durabilità Graduata

Ogni fatto ha un `kind` che determina la sua priorità di eviction. Il sistema tratta i tipi come una scala di durabilità:

| Tipo | Peso | Priorità Eviction | Contenuto Tipico |
|---|---|---|---|
| `run` | 0 | Evictato **per primo** | Note di turno condensate, log di esecuzione intermedi |
| `fatto` | 1 | Evictato secondo | Fatti osservati, snapshot di stato, contenuti di file |
| `decisione` | 2 | Evictato terzo | Scelte architetturali, selezioni API, preferenze tool |
| `lezione` | 3 | Evictato **per ultimo** | Lezioni apprese, anti-pattern, convenzioni permanenti |

**Razionale del design**: Quando un agente dice "abbiamo deciso di usare X invece di Y", quella è una `decisione` — dovrebbe sopravvivere alle note `run` che registravano il confronto. Quando un agente impara "non fare mai Z perché rompe W", quella è una `lezione` — dovrebbe sopravvivere il più a lungo possibile, perché ri-impararla costa token e tempo.

Il tipo `run` viene tipicamente assegnato automaticamente dall'orchestratore degli obiettivi e dalla compressione della cronologia, mentre gli agenti assegnano `fatto`, `decisione` o `lezione` esplicitamente tramite il tool `save_memory`.

---

## 3. Scoping — Isolamento del Workspace con Fallthrough Globale

```
┌───────────────────────────────────────┐
│  GLOBAL_SCOPE ('globale')             │  ← visibile a TUTTI i workspace
│  (lezione, decisione condivisibili)   │
├───────────────────────────────────────┤
│  Scope Workspace (slug derivato SHA1) │  ← visibile solo a questo progetto
│  ('mioprogetto-a1b2c3d4')             │
└───────────────────────────────────────┘
```

### Come Funziona lo Scoping

- **In scrittura**: `addFact()` assegna lo scope del workspace corrente per default, oppure `GLOBAL_SCOPE` se l'agente richiede esplicitamente `global: true`.
- **In lettura**: `visibleFacts()` restituisce solo i fatti che corrispondono allo scope corrente **oppure** a `GLOBAL_SCOPE`.
- **Filtro per source**: `filterBySource()` restringe ulteriormente la visibilità per nome dell'autore, ma **include sempre** i tipi condivisibili (`lezione` e `decisione`) indipendentemente dalla source — perché le lezioni e le decisioni sono intrinsecamente utili a ogni agente.

### Perché Questo Conta

Uno sviluppatore che lavora sul Progetto A non vuole vedere le note temporanee `run` del Progetto B che intasano il suo prompt. Ma se il Progetto B ha imparato una lezione permanente ("la modalità strict di TypeScript rompe X"), ogni progetto dovrebbe beneficiarne. Il sistema scope + tipo realizza questo senza richiedere agli agenti di curare manualmente cosa è condiviso.

---

## 4. Deduplicazione in Scrittura

**Problema**: Senza dedup, ripetere lo stesso fatto dieci volte consumerebbe dieci slot di eviction, a scapito della conoscenza reale.

**Soluzione**: Prima dell'inserimento, `addFact()` calcola una chiave normalizzata:

```typescript
private static factKey(content: string, scope: string): string {
  return `${scope} ${content.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}
```

Se esiste una chiave corrispondente, il fatto entrante viene **fuso** in quello esistente:

- **Tipo**: elevato se il tipo entrante è più duraturo (es. `fatto` → `decisione`)
- **Timestamp**: vince il più recente
- **Hits**: sommati (un fatto ripetuto dieci volte è un fatto che è stato importante dieci volte)
- **Tag**: unione di entrambi gli insiemi
- **Pinned**: `true` si propaga (il pinning è unidirezionale)
- **Summary**: vince il più recente

Il tool `save_memory` rifiuta esplicitamente il contenuto duplicato — un chiamante che salta il summary è esattamente il chiamante a cui bisogna dire di fermarsi e pensarne uno.

---

## 5. Ricerca e Retrieval — Scoring Keyword con Stemming

### Normalizzazione dei Token

Prima del matching, ogni parola passa attraverso la normalizzazione morfologica:

```typescript
function normalizeToken(token: string): string {
  let s = token.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.length > 3) {
    const last = s.charAt(s.length - 1);
    if (last === 's' || FINAL_VOWELS.has(last)) {
      s = s.slice(0, -1);  // rimuove 's' o vocale finale
    }
  }
  return s;
}
```

Questo è stemming leggero: "running" → "runn", "decisions" → "decision", "lessons" → "lesson". Non è Porter o Snowball — è intenzionalmente minimizzato, ottimizzato per il vocabolario tipico dei prompt di ingegneria software.

### Scoring della Ricerca — BM25

`search(query)` suddivide la query in keyword, normalizza ciascuna, scarta le stop-word
funzionali, poi ordina ogni fatto visibile con **BM25** — la funzione di ranking
lessicale standard, implementata in ~20 righe e senza dipendenze:

```
idf(t)   = ln(1 + (N - n(t) + 0.5) / (n(t) + 0.5))      N = fatti visibili, n(t) = fatti che contengono t
score(f) = Σ  idf(t) × ( tf(t,f) × (k1 + 1) )
           t∈q          -----------------------------------------
                        tf(t,f) + k1 × (1 - b + b × len(f)/avgLen)

k1 = 1.2   (saturazione della frequenza di termine)
b  = 0.75  (normalizzazione per lunghezza del documento)
```

Dalla formula discendono tre proprietà, ed è per queste che BM25 ha sostituito il precedente
scoring `matches × 1000 + bonus di coverage`:

- **IDF — la rarità è peso.** Un token che tutti i fatti condividono non porta quasi segnale;
  un token presente in un fatto su cento domina il ranking. È tutto il punto: una query trova
  risposta grazie alle sue parole *discriminanti*, non a quelle più lunghe.
- **Saturazione della frequenza (`k1`).** Ripetere una parola aiuta, ma con rendimenti
  decrescenti. Dieci occorrenze non valgono dieci volte una — un fatto non può vincere
  imbottendosi di keyword.
- **Normalizzazione per lunghezza (`b`).** Un fatto breve che contiene un token batte uno
  lungo che contiene lo stesso token: allungare il testo non viene premiato.

Il **matching dei token** va oltre l'uguaglianza esatta: un token della query corrisponde
anche quando è un **prefisso** di un token del fatto di lunghezza sufficiente (`mem` →
`memoria`, `corsi` → `corso`). Viene usata solo la direzione in avanti — la direzione inversa
(`TypeScript` che matcherebbe `type`) è esattamente il falso positivo OR che
`test_memory_scope.ts` documenta come rumore, non recall. Il prefix match alimenta sia la
frequenza di termine di un fatto sia la frequenza documentale dietro al suo IDF.

Le **stop-word** (`the`, `di`, `per`, `che`, … in IN+IT) sono ignorate dal lato query, così
`il server usa postgres` e `server postgres` sono query ugualmente specifiche. Le stop-word
nel contenuto di un fatto non vengono mai rimosse — sono il suo contenuto, non rumore.

**Hit e recency restano terziari**: intervengono solo a parità di punteggio BM25. I fatti con
score zero (nessun token della query corrisposto) vengono scartati invece di essere restituiti
con un punteggio debole, così una query non pertinente non restituisce nulla invece che rumore.

### Auto-Tag

Quando il chiamante **non** passa tag, `addFact` deriva fino a 5 tag automatici dal contenuto:
i primi token significativi (niente stop-word, niente radici di 1–2 caratteri),
conservando la parola originale ma deduplicando sulla forma normalizzata. Gli auto-tag
confluiscono nello stesso haystack `content + tags` usato in ricerca.

### Meccanica del Touch

Quando `touch: true` (default), ogni fatto restituito da `search()` riceve:
- `hits += 1`
- `lastUsed = now`
- `useOrder` aggiornato

Questo crea un ciclo di feedback: i fatti frequentemente recuperati accumulano hit, che alza il loro score di eviction, che li fa sopravvivere più a lungo. Il sistema impara cosa conta in base a ciò che gli agenti effettivamente cercano.

---

## 6. Motore di Eviction — Retention Basata su Score con Decadimento Temporale

Quando `facts.length > maxFacts`, il store evicta il fatto non-pinned con il **score più
basso**. Prima della competizione generale c'è un **passaggio di quota run**: le note
`run` possono occupare al massimo il 30% di `maxFacts` durante un overflow, così un'esplosione
di log di turno condensati non può mai affamare i tipi durevoli. La formula generale:

```typescript
evictionScore(fact, recencyRank, totalCandidates) {
  const hitsScore  = Math.min(fact.hits, 20) / 20;
  const kindScore  = KIND_WEIGHT[fact.kind] / 3;       // normalizzato a 0..1
  const timeScore  = retentionDecay(fact) * 10;        // decay esponenziale, vedi sotto
  const recencyScore = recencyRank / (totalCandidates - 1) * 2;
  return kindScore * 100 + timeScore + recencyScore + hitsScore;
}
```

**Decadimento temporale**: il valore di retention di un fatto erode esponenzialmente
con un'**half-life per tipo** misurata da `lastUsed`:

| Kind | Half-life | Significato |
|---|---|---|
| `run` | 2 ore | scoped al turno, svanisce in fretta |
| `fatto` | 48 ore | conoscenza generale |
| `decisione` | 7 giorni | decisioni di progetto |
| `lezione` | 30 giorni | insegnamenti duraturi |

Ogni successo di `search()` rinfresca `lastUsed`, così un fatto riusato è di nuovo giovane. I
fatti pinned sono esentati dal decay (e dal set dei candidati), e `lezione` (100) supera
sempre `run` (0).

**Pesi delle componenti**:

| Componente | Intervallo | Peso | Scopo |
|---|---|---|---|
| `kindScore × 100` | 0–100 | Dominante | Assicura che `lezione` superi sempre `run` |
| `timeScore` | 0–10 | Secondario | 9 ore e 9 giorni ora differiscono — tempo effettivo, non solo ordine relativo |
| `recencyScore` | 0–2 | Tie-break | Tra tipi uguali e stessa freschezza, l'ordine di ultimo uso |
| `hitsScore` | 0–1 | Terziario | I fatti frequentemente recuperati ricevono un piccolo bonus |

**Cosa viene evictato**: Il fatto con il composito score più basso. In pratica:
1. Le note `run` oltre la quota, e le `run` con pochi hit (score ~0–10)
2. I vecchi fatti `fatto` senza hit seguono (score ~10–15)
3. I fatti `decisione` sopravvivono più a lungo (score ~20–30)
4. I fatti `lezione` sopravvivono più a lungo di tutti (score ~30–100+)

**I fatti pinned** non vengono mai evictati — sono esclusi dal set dei candidati.

---

## 7. Iniezione nei Prompt — Pipeline Dual-Ranking

TSUKA usa due metodi diversi per iniettare la memoria nei prompt, a seconda del contesto.

### `formatForPrompt(limit, maxChars, sources)` — Default

Usato quando non è disponibile un task specifico (es. assemblaggio del prompt iniziale).

1. Classifica tutti i fatti visibili per **valore di retention** (stessa formula dell'eviction)
2. Seleziona i top N fatti (default: 10)
3. Formatta ciascuno come `- [quando][BADGE] (source) contenuto`
4. Limita a `maxChars` (default: 600)
5. Aggiunge un hint su `recall_memory` se alcuni fatti sono stati omessi

**Badge**: lo slot `[quando]` è `PINNED` per i fatti pinned, altrimenti la data
compatta `YYYY-MM-DD`; lo slot `[BADGE]` è `LESSON` / `DECISION` / `FACT` / `RUN` in base al
kind del fatto. I piccoli modelli locali sono pessimi a inferire tipo e freschezza da una
frase nuda — il badge dà loro lo stesso segnale a colpo d'occhio, e la riga di memoria resta
una singola riga scandibile.

**Perché ranking per retention?** I fatti più importanti da proteggere dall'eviction sono
anche i più importanti da mostrare in un prompt. Un fatto `lezione` con 15 hit dovrebbe
apparire prima di una nota `run` con 0 hit.

### `formatRelevant(taskText, limit, maxChars, sources)` — Consapevole del Task

Usato quando è disponibile il testo del task utente (es. orchestratore `/goal`, `spawn_agent`).

1. **Cerca** nella memoria con BM25 (§5) contro `taskText`
2. Formatta i fatti corrispondenti con lo stesso template `- [quando][BADGE] (source) contenuto`
3. Limita a `maxChars`

**Trade-off**: Usa la rilevanza lessicale piuttosto che il valore di retention, quindi i fatti "più importanti" (per score di eviction) potrebbero non essere i "più rilevanti" (per punteggio BM25). Il sistema privilegia la **rilevanza contestuale** rispetto all'**importanza generale** quando un task specifico è noto.

**L'iniezione non conta come uso**: questa ricerca gira con `touch: false`, quindi costruire un prompt non gonfia mai `hits` né aggiorna `lastUsed`. Lo fa solo una chiamata deliberata a `recall_memory`. Altrimenti ogni fatto iniettato a ogni turno risulterebbe perennemente "popolare" e il segnale d'uso dietro alla retention non significherebbe più nulla.

### Quando Viene Usato Ciascuno

```
L'utente fornisce il testo del task? ──Sì──► formatRelevant(taskText)
         │                                      (fatti rilevanti per keyword)
         No
         │
         ▼
    formatForPrompt()                    (fatti classificati per retention)
```

---

## 8. Tool — API per gli Agenti

### `save_memory` (riskLevel: SAFE)

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `content` | string | sì | Testo completo del fatto (max 500 char) |
| `summary` | string | no | Etichetta breve (max 72 char — come un subject di commit); derivata automaticamente dal contenuto se omessa |
| `kind` | string | no | Token kind inglese: `facts` / `run` / `decision` / `lesson` (default `facts`) |
| `global` | boolean | no | Se `true`, salva in `GLOBAL_SCOPE` |

**Comportamento**: Aggiunge il fatto dopo aver mappato il token kind inglese sul kind interno
dello store, deduplica contro gli entry esistenti, evicta se supera la capacità, persiste su
disco.

**Perché il summary è opzionale?** È passato per tre fasi, e quella intermedia vale la pena
conoscerla. All'inizio il summary non esisteva affatto: gli elenchi troncavano `content` a ~40
caratteri e, poiché la maggior parte dei fatti condivide un prefisso lungo (`[Goal] `,
`AGENTE: `, …), la parte che avrebbe distinto due voci era esattamente quella tagliata — ogni
riga sembrava uguale alle altre. La prima correzione rese `summary` **obbligatorio**, costringendo
il chiamante a scrivere un'etichetta distinta. Funzionava, ma rifiutava salvataggi per il resto
validi per via di un campo mancante. Oggi la derivazione (`deriveSummary`) è deterministica e
riconosce per primi i formati propri del sistema, così un chiamante che omette il summary ottiene
comunque un'etichetta significativa invece di un troncamento. Chi ne scrive una propria viene
semplicemente limitato a 72 caratteri a valle — mai una seconda policy di rifiuto.

### `recall_memory` (riskLevel: SAFE)

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `query` | string | no | Parole chiave da cercare (ranking BM25, prefix match) |
| `limit` | number | no | Max risultati (default 10, max 50) |

**Comportamento**: Se `query` è fornita, esegue ricerca keyword. Altrimenti, restituisce i fatti più recenti. Incrementa `hits` e aggiorna `lastUsed` per tutti i fatti restituiti (a meno che `touch` non sia `false`).

### `update_memory` (riskLevel: SAFE)

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `id` | string | sì | Id del fatto da modificare (da `save_memory` / `recall_memory`) |
| `content` | string | no | Nuovo testo del fatto (max 500 char) |
| `summary` | string | no | Nuova etichetta breve |
| `kind` | string | no | Token kind inglese, come in `save_memory` |
| `tags` | string[] | no | Tag extra uniti a quelli esistenti del fatto |

**Comportamento**: Modifica il fatto in place, rinfresca `timestamp`/`lastUsed`,
riesegue la regola di dedup (una modifica che rende un fatto duplicato di un altro li
collassa invece di accumularli) e persiste. Risponde con JSON `{ ok, id, summary, kind,
content, tags }`.

### `forget_memory` (riskLevel: SAFE)

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `id` | string | sì | Id del fatto da rimuovere |

**Comportamento**: Rimuove definitivamente il fatto e risponde con JSON
`{ ok, removed: id }`. Lancia un errore esplicito quando l'id non esiste.

---

## 9. Configurazione

| Impostazione | Default | Descrizione |
|---|---|---|
| `memoryMaxFacts` | 200 | Numero massimo di fatti prima che scatti l'eviction |
| `memoryMaxChars` | 600 | Numero massimo di caratteri iniettati nel system prompt |

Manopole comportamentali (non chiavi di configurazione, parte del motore):

- **Decadimento temporale**: half-life per tipo (2 h / 48 h / 7 g / 30 g), vedi §6 — rileggere un fatto lo rinfresca.
- **Quota run**: i fatti `run` possono riempire al massimo il 30% di `maxFacts` durante un overflow, §6.

Configurabile via `tsuka.config.json`:

```json
{
  "memoryMaxFacts": 200,
  "memoryMaxChars": 600
}
```

---

## 10. Il Panorama della Memoria — Dove Si Colloca TSUKA

> Questo progetto è uno strumento didattico, e questa sezione è la lezione. La memoria degli
> agenti non è una cosa sola: è una **scala**, e ogni livello scambia determinismo e
> auto-sufficienza con capacità. TSUKA si ferma a un livello specifico **apposta** — lo scopo di
> questa sezione è mostrare l'intera scala, indicare quale livello abbiamo scelto e perché, e
> nominare i limiti che accettiamo.

### La Scala

| Livello | Approccio | Sistemi rappresentativi | Cosa aggiunge rispetto al livello sotto | Cosa costa |
|---|---|---|---|---|
| 1 | Trascrizione grezza | LangChain `ConversationBufferMemory` | Richiamo verbatim | Limitato dalla context window; dimentica man mano che scorre |
| 2 | Riepilogo a scorrimento | LangChain `ConversationSummaryMemory` | Condensa la trascrizione | Perde dettagli; il riepilogo è generato dal modello |
| 3 | **Fatti lessicali + scoring** | **TSUKA** | Persistenza cross-sessione, dedup, eviction, time-decay | Abbina *parole*, non *significato* |
| 4 | Retrieval vettoriale / semantico | RAG, LangChain vector retriever, LlamaIndex | Recupera per *significato* (sinonimi, parafrasi) | Modello di embedding + vector store; scoring opaco |
| 5 | Gerarchia di memoria + self-editing | MemGPT / Letta | Il modello scrive, modifica e dimentica la propria memoria | LLM nel loop; meno deterministico |
| 6 | Knowledge graph temporale | Zep | Entità + relazioni + tempo; decay e query temporali | Graph store; infrastruttura più pesante |
| 7 | Grafo gestito + semantico | Mem0 | Embedding + grafo + estrazione entità, spesso SaaS | Dipendenza esterna |

Ogni livello è un sovrainsieme dell'idea sottostante, e ciascuno è ciò che un sistema reale fa
in produzione.

### Cosa comprano i livelli più alti che TSUKA non ha

- **Retrieval semantico** (livello 4+). "Abbiamo deciso di usare React" e "scelta del framework
  frontend" non condividono alcun token, quindi `search()` di TSUKA non li collegherà; un
  modello di embedding sì, perché significano la stessa cosa. Questo è il divario più grande.
- **Ragionamento sulle relazioni** (livello 6+). "Il modulo A dipende da B" e "B è stato rimosso"
  sono due fatti scollegati in uno store piatto; un knowledge graph attraversa l'arco e deduce
  "A è ora rotto". TSUKA archivia fatti, non archi.
- **Self-editing autonomo** (livello 5). Letta mantiene la propria memoria: decide cosa
  promuovere nel system prompt e cosa archiviare. TSUKA espone `update_memory`/`forget_memory`
  (§8) e lascia la *decisione* al modello — un primo, deliberato passo su questo livello, ma non
  il loop completo.
- **Query temporali** (livello 6). Zep può rispondere a "quando siamo passati da X a Y?" perché il
  tempo è una dimensione di prima classe. TSUKA ha timestamp e decay con half-life (§6), ma
  nessun indice sul tempo.

### Perché TSUKA si ferma al livello 3

| Fattore | Livello 3 (lessicale, questo repo) | Livello 4+ (vettoriale / grafo / gestito) |
|---|---|---|
| **Dipendenze** | Zero (solo `node:fs`) | Modello di embedding + store vettoriale/grafo |
| **Latenza e costo** | 0ms, CPU, nessun token | Chiamata di embedding + lookup indice |
| **Determinismo** | Totalmente ispezionabile, `grep`-abile | Dipendente dal modello, opaco |
| **Offline / local-first** | Sì, per costruzione | Spesso richiede un servizio o un modello più pesante |
| **Modalità di guasto** | Perde sinonimi e parafrasi | Deriva semantica silenziosa, più difficile da debuggare |

Per un harness locale che esegue modelli piccoli (<30B) senza servizi esterni, il livello 3 è il
**più alto raggiungibile senza rinunciare al determinismo**. Questo è il trade-off — e nominarlo
è il punto: un vector store non è "migliore", è *diverso*, e compra il recall semantico al costo
di opacità e dipendenza.

### Cosa il livello 3 fa comunque bene

Due idee sono prese in prestito dai livelli più alti e implementate senza il loro costo:

- **Il time decay** è l'intuizione centrale del livello 6 (i fatti erodono con l'età), ridotta a
  una half-life per tipo (§6).
- **La retention guidata dall'uso** — il ciclo `hits` + `lastUsed` — fa sì che i fatti che gli
  agenti cercano davvero diventino più duraturi. Il sistema si auto-organizza dall'atto di
  cercare, senza intelligenza esterna (§5, Meccanica del Touch).

---

## 11. Punti di Integrazione

La memoria è intrecciata in tutto il ciclo di vita di TSUKA:

| Componente | Come Usa la Memoria |
|---|---|
| **`agent.ts`** | Persiste la cronologia compressa del turno come fatti `run`; salva le tracce di ragionamento |
| **`goal.ts`** | Memorizza i riepiloghi dell'orchestratore degli obiettivi come `fatto` con source `goal_orchestrator` |
| **`spawnAgent.ts`** | Passa `memorySources` ai sub-agenti per visibilità scoped |
| **`shared.ts` (CLI)** | Inietta la memoria nel system prompt via `formatForPrompt` / `formatRelevant` |
| **Modal TUI** | Il modale ispettore della memoria elenca i fatti con tipo, source e data |
| **Comando `/memory`** | Comando CLI per elencare, cercare e cancellare la memoria persistente |
| **`save_memory`/`recall_memory`/`update_memory`/`forget_memory`** | I quattro tool che gli agenti usano per leggere e scrivere lo store |

---

## 12. Un Percorso di Apprendimento Oltre Questo Design

La scala del §10 è anche un programma di studi. Se vuoi portare TSUKA su di un livello alla
volta, questa è la rotta, ordinata per valore/costo:

> **Il passo 1 di questa lista è già stato fatto.** La ponderazione BM25 / TF-IDF è quella che
> il §5 ora documenta — ancora lessicale, ancora zero dipendenze, ancora deterministica, ma con
> ogni token pesato per quanto è *discriminante* nell'intero store. Quella che segue è la rotta
> da qui in avanti.

1. **Embedding locali, opzionali (livello 4).** Aggiungere un percorso di embedding opzionale con
   un modello locale (es. `nomic-embed-text` via Ollama) e similarità coseno. Mantiene il sistema
   offline; trasforma il retrieval da "spelling" a "significato".
2. **Retrieval ibrido (il meglio di 3 + 4).** Unire i ranking lessicale e semantico con la
   reciprocal rank fusion, la ricetta standard del RAG di produzione, così un match per sinonimo
   e un match per keyword esatta emergono entrambi.
3. **Knowledge graph (livello 6).** Archiviare entità e relazioni come archi, abilitando il
   ragionamento multi-hop "cosa dipende da cosa".
4. **Memoria self-editing (livello 5).** Una divisione stile Letta tra una "core" memory piccola
   tenuta nel system prompt e uno store "archiviale" che il modello gestisce da sé.

Ogni passo è una lezione a sé stante; l'harness esiste per insegnarle, non per raggiungere la
cima.

---

## Sintesi

Il sistema di memoria di TSUKA è progettato attorno a tre principi:

1. **Gerarchia di durabilità**: non tutti i fatti sono uguali — le lezioni sopravvivono alle decisioni, che sopravvivono alle osservazioni, che sopravvivono alle note di sessione
2. **Deduplicazione in scrittura**: un fatto detto dieci volte è un fatto che è stato importante dieci volte, non dieci fatti
3. **Retention guidata dall'uso**: l'atto di recuperare un fatto lo rende più duraturo, creando un archivio di conoscenza che si auto-organizza

Questo non è un database vettoriale generico. Letto con il §10 e il §12, è una sosta deliberata
su una scala più ampia: un layer di memoria *lessicale*, *zero-dipendenza* e *deterministico* —
il livello più alto che non sacrifica l'ispezionabilità — e una mappa dei livelli sopra di esso
(retrieval semantico, knowledge graph, memoria self-editing) che altri sistemi già occupano.
