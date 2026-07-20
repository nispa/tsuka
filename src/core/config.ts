import * as fs from 'fs';
import * as path from 'path';

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
  workspaceRoot?: string;
}

const LEGACY_CONFIG_PATH = path.resolve(process.cwd(), 'harness.config.json');
export const CONFIG_PATH = path.resolve(process.cwd(), 'tsuka.config.json');

// Migrazione legacy: rinomina harness.config.json → tsuka.config.json al primo avvio
if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(LEGACY_CONFIG_PATH)) {
  try {
    fs.renameSync(LEGACY_CONFIG_PATH, CONFIG_PATH);
  } catch {}
}

export class ConfigManager {
  private config!: AppConfig;

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
      console.error(`Errore nel caricamento di tsuka.config.json: ${error.message}. Uso configurazione di fallback.`);
    }
  }

  save(): void {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error: any) {
      console.error(`Errore nel salvataggio della configurazione: ${error.message}`);
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
    const provider = this.config.activeProvider;
    if (provider === 'openrouter') {
      return process.env.OPENROUTER_API_KEY || '';
    }
    if (provider === 'unsloth') {
      return process.env.UNSLOTH_API_KEY || 'local';
    }
    return 'local';
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
   * Default: 40. Configurabile con "maxHistoryMessages" in tsuka.config.json.
   */
  getMaxHistoryMessages(): number {
    const value = this.config.maxHistoryMessages;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 4) {
      return Math.floor(value);
    }
    return 40;
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
   * Se impostata, tutti i path di write/edit/delete/list_dir/grep_search/read_file
   * sono vincolati a questa directory (o sue sottocartelle).
   * Se null/undefined, il comportamento attuale è preservato (nessuna restrizione).
   */
  getWorkspaceRoot(): string | null {
    const root = this.config.workspaceRoot;
    if (typeof root === 'string' && root.trim().length > 0) {
      const resolved = path.resolve(root.trim());
      if (fs.existsSync(resolved)) {
        return resolved;
      }
      // La directory non esiste ma il vincolo è esplicito: torniamo il path comunque
      return resolved;
    }
    return null;
  }
}
