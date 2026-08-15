import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { homePath } from './apphome';
import { ConfigManager } from './config';

/** Tipo di fatto memorizzato (T6.1): guida l'eviction a punteggio — 'run' è il primo
 * a cadere (scarti di turno condensati), 'lezione' l'ultimo (insegnamenti duraturi). */
export type MemoryKind = 'fatto' | 'decisione' | 'lezione' | 'run';

const VALID_KINDS: MemoryKind[] = ['fatto', 'decisione', 'lezione', 'run'];
function isValidKind(k: any): k is MemoryKind {
  return typeof k === 'string' && (VALID_KINDS as string[]).includes(k);
}

/** Peso per kind nell'eviction: più alto = sopravvive più a lungo. */
const KIND_WEIGHT: Record<MemoryKind, number> = { run: 0, fatto: 1, decisione: 2, lezione: 3 };

/** Scope riservato ai fatti visibili da ogni workspace. */
export const GLOBAL_SCOPE = 'globale';

/** Kind condivisibili per costruzione (T8.2): visibili a qualunque agente anche
 * quando il filtro per source è attivo, perché non sono scarti di turno ma
 * insegnamenti/decisioni pensati per essere riusati da chiunque. */
const SHAREABLE_KINDS: MemoryKind[] = ['lezione', 'decisione'];

/** Opzioni di search() (T8.3/T8.4): additive, tutte opzionali — comportamento
 * invariato quando omesse (nessuna regressione per i chiamanti esistenti). */
export interface SearchOptions {
  /** Filtro per agente in lettura (T8.2), vedi filterBySource(). */
  sources?: string[];
  /** Se false, la ricerca non aggiorna hits/lastUsed né scrive su disco (T8.4).
   * Default true: recall_memory continua a "toccare" i fatti restituiti. */
  touch?: boolean;
}

/**
 * Un singolo ricordo nella memoria condivisa.
 */
export interface MemoryFact {
  id: string;
  content: string;
  source: string;    // chi ha salvato il fatto (es. nome dell'agente o 'utente')
  timestamp: string; // ISO 8601
  scope: string;      // slug della workspace di origine, oppure GLOBAL_SCOPE
  kind: MemoryKind;    // categoria del fatto, guida l'eviction (default 'fatto')
  tags?: string[];
  pinned?: boolean;    // se true, non viene mai espulso dall'eviction
  hits: number;        // quante volte il fatto è stato restituito da search()
  lastUsed: string;    // ISO 8601, ultima volta creato o restituito da search()
}

/** Parametri opzionali additivi per addFact (T6.1): non cambiano la firma storica
 * (content, source), si aggiungono come terzo argomento opzionale. */
export interface AddFactOptions {
  scope?: string;
  kind?: MemoryKind;
  tags?: string[];
  pinned?: boolean;
}

interface MemoryFile {
  facts: MemoryFact[];
}

/**
 * Deriva uno slug stabile per lo scope a partire dalla workspace root (T6.1):
 * basename leggibile + hash breve del percorso assoluto normalizzato, così due
 * cartelle con lo stesso nome ma path diverso non collidono, e il file di memoria
 * non espone il percorso completo del filesystem dell'utente.
 */
export function scopeFromWorkspaceRoot(root: string): string {
  const normalized = path.resolve(root).toLowerCase();
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  const base = path.basename(normalized).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 24) || 'ws';
  return `${base}-${hash}`;
}

/** Vocali usate per riconoscere una desinenza finale italiana (singolare/plurale:
 * -o/-i, -a/-e, ecc.) da troncare nella normalizzazione morfologica di search() (T8.3). */
const FINAL_VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * Normalizza una singola parola per il confronto in search() (T8.3): minuscolo,
 * accenti rimossi, e — solo per parole di almeno 4 caratteri, per non mutilare
 * acronimi/parole corte (API, SQL, ecc.) — un solo carattere finale troncato se è
 * una vocale o una 's' (plurali italiani tipo corsi/corso, prestiti tipo badge/badges).
 * Normalizzazione a costo zero, nessuna libreria di stemming: non è uno stemmer
 * linguistico, è un troncamento euristico dichiarato fuori scope come tale in T8.3.
 */
function normalizeToken(token: string): string {
  // NFD scompone le lettere accentate in lettera-base + segno diacritico combinante
  // (range Unicode ̀-ͯ): rimuoverli isola la lettera base (è → e).
  let s = token.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s.length > 3) {
    const last = s.charAt(s.length - 1);
    if (last === 's' || FINAL_VOWELS.has(last)) {
      s = s.slice(0, -1);
    }
  }
  return s;
}

