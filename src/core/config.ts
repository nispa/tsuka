import * as fs from 'fs';
import * as path from 'path';
import { homePath } from './apphome';
import { logSink } from './logSink';

// dotenv caricato dal punto di ingresso (cli/index.ts)

export interface ProviderConfig {
  baseUrl: string;
  model: string;
}

export interface WebSearchConfig {
  provider: 'duckduckgo' | 'tavily' | 'google';
}

export interface AppConfig {
  activeProvider: 'ollama' | 'openrouter' | 'unsloth' | string;
  providers: {
    ollama: ProviderConfig;
    openrouter: ProviderConfig;
    [key: string]: ProviderConfig;
  };
  webSearch: WebSearchConfig;
  activeRole: string;
  activeTrait: string;
  activeCharacter: string;
  maxHistoryMessages?: number;
  maxHistoryTokens?: number;
  maxToolResultTokens?: number;
  workspaceRoot?: string;
  memoryMaxChars?: number;
  /** Ultimo livello della cascata di reasoning_effort (T8.10): usato solo se né
   *  il personaggio né il ruolo attivo specificano "reasoningEffort". Valori
   *  validi: 'none' | 'low' | 'medium' | 'xhigh' (vedi src/core/provider.ts). */
  reasoningEffort?: string;
  /** Timeout a orologio sull'intera generazione LLM in ms (T8.16). Default: 120000. */
  llmTimeoutMs?: number;
  /** Preset di creatività predefinito ('precise' | 'balanced' | 'creative' | 'low' | 'medium' | 'high'). */
  creativity?: string;
  /** Esecuzione parallela dei blocchi PARALLELO in `goal` (T9.10). Default: false —
   *  su una singola GPU/singolo modello in VRAM il parallelismo tra agenti non è
   *  performante (gli agenti finiscono comunque a contendersi la stessa scheda),
   *  quindi resta disattivato finché non lo si abilita esplicitamente. Quando
   *  false, un blocco PARALLELO viene comunque riconosciuto ma eseguito come
   *  sequenza di step normali (vedi parsePlan in cli/commands/goal.ts). */
  parallelExecutionEnabled?: boolean;
}

export const CONFIG_PATH = homePath('tsuka.config.json');

export class ConfigManager {
  private config!: AppConfig;
  private runtimeContextTokens: number | null = null;

  constructor() {
    this.load();
  }

