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
│  Dedup in scrittura (T14.15) · Ricerca keyword con stemming            │
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
- **Scritto** atomicamente ad ogni `addFact`, `remove`, `clear` o `search` (quando `touch` è abilitato).
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

## 4. Deduplicazione in Scrittura (T14.15)

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

### Scoring della Ricerca

`search(query)` suddivide la query in keyword, normalizza ciascuna, scarta le stop-word
funzionali, poi punteggia ogni fatto visibile (taratura T15.1 per i modelli locali):

```
coverage        = token significativi della query corrisposti / totale token significativi
hitsScore       = min(hits, 20) / 20
score           = matches × 1000  +  (coverage ≥ 0.75 ? 500 : 0)  +  hitsScore
```

Il **matching dei token** va oltre l'uguaglianza esatta: un token della query corrisponde
anche quando è un **prefisso** di un token del fatto di lunghezza sufficiente (`mem` →
`memoria`, `corsi` → `corso`). Viene usata solo la direzione in avanti — la direzione inversa
(`TypeScript` che matcherebbe `type`) è esattamente il falso positivo OR che
`test_memory_scope.ts` documenta come rumore, non recall.

Le **stop-word** (`the`, `di`, `per`, `che`, … in IN+IT) sono ignorate dal lato query, così
`il server usa postgres` e `server postgres` sono query ugualmente specifiche. Le stop-word
nel contenuto di un fatto non vengono mai rimosse — sono il suo contenuto, non rumore.

Il **boost di coverage**: un fatto che soddisfa ≥ 75% dei token significativi riceve un bonus
secondario, così un fatto che corrisponde quasi tutto si classifica sopra uno che corrisponde
una sola parola. Hit e recency restano fattori terziari.

I risultati sono restituiti dal più recente quando gli score sono uguali, favorendo i fatti
recentemente acceduti.

### Auto-Tag

Quando il chiamante **non** passa tag, `addFact` deriva fino a 5 tag automatici dal contenuto
(T15.4): i primi token significativi (niente stop-word, niente radici di 1–2 caratteri),
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
basso**. Prima della competizione generale (T15.5) c'è un **passaggio di quota run**: le note
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

**Decadimento temporale (T15.2)**: il valore di retention di un fatto erode esponenzialmente
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

**Badge (T15.8)**: lo slot `[quando]` è `PINNED` per i fatti pinned, altrimenti la data
compatta `YYYY-MM-DD`; lo slot `[BADGE]` è `LESSON` / `DECISION` / `FACT` / `RUN` in base al
kind del fatto. I piccoli modelli locali sono pessimi a inferire tipo e freschezza da una
frase nuda — il badge dà loro lo stesso segnale a colpo d'occhio, e la riga di memoria resta
una singola riga scandibile.

**Perché ranking per retention?** I fatti più importanti da proteggere dall'eviction sono
anche i più importanti da mostrare in un prompt. Un fatto `lezione` con 15 hit dovrebbe
apparire prima di una nota `run` con 0 hit.

### `formatRelevant(taskText, limit, maxChars, sources)` — Consapevole del Task

Usato quando è disponibile il testo del task utente (es. orchestratore `/goal`, `spawn_agent`).

1. **Cerca** nella memoria usando lo scoring keyword contro `taskText`
2. Formatta i fatti corrispondenti con lo stesso template `- [quando][BADGE] (source) contenuto`
3. Limita a `maxChars`

**Trade-off**: Usa la rilevanza keyword piuttosto che il valore di retention, quindi i fatti "più importanti" (per score di eviction) potrebbero non essere i "più rilevanti" (per corrispondenza keyword). Il sistema privilegia la **rilevanza contestuale** rispetto all'**importanza generale** quando un task specifico è noto.

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
| `summary` | string | no | Etichetta breve (max 72 char — come un subject di commit); derivata automaticamente dal contenuto se omessa (T15.3) |
| `kind` | string | no | Token kind inglese: `facts` / `run` / `decision` / `lesson` (default `facts`) |
| `global` | boolean | no | Se `true`, salva in `GLOBAL_SCOPE` |

**Comportamento**: Aggiunge il fatto dopo aver mappato il token kind inglese sul kind interno
dello store, deduplica contro gli entry esistenti, evicta se supera la capacità, persiste su
disco.