/** Normalizza un testo intero parola per parola (T8.3): usato per l'haystack di
 * search(), così un fatto con "corso" viene trovato dalla query "corsi" e uno con
 * "badges" dalla query "badge", senza modificare il contenuto salvato su disco —
 * la normalizzazione avviene solo al momento del confronto in ricerca. */
function normalizeText(text: string): string {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .map(normalizeToken)
    .join(' ');
}

/**
 * MemoryStore: memoria condivisa e persistente tra le sessioni.
 *
 * - I fatti sono salvati in `memory/memory.json` e sopravvivono al riavvio.
 * - Accesso tramite singleton con ricaricamento automatico se il file cambia su disco
 *   (pattern mtime già usato per schemi tool e config JSON).
 * - Condivisa per costruzione: tutti gli agenti (chat principale, /call, /team)
 *   leggono e scrivono lo stesso archivio.
 * - **Lettura scoped per workspace (T6.1)**: ogni istanza appartiene a uno `scope`
 *   (di norma derivato dalla workspace root corrente). Le operazioni di lettura
 *   (getRecent, search, count, formatForPrompt, formatRelevant) vedono solo i fatti
 *   del proprio scope più quelli `GLOBAL_SCOPE`. remove()/clear() restano globali
 *   per id/azzeramento completo, coerenti con l'uso amministrativo esistente
 *   (/forget, pulizia test).
 */
export class MemoryStore {
  private static instance: MemoryStore | null = null;

  private filePath: string;
  private facts: MemoryFact[] = [];
  private loadedMtime = -1;
  private maxFacts: number;
  private scope: string;

  // Ordine logico di freschezza d'uso (creazione o ultimo recall via search()),
  // per id — un contatore monotono, non un timestamp. Necessario per l'eviction
  // a punteggio: la risoluzione dell'orologio di sistema (grezza su Windows, ~15ms)
  // rende due `lastUsed` ravvicinati indistinguibili o addirittura invertiti quando
  // creazione e recall avvengono a raffica (comune nei workflow automatici e nei
  // test) — un contatore intero non ha questo problema. Vive solo in memoria di
  // processo: dopo un reload riparte dall'ordine dell'array (che riflette comunque
  // l'ordine di creazione/salvataggio), `lastUsed` resta il campo persistito e
  // "leggibile" per l'utente/i tool.
  private useOrder = new Map<string, number>();
  private useSeq = 0;

  /** Registra `factId` come "appena usato" (creazione o recall): sposta il suo
   * rango di freschezza in cima, indipendentemente dalla risoluzione dell'orologio. */
  private touch(factId: string): void {
    this.useOrder.set(factId, this.useSeq++);
  }

  /**
   * @param filePath Percorso del file di memoria (default: memory/memory.json nella app home,
   *   oppure `TSUKA_MEMORY_FILE` se impostata — vedi sotto)
   * @param maxFacts Numero massimo di fatti conservati (oltre il limite, eviction a punteggio)
   * @param scope Scope di questa istanza (default: slug derivato da ConfigManager.getWorkspaceRoot())
   */
  constructor(filePath?: string, maxFacts: number = 200, scope?: string) {
    // T6.5: isolamento della suite di test dalla memoria reale dell'utente. Un solo punto
    // di override, letto solo quando il chiamante non passa un filePath esplicito: i test
    // che costruiscono MemoryStore con un file temporaneo (es. test_memory_scope.ts) non
    // sono toccati. `tests/run_tests.ts` imposta TSUKA_MEMORY_FILE su un file in una cartella
    // temporanea prima di lanciare le suite (tutte figlie via spawnSync, ereditano l'env) e
    // lo ripulisce alla fine. Fuori dai test la variabile non è impostata: comportamento
    // identico a prima (memory/memory.json nella app home).
    const envOverride = process.env.TSUKA_MEMORY_FILE;
    this.filePath = filePath
      ?? (envOverride && envOverride.trim().length > 0 ? path.resolve(envOverride.trim()) : homePath('memory', 'memory.json'));
    this.maxFacts = Math.max(1, maxFacts);
    this.scope = scope && scope.trim().length > 0
      ? scope.trim()
      : scopeFromWorkspaceRoot(new ConfigManager().getWorkspaceRoot());
    this.load();
  }

  /**
   * Istanza condivisa del processo. Ricarica il file se è cambiato su disco.
   */
  static getInstance(): MemoryStore {
    if (!MemoryStore.instance) {
      MemoryStore.instance = new MemoryStore();
    }
    MemoryStore.instance.reloadIfChanged();
    return MemoryStore.instance;
  }

