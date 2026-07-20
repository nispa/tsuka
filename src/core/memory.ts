import * as fs from 'fs';
import * as path from 'path';

/**
 * Un singolo ricordo nella memoria condivisa.
 */
export interface MemoryFact {
  id: string;
  content: string;
  source: string;    // chi ha salvato il fatto (es. nome dell'agente o 'utente')
  timestamp: string; // ISO 8601
}

interface MemoryFile {
  facts: MemoryFact[];
}

/**
 * MemoryStore: memoria condivisa e persistente tra le sessioni.
 *
 * - I fatti sono salvati in `memory/memory.json` e sopravvivono al riavvio.
 * - Accesso tramite singleton con ricaricamento automatico se il file cambia su disco
 *   (pattern mtime già usato per schemi tool e config JSON).
 * - Condivisa per costruzione: tutti gli agenti (chat principale, /call, /team)
 *   leggono e scrivono lo stesso archivio.
 */
export class MemoryStore {
  private static instance: MemoryStore | null = null;

  private filePath: string;
  private facts: MemoryFact[] = [];
  private loadedMtime = -1;
  private maxFacts: number;

  /**
   * @param filePath Percorso del file di memoria (default: memory/memory.json nel cwd)
   * @param maxFacts Numero massimo di fatti conservati (oltre il limite, i più vecchi sono rimossi FIFO)
   */
  constructor(filePath?: string, maxFacts: number = 200) {
    this.filePath = filePath ?? path.resolve(process.cwd(), 'memory', 'memory.json');
    this.maxFacts = Math.max(1, maxFacts);
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

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.loadedMtime = fs.statSync(this.filePath).mtimeMs;
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as MemoryFile;
        this.facts = Array.isArray(data.facts) ? data.facts : [];
      } else {
        this.facts = [];
        this.loadedMtime = -1;
      }
    } catch (error: any) {
      console.error(`Errore nella lettura della memoria condivisa (${this.filePath}): ${error.message}. Riparto da memoria vuota.`);
      this.facts = [];
      this.loadedMtime = -1;
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

  /**
   * Salva un nuovo fatto. Oltre maxFacts, rimuove i più vecchi (FIFO).
   */
  addFact(content: string, source: string): MemoryFact {
    const fact: MemoryFact = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      content: content.trim(),
      source,
      timestamp: new Date().toISOString()
    };
    this.facts.push(fact);
    while (this.facts.length > this.maxFacts) {
      this.facts.shift();
    }
    this.save();
    return fact;
  }

  /**
   * Restituisce gli ultimi fatti salvati, dal più recente.
   */
  getRecent(limit: number = 10): MemoryFact[] {
    return [...this.facts].reverse().slice(0, limit);
  }

  /**
   * Ricerca per parole chiave (case-insensitive, tutte le parole devono comparire).
   * Risultati ordinati dal più recente.
   */
  search(query: string, limit: number = 10): MemoryFact[] {
    const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 0);
    if (keywords.length === 0) {
      return this.getRecent(limit);
    }
    return [...this.facts]
      .reverse()
      .filter((f) => {
        const haystack = f.content.toLowerCase();
        return keywords.every((k) => haystack.includes(k));
      })
      .slice(0, limit);
  }

  remove(id: string): boolean {
    const before = this.facts.length;
    this.facts = this.facts.filter((f) => f.id !== id);
    if (this.facts.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  clear(): void {
    this.facts = [];
    this.save();
  }

  count(): number {
    return this.facts.length;
  }

  /**
   * Sezione compatta da iniettare nel system prompt: ultimi fatti in forma di elenco,
   * troncata a maxChars per non consumare troppo contesto.
   */
  formatForPrompt(limit: number = 10, maxChars: number = 600): string {
    if (this.facts.length === 0) {
      return '';
    }
    const recent = this.getRecent(limit);
    const lines: string[] = [];
    let total = 0;
    for (const f of recent) {
      const date = f.timestamp.slice(0, 10);
      const line = `- [${date}] (${f.source}) ${f.content}`;
      if (total + line.length > maxChars) {
        break;
      }
      lines.push(line);
      total += line.length;
    }
    const omitted = this.facts.length - lines.length;
    let section = lines.join('\n');
    if (omitted > 0) {
      section += `\n… (altri ${omitted} ricordi disponibili: usa il tool recall_memory per cercarli)`;
    }
    return section;
  }
}