**Perché il summary ora è opzionale (T15.3)?** Prima di T14.20 il sistema derivava
automaticamente i summary e produceva entry dall'aspetto identico; T14.20 rese `summary`
obbligatorio per forzare etichette distinte. T15.3 allenta: la derivazione (`deriveSummary`)
è deterministica e riconosce prima i formati propri del sistema, così un chiamante che
salta il summary ottiene comunque un'etichetta significativa — mentre chi ne scrive una (anche
troppo lunga) viene limitato a valle a 72 char, mai una seconda policy di rifiuto.

### `recall_memory` (riskLevel: SAFE)

| Parametro | Tipo | Obbligatorio | Descrizione |
|---|---|---|---|
| `query` | string | no | Parole chiave da cercare (scoring di coverage, prefix match) |
| `limit` | number | no | Max risultati (default 10, max 50) |

**Comportamento**: Se `query` è fornita, esegue ricerca keyword. Altrimenti, restituisce i fatti più recenti. Incrementa `hits` e aggiorna `lastUsed` per tutti i fatti restituiti (a meno che `touch` non sia `false`).

### `update_memory` (riskLevel: SAFE) — T15.7

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

### `forget_memory` (riskLevel: SAFE) — T15.7

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

## 10. Razionale Architetturale — Perché Non la Ricerca Vettoriale?

La domanda più comune sul design della memoria di TSUKA: perché usare la ricerca keyword con un file JSON piatto invece di embedding, database vettoriali o retrieval basato su LLM?

### La Scelta Pragmatica

| Fattore | JSON + Keyword | Vector DB / Embeddings |
|---|---|---|
| **Latenza** | 0ms (scansione in-memory) | 50–200ms (lookup indice + similarità) |
| **Dipendenze** | Zero (solo `fs` di Node.js) | Richiede modello per embedding + vector store |
| **Costo** | Zero (gira su CPU) | Costo in token per ogni chiamata di embedding |
| **Affidabilità** | Deterministico, ispezionabile | Dipendente dal modello, scoring opaco |
| **Debuggabilità** | `grep` sul file JSON | Richiede tooling per vector DB |
| **Local-first** | Funziona offline, senza rete | Può richiedere servizio di embedding esterno |

### Quando Questo Trade-off Cede

L'approccio keyword ha limitazioni note:

- **Sinonimia**: "deploy" e "ship" non matcheranno l'uno l'altro senza sovrapposizione di stemming. Il
  prefix matching e il filtro delle stop-word di T15.1 restringono questo divario per i piccoli modelli
  locali target di TSUKA, senza il costo o l'opacità degli embedding.
- **Distanza semantica**: "dobbiamo usare React" e "decisione sul framework frontend" sono correlati ma non condividono keyword
- **Scala**: oltre ~500 fatti, la scansione lineare diventa notabile (anche se l'eviction tiene questo sotto controllo)

Per un harness CLI locale che targetta modelli sotto i 30B parametri, queste limitazioni sono accettabili. L'obiettivo non è costruire un knowledge graph — è ricordare che "usiamo le tab non gli spazi" e "la chiave API va in .env, mai nel codice" senza doverli reimparare ogni sessione.

### Il Vantaggio del Ciclo di Feedback

Il ciclo `hits` + `lastUsed` significa che il sistema si auto-organizza: i fatti che gli agenti
effettivamente recuperano diventano più duraturi, mentre i fatti che nessuno cerca gradualmente
svaniscono. Il decadimento con half-life di T15.2 traduce "gradualmente svaniscono" da un
ordinamento relativo in un orologio reale: un fatto intatto da una settimana è obiettivamente
stantio, non solo dietro ai più freschi. Questo è un segnale di importanza empirico, guidato
dall'uso, che non richiede intelligenza esterna — solo l'atto di cercare.

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

## Sintesi

Il sistema di memoria di TSUKA è progettato attorno a tre principi:

1. **Gerarchia di durabilità**: non tutti i fatti sono uguali — le lezioni sopravvivono alle decisioni, che sopravvivono alle osservazioni, che sopravvivono alle note di sessione
2. **Deduplicazione in scrittura**: un fatto detto dieci volte è un fatto che è stato importante dieci volte, non dieci fatti
3. **Retention guidata dall'uso**: l'atto di recuperare un fatto lo rende più duraturo, creando un archivio di conoscenza che si auto-organizza

Questo non è un database vettoriale generico. È un layer di memoria purpose-built, zero-dipendenza e deterministico, ottimizzato per le specifiche esigenze degli agenti LLM locali: veloce, ispezionabile e resiliente tra le sessioni.