  /** Normalizza un fatto grezzo letto da disco: retrocompatibilità con il formato
   * vecchio (solo id/content/source/timestamp) — nessun fatto perde i campi noti,
   * i campi nuovi ricevono i default documentati sull'interfaccia. */
  private normalizeFact(raw: any): MemoryFact {
    return {
      id: raw.id,
      content: raw.content,
      source: raw.source,
      timestamp: raw.timestamp,
      scope: typeof raw.scope === 'string' && raw.scope.trim().length > 0 ? raw.scope : GLOBAL_SCOPE,
      kind: isValidKind(raw.kind) ? raw.kind : 'fatto',
      tags: Array.isArray(raw.tags) && raw.tags.length > 0 ? raw.tags.map(String) : undefined,
      pinned: raw.pinned === true ? true : undefined,
      hits: typeof raw.hits === 'number' && raw.hits >= 0 ? raw.hits : 0,
      lastUsed: typeof raw.lastUsed === 'string' && raw.lastUsed.length > 0 ? raw.lastUsed : raw.timestamp,
    };
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.loadedMtime = fs.statSync(this.filePath).mtimeMs;
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as MemoryFile;
        const rawFacts = Array.isArray(data.facts) ? data.facts : [];
        this.facts = rawFacts.map((f) => this.normalizeFact(f));
      } else {
        this.facts = [];
        this.loadedMtime = -1;
      }
    } catch (error: any) {
      console.error(`Errore nella lettura della memoria condivisa (${this.filePath}): ${error.message}. Riparto da memoria vuota.`);
      this.facts = [];
      this.loadedMtime = -1;
    }
    // Ricostruisce l'ordine logico di freschezza dall'ordine dell'array (= ordine
    // di creazione/salvataggio su disco): ogni load() riparte da qui.
    this.useOrder = new Map();
    this.useSeq = 0;
    for (const f of this.facts) {
      this.touch(f.id);
    }
  }

  private reloadIfChanged(): void {
    try {
      const mtime = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).mtimeMs : -1;
      if (mtime !== this.loadedMtime) {
        this.load();
      }
    } catch {}
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: MemoryFile = { facts: this.facts };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.loadedMtime = fs.statSync(this.filePath).mtimeMs;
    } catch (error: any) {
      console.error(`Errore nel salvataggio della memoria condivisa: ${error.message}`);
    }
  }

  /** Fatti visibili a questa istanza: del proprio scope più quelli globali. */
  private visibleFacts(): MemoryFact[] {
    return this.facts.filter((f) => f.scope === this.scope || f.scope === GLOBAL_SCOPE);
  }

  /**
   * Filtro per agente in lettura (T8.2), ortogonale allo scope per workspace: se
   * `sources` è assente o vuoto, nessun filtro (comportamento identico a prima —
   * nessuna regressione per i chiamanti esistenti). Se presente, un fatto resta
   * visibile solo se è "proprio" (source in `sources`, qualunque kind) oppure se è
   * di kind condivisibile per costruzione (`lezione`/`decisione`, di chiunque);
   * i `run` (scarti di turno) e i `fatto` altrui restano esclusi.
   */
  private filterBySource(facts: MemoryFact[], sources?: string[]): MemoryFact[] {
    const own = (sources ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    if (own.length === 0) return facts;
    const ownSet = new Set(own);
    return facts.filter((f) => ownSet.has(f.source) || SHAREABLE_KINDS.includes(f.kind));
  }

  /**
   * Punteggio di eviction (T6.1): più basso = candidato migliore per l'espulsione.
   * Combina kind (peso dominante: 'run' cade per primo, 'lezione' per ultimo),
   * il rango di freschezza d'uso (creazione o ultimo recall via search(), da
   * `useOrder` — spareggio principale) e hits (spareggio residuo minore).
   */
  private evictionScore(fact: MemoryFact, recencyRank: number, totalCandidates: number): number {
    const recencyScore = totalCandidates > 1 ? recencyRank / (totalCandidates - 1) : 1; // 0..1
    const hitsScore = Math.min(fact.hits ?? 0, 20) / 20; // 0..1
    const kindScore = (KIND_WEIGHT[fact.kind] ?? KIND_WEIGHT.fatto) / KIND_WEIGHT.lezione; // 0..1
    return kindScore * 100 + recencyScore * 10 + hitsScore;
  }

  /** Espelle fatti (mai i pinned) finché non si rientra in maxFacts, partendo dal
   * punteggio più basso. Se restano solo fatti pinned oltre il limite, si ferma:
   * pinned non viene mai espulso, anche a costo di superare temporaneamente il cap. */
  private evictIfNeeded(): void {
    while (this.facts.length > this.maxFacts) {
      const candidates = this.facts.filter((f) => !f.pinned);
      if (candidates.length === 0) break;

      // Rango di freschezza d'uso tra i soli candidati (da useOrder, non da
      // lastUsed): il meno usato di recente ha rango 0.
      const byUseOrder = [...candidates].sort(
        (a, b) => (this.useOrder.get(a.id) ?? -1) - (this.useOrder.get(b.id) ?? -1)
      );
      const rankOf = new Map<MemoryFact, number>();
      byUseOrder.forEach((f, i) => rankOf.set(f, i));
      const total = byUseOrder.length;

      let worst = candidates[0];
      let worstScore = this.evictionScore(worst, rankOf.get(worst)!, total);
      for (let i = 1; i < candidates.length; i++) {
        const f = candidates[i];
        const score = this.evictionScore(f, rankOf.get(f)!, total);
        if (score < worstScore) {
          worst = f;
          worstScore = score;
        }
      }
      this.facts = this.facts.filter((f) => f !== worst);
    }
  }

  /**
   * Salva un nuovo fatto. Oltre maxFacts, l'eviction a punteggio rimuove il fatto
   * meno rilevante (mai un fatto pinned). Lo scope, se non specificato, è quello
   * dell'istanza corrente (di norma la workspace da cui si sta operando).
   */
  addFact(content: string, source: string, opts?: AddFactOptions): MemoryFact {
    const timestamp = new Date().toISOString();
    const fact: MemoryFact = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      content: content.trim(),
      source,
      timestamp,
      scope: opts?.scope && opts.scope.trim().length > 0 ? opts.scope.trim() : this.scope,
      kind: opts?.kind && isValidKind(opts.kind) ? opts.kind : 'fatto',
      hits: 0,
      lastUsed: timestamp,
    };
    if (opts?.tags && opts.tags.length > 0) fact.tags = opts.tags;
    if (opts?.pinned) fact.pinned = true;

    this.facts.push(fact);
    this.touch(fact.id);
    this.evictIfNeeded();
    this.save();
    return fact;
  }

  /**
   * Restituisce gli ultimi fatti visibili (proprio scope + globali), dal più recente.
   * `sources` (T8.2, opzionale): filtro per agente in lettura, vedi filterBySource().
   */
  getRecent(limit: number = 10, sources?: string[]): MemoryFact[] {
    const visible = this.filterBySource(this.visibleFacts(), sources);
    return [...visible].reverse().slice(0, limit);
  }

  /**
   * Ricerca per parole chiave tra i fatti visibili (case-insensitive), con punteggio
   * OR: ogni fatto conta quante keyword compaiono (in content o tags), non richiede
   * più che compaiano tutte. Più keyword trovate → più in alto. A parità di
   * punteggio, il più recente prima.
   *
   * Normalizzazione morfologica leggera (T8.3): sia le keyword sia il testo dei
   * fatti passano da normalizeText/normalizeToken (minuscolo, accenti rimossi,
   * desinenza finale troncata) prima del confronto per sottostringa — così
   * "corsi" trova un fatto con "corso" e "badge" trova "badges".
   *
   * `opts.sources` (T8.2): filtro per agente in lettura, vedi filterBySource().
   * `opts.touch` (T8.4, default true): se false, non aggiorna hits/lastUsed né
   * scrive su disco — usato da formatRelevant() per non sporcare la memoria a ogni
   * costruzione di system prompt. recall_memory (chiamata esplicita dell'agente)
   * non passa `opts`, quindi continua a "toccare" i fatti restituiti come prima.
   */
  search(query: string, limit: number = 10, opts?: SearchOptions): MemoryFact[] {
    const keywords = query.split(/\s+/).filter((k) => k.length > 0).map(normalizeToken);
    const touch = opts?.touch !== false;
    let results: MemoryFact[];

    if (keywords.length === 0) {
      results = this.getRecent(limit, opts?.sources);
    } else {
      const candidates = this.filterBySource(this.visibleFacts(), opts?.sources);
      const scored = candidates
        .map((f) => {
          const haystack = normalizeText(`${f.content} ${(f.tags ?? []).join(' ')}`);
          const score = keywords.reduce((acc, k) => acc + (haystack.includes(k) ? 1 : 0), 0);
          return { fact: f, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          // Spareggio per rango di freschezza (useOrder), non timestamp grezzo:
          // stessa ragione della robustezza usata nell'eviction (risoluzione
          // dell'orologio di sistema, vedi commento su `useOrder`).
          return (this.useOrder.get(b.fact.id) ?? -1) - (this.useOrder.get(a.fact.id) ?? -1);
        });
      results = scored.slice(0, limit).map((x) => x.fact);
    }

    if (touch && results.length > 0) {
      const nowIso = new Date().toISOString();
      for (const f of results) {
        f.hits = (f.hits ?? 0) + 1;
        f.lastUsed = nowIso;
        this.touch(f.id); // rango di freschezza d'uso aggiornato, non solo il timestamp
      }
      this.save();
    }
    return results;
  }

  remove(id: string): boolean {
    const before = this.facts.length;
    this.facts = this.facts.filter((f) => f.id !== id);
    if (this.facts.length !== before) {
      this.useOrder.delete(id);
      this.save();
      return true;
    }
    return false;
  }

  clear(): void {
    this.facts = [];
    this.useOrder = new Map();
    this.save();
  }

  /** Numero di fatti visibili a questa istanza (proprio scope + globali). */
  count(): number {
    return this.visibleFacts().length;
  }

  /**
   * Sezione compatta da iniettare nel system prompt: ultimi fatti visibili in forma
   * di elenco, troncata a maxChars per non consumare troppo contesto. Fallback
   * usato quando non è disponibile un testo di task (vedi formatRelevant).
   *
   * `maxChars` (T8.3, opzionale): se omesso, usa `ConfigManager.getMemoryMaxChars()`
   * (default 600, configurabile in tsuka.config.json) invece del valore fisso di prima.
   * `sources` (T8.2, opzionale): filtro per agente in lettura, vedi filterBySource().
   */
  formatForPrompt(limit: number = 10, maxChars?: number, sources?: string[]): string {
    const cap = typeof maxChars === 'number' ? maxChars : new ConfigManager().getMemoryMaxChars();
    const visible = this.filterBySource(this.visibleFacts(), sources);
    if (visible.length === 0) {
      return '';
    }
    const recent = this.getRecent(limit, sources);
    const lines: string[] = [];
    let total = 0;
    for (const f of recent) {
      const date = f.timestamp.slice(0, 10);
      const line = `- [${date}] (${f.source}) ${f.content}`;
      if (total + line.length > cap) {
        break;
      }
      lines.push(line);
      total += line.length;
    }
    const omitted = visible.length - lines.length;
    let section = lines.join('\n');
    if (omitted > 0) {
      section += `\n… (altri ${omitted} ricordi disponibili: usa il tool recall_memory per cercarli)`;
    }
    return section;
  }

  /**
   * Sezione compatta da iniettare nel system prompt basata sulla rilevanza al
   * compito corrente (T6.1), non semplicemente sui fatti più recenti: usa search()
   * con `taskText` come query, quindi ordina per punteggio. Se `taskText` è vuoto,
   * ricade su formatForPrompt().
   *
   * `maxChars` (T8.3, opzionale): vedi formatForPrompt().
   * `sources` (T8.2, opzionale): filtro per agente in lettura, vedi filterBySource().
   * Chiama search() con `touch: false` (T8.4): costruire un prompt è una lettura
   * automatica, non un recall voluto dall'agente — non deve alterare hits/lastUsed
   * né scrivere memory.json (recall_memory, che chiama search() senza opts, resta
   * l'unico percorso che "tocca" i fatti).
   */
  formatRelevant(taskText: string, limit: number = 10, maxChars?: number, sources?: string[]): string {
    const text = (taskText || '').trim();
    const cap = typeof maxChars === 'number' ? maxChars : new ConfigManager().getMemoryMaxChars();
    if (!text) {
      return this.formatForPrompt(limit, cap, sources);
    }
    const relevant = this.search(text, limit, { sources, touch: false });
    if (relevant.length === 0) {
      return '';
    }
    const lines: string[] = [];
    let total = 0;
    for (const f of relevant) {
      const date = f.timestamp.slice(0, 10);
      const line = `- [${date}] (${f.source}) ${f.content}`;
      if (total + line.length > cap) {
        break;
      }
      lines.push(line);
      total += line.length;
    }
    const omitted = relevant.length - lines.length;
    let section = lines.join('\n');
    if (omitted > 0) {
      section += `\n… (altri ${omitted} ricordi pertinenti disponibili: usa il tool recall_memory per cercarli)`;
    }
    return section;
  }
}