  load(): void {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        this.config = JSON.parse(raw);
        // Applica i default mancanti e salva SOLO se il file è stato effettivamente corretto
        // (evita riscritture spurie del config a ogni avvio o a ogni caricamento)
        let dirty = false;
        if (!this.config.webSearch) {
          this.config.webSearch = { provider: 'duckduckgo' };
          dirty = true;
        }
        if (!this.config.activeRole) {
          this.config.activeRole = 'developer';
          dirty = true;
        }
        if (!this.config.activeTrait) {
          this.config.activeTrait = 'professional';
          dirty = true;
        }
        if (!this.config.activeCharacter) {
          this.config.activeCharacter = 'custom';
          dirty = true;
        }
        if (dirty) {
          this.save();
        }
      } else {
        // Fallback predefinito se il file viene eliminato
        this.config = {
          activeProvider: 'ollama',
          providers: {
            ollama: {
              baseUrl: 'http://localhost:11434/v1',
              model: 'satgeze/qwenpaw-9b-heretic-1m:latest',
            },
            openrouter: {
              baseUrl: 'https://openrouter.ai/api/v1',
              model: 'meta-llama/llama-3.3-70b-instruct',
            },
            unsloth: {
              baseUrl: 'http://127.0.0.1:8888/v1',
              model: 'default',
            },
          },
          webSearch: {
            provider: 'duckduckgo'
          },
          activeRole: 'developer',
          activeTrait: 'professional',
          activeCharacter: 'custom'
        };
        this.save();
      }
    } catch (error: any) {
      logSink.error(`Errore nel caricamento di tsuka.config.json: ${error.message}. Uso configurazione di fallback.`);
    }
  }

  save(): void {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error: any) {
      logSink.error(`Errore nel salvataggio della configurazione: ${error.message}`);
    }
  }

  getActiveProviderName(): 'ollama' | 'openrouter' | 'unsloth' | string {
    return this.config.activeProvider;
  }

  setActiveProvider(provider: 'ollama' | 'openrouter' | 'unsloth' | string): void {
    this.config.activeProvider = provider;
    this.save();
  }

  getActiveProviderConfig(): ProviderConfig {
    const provider = this.config.activeProvider;
    return this.config.providers[provider];
  }

  getApiKey(): string {
    return this.getApiKeyFor(this.config.activeProvider);
  }

  getApiKeyFor(provider: string): string {
    if (provider === 'openrouter') {
      return process.env.OPENROUTER_API_KEY || '';
    }
    if (provider === 'unsloth') {
      return process.env.UNSLOTH_API_KEY || 'local';
    }
    return 'local';
  }

  getProviderNames(): string[] {
    return Object.keys(this.config.providers);
  }

  getProviderConfig(name: string): ProviderConfig | undefined {
    return this.config.providers[name];
  }

  updateActiveModel(modelName: string): void {
    const provider = this.config.activeProvider;
    if (this.config.providers[provider]) {
      this.config.providers[provider].model = modelName;
      this.save();
    }
  }

  getWebSearchProvider(): 'duckduckgo' | 'tavily' | 'google' {
    return this.config.webSearch?.provider || 'duckduckgo';
  }

  setWebSearchProvider(provider: 'duckduckgo' | 'tavily' | 'google'): void {
    if (!this.config.webSearch) {
      this.config.webSearch = { provider };
    } else {
      this.config.webSearch.provider = provider;
    }
    this.save();
  }

  getActiveRole(): string {
    return this.config.activeRole || 'developer';
  }

  setActiveRole(role: string): void {
    this.config.activeRole = role;
    this.save();
  }

  getActiveTrait(): string {
    return this.config.activeTrait || 'professional';
  }

  setActiveTrait(trait: string): void {
    this.config.activeTrait = trait;
    this.save();
  }

  getActiveCharacter(): string {
    return this.config.activeCharacter || 'custom';
  }

  setActiveCharacter(char: string): void {
    this.config.activeCharacter = char;
    this.save();
  }

  /**
   * Numero massimo di messaggi mantenuti nella cronologia di sessione (system prompt incluso).
   * Default: 500 (guardia estrema: il limite primario è guidato dai token maxHistoryTokens).
   * Configurabile con "maxHistoryMessages" in tsuka.config.json.
   */
  getMaxHistoryMessages(): number {
    const value = this.config.maxHistoryMessages;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 4) {
      return Math.floor(value);
    }
    return 500;
  }

  /**
   * Budget massimo di token stimati (~3,5 caratteri/token) mantenuti in cronologia.
   * Protegge la context window quando pochi messaggi contengono output tool molto
   * grandi, caso in cui il limite a conteggio messaggi non basta.
  /**
   * Imposta il limite di contesto rilevato dinamicamente a runtime dal server attivo.
   */
  setRuntimeContextTokens(tokens: number | null): void {
    this.runtimeContextTokens = typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 1024
      ? Math.floor(tokens)
      : null;
  }

  /**
   * Ritorna il limite di contesto rilevato dal server a runtime, o null se non disponibile.
   */
  getRuntimeContextTokens(): number | null {
    return this.runtimeContextTokens;
  }

  /**
   * Finestra di contesto massima totale per la sessione: se il server ha esposto
   * dinamicamente il proprio context window reale (T11.5), usa quello; altrimenti
   * ricade sul default configurato in "maxHistoryTokens" di tsuka.config.json (default 65536).
   */
  getMaxHistoryTokens(): number {
    if (this.runtimeContextTokens !== null && this.runtimeContextTokens >= 1024) {
      return this.runtimeContextTokens;
    }
    const value = this.config.maxHistoryTokens;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1024) {
      return Math.floor(value);
    }
    return 65536;
  }

  /**
   * Tetto di contesto per un SINGOLO risultato di tool (T8.8), in token stimati
   * (~3,5 caratteri/token, stessa convenzione di `Agent.charsPerToken`). Più stretto
   * dei limiti di sicurezza in byte già esistenti in ogni tool (5MB per read_file/
   * grep_search, 50KB per execute_command), che restano invariati come guardia
   * superiore: qui si taglia PRIMA che il risultato entri in cronologia, perché la
   * potatura di `Agent` interviene solo dopo che il messaggio è già stato costruito.
   * Default: 4000. Configurabile con "maxToolResultTokens" in tsuka.config.json (min 256).
   */
  getMaxToolResultTokens(): number {
    const value = this.config.maxToolResultTokens;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 256) {
      return Math.floor(value);
    }
    return 4000;
  }

  /**
   * Numero massimo di round (giri completi di tutti i membri) in un workflow /team.
   * Il team si ferma prima se un membro dichiara STATO: COMPLETATO.
   * Default: 3. Configurabile con "teamMaxRounds" in tsuka.config.json.
   */
  getTeamMaxRounds(): number {
    const value = (this.config as any).teamMaxRounds;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
      return Math.floor(value);
    }
    return 3;
  }

  /**
   * Root del workspace per la jail di sicurezza dei file tool.
   * Tutti i path di write/edit/delete/list_dir/grep_search/read_file sono vincolati
   * a questa directory (o sue sottocartelle).
   *
   * Default (nessun "workspaceRoot" in tsuka.config.json): la cwd del processo —
   * coerente con la distinzione app home / workspace di apphome.ts, dove il workspace
   * è "la cartella da cui il comando viene lanciato". Non un path fisso nel config
   * condiviso, altrimenti l'uso come comando globale (`tsuka` da un'altra cartella)
   * resterebbe agganciato alla prima cartella di installazione.
   * Esplicitare "workspaceRoot" nel config sovrascrive il default (es. per restringere
   * a una sottocartella specifica indipendentemente da dove si lancia il comando).
   */
  getWorkspaceRoot(): string {
    const root = this.config.workspaceRoot;
    if (typeof root === 'string' && root.trim().length > 0) {
      return path.resolve(root.trim());
    }
    return process.cwd();
  }

  /**
   * Tetto in caratteri della sezione di memoria iniettata nel system prompt
   * (T8.3), sia dal fallback per recenza (`formatForPrompt`) sia dall'iniezione
   * per rilevanza (`formatRelevant`) di `MemoryStore`. Prima era fisso a 600.
   * Default: 600. Configurabile con "memoryMaxChars" in tsuka.config.json (min 100).
   */
  getMemoryMaxChars(): number {
    const value = this.config.memoryMaxChars;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 100) {
      return Math.floor(value);
    }
    return 600;
  }

  /**
   * Ultimo livello della cascata di reasoning_effort (T8.10, TASKS.md): override
   * chiamante → personaggio → ruolo → QUESTO default. undefined se non impostato
   * (nessun default silenzioso a un valore fisso: senza "reasoningEffort" in
   * tsuka.config.json e senza che personaggio/ruolo lo specifichino, il
   * comportamento resta quello di sempre — decide il modello).
   * Configurabile con "reasoningEffort" in tsuka.config.json ('none'|'low'|'medium'|'xhigh').
   */
  getDefaultReasoningEffort(): 'none' | 'low' | 'medium' | 'xhigh' | undefined {
    const value = this.config.reasoningEffort;
    return value === 'none' || value === 'low' || value === 'medium' || value === 'xhigh' ? value : undefined;
  }

  /**
   * Timeout a orologio sull'intera generazione LLM in millisecondi (T8.16).
   * Default: 120000 ms (2 minuti). Configurabile con "llmTimeoutMs" in tsuka.config.json.
   */
  getLlmTimeoutMs(): number {
    const value = this.config.llmTimeoutMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1000) {
      return Math.floor(value);
    }
    return 120000;
  }

  /**
   * Esecuzione parallela dei blocchi PARALLELO in `goal` (T9.10). Default:
   * false — vedi il commento su AppConfig.parallelExecutionEnabled. Va
   * abilitata esplicitamente con "parallelExecutionEnabled": true in
   * tsuka.config.json solo su hardware che la sostiene davvero (più GPU, o
   * più modelli caricati in VRAM contemporaneamente).
   */
  isParallelExecutionEnabled(): boolean {
    return this.config.parallelExecutionEnabled === true;
  }

  /**
   * Preset di creatività predefinito ('precise' | 'balanced' | 'creative' | 'low' | 'medium' | 'high').
   */
  getDefaultCreativity(): 'precise' | 'balanced' | 'creative' | 'low' | 'medium' | 'high' | undefined {
    const value = this.config.creativity?.toLowerCase();
    if (value === 'precise' || value === 'balanced' || value === 'creative' || value === 'low' || value === 'medium' || value === 'high') {
      return value as any;
    }
    return undefined;
  }
}
