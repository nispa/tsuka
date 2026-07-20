import * as fs from 'fs';
import * as path from 'path';
import { RiskLevel, PermissionManager } from '../safety/permissions';
import { getModelProfile } from '../core/modelProfile';

/**
 * Contesto opzionale passato all'esecuzione dei tool (es. accesso al registry
 * per la registrazione a caldo di nuovi tool generati da create_tool).
 */
export interface ToolExecutionContext {
  registry?: ToolRegistry;
}

export interface Tool {
  name: string;
  riskLevel: RiskLevel;
  execute: (args: any, context?: ToolExecutionContext) => Promise<string>;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

/**
 * Determina la fascia di capacità di un modello.
 * Se esiste un profilo misurato (capability fingerprinting in models_profile.json),
 * usa quello; altrimenti ricade sull'euristica basata sul nome (es. 9b, 27b, 70b).
 */
export function getModelTier(modelName: string): 'small' | 'medium' | 'large' {
  const profile = getModelProfile(modelName);
  if (profile) {
    return profile.tier;
  }

  const lower = modelName.toLowerCase();
  
  // Se è un modello cloud noto su OpenRouter o di grandi provider, assumiamo sia grande (large)
  if (
    lower.includes('gpt-') || 
    lower.includes('claude-') || 
    lower.includes('gemini-') ||
    lower.includes('meta-llama/llama-3.3-70b') ||
    lower.includes('deepseek-')
  ) {
    return 'large';
  }

  // Regex per trovare la taglia in miliardi di parametri (es. 9b, 27b, 70b, 12b)
  const match = lower.match(/(\d+)b/);
  if (match) {
    const size = parseInt(match[1], 10);
    if (size <= 12) return 'small';
    if (size <= 35) return 'medium';
    return 'large';
  }

  // Di fallback per i modelli non identificati
  return 'small';
}

export interface ToolSchemaData {
  description: string;
  schema: any;
  requiredTier: 'small' | 'medium' | 'large';
}

/**
 * Validazione leggera degli argomenti del tool contro il JSON schema associato.
 * Controlla che i campi 'required' siano presenti e che i tipi base corrispondano.
 * Ritorna null se valido, altrimenti un messaggio di errore descrittivo.
 */
function validateToolArgs(args: any, schema: any, toolName: string): string | null {
  if (!args || typeof args !== 'object') {
    return "Argomenti assenti o non validi (atteso un oggetto JSON)";
  }

  // Validazione required
  const required: string[] = schema.required || [];
  for (const field of required) {
    if (args[field] === undefined || args[field] === null) {
      return `Campo obbligatorio '${field}' mancante`;
    }
  }

  // Validazione tipi base
  const properties = schema.properties || {};
  for (const [field, propSchema] of Object.entries(properties) as [string, any][]) {
    const value = args[field];
    if (value === undefined || value === null) continue;

    const expectedType = propSchema.type;
    if (!expectedType) continue;

    const actualType = typeof value;
    if (expectedType === 'string' && actualType !== 'string') {
      return `'${field}' deve essere una stringa, ricevuto ${actualType}`;
    }
    if (expectedType === 'integer' || expectedType === 'number') {
      if (actualType !== 'number' && actualType !== 'string') {
        return `'${field}' deve essere un numero, ricevuto ${actualType}`;
      }
      if (actualType === 'string' && expectedType === 'integer' && !/^-?\d+$/.test(value)) {
        return `'${field}' deve essere un intero, ricevuto "${value}"`;
      }
    }
  }

  return null;
}

function fallbackSchema(name: string): ToolSchemaData {
  return {
    description: `Tool di esecuzione ${name}`,
    schema: { type: 'object', properties: {} },
    requiredTier: 'small'
  };
}

// Cache degli schemi JSON con invalidazione su mtime: evita letture+parse ripetuti
// dal disco a ogni iterazione del loop agentico, ma rileva modifiche a caldo dei file.
const schemaCache = new Map<string, { mtimeMs: number; data: ToolSchemaData }>();

/**
 * Carica la descrizione, lo schema dei parametri e il tier minimo del tool da file JSON.
 * Il risultato è cacheato e invalidato automaticamente se il file su disco cambia.
 */
export function loadToolSchema(name: string): ToolSchemaData {
  try {
    const schemaPath = path.resolve(process.cwd(), `tools_schemas/${name}.json`);
    if (!fs.existsSync(schemaPath)) {
      return fallbackSchema(name);
    }

    const mtimeMs = fs.statSync(schemaPath).mtimeMs;
    const cached = schemaCache.get(name);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.data;
    }

    const raw = fs.readFileSync(schemaPath, 'utf-8');
    const data = JSON.parse(raw);
    const schemaData: ToolSchemaData = {
      description: data.description || '',
      schema: data.parameters || { type: 'object', properties: {} },
      requiredTier: data.requiredTier || 'small'
    };
    schemaCache.set(name, { mtimeMs, data: schemaData });
    return schemaData;
  } catch (error: any) {
    console.error(`Errore nel caricamento dello schema JSON per '${name}': ${error.message}`);
    return fallbackSchema(name);
  }
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  // Tool registrati a runtime (es. da create_tool): visibili a prescindere dagli
  // allowedTools del ruolo, perché la loro creazione è già stata approvata dall'utente
  private alwaysAllow: Set<string> = new Set();

  constructor() {}

  register(tool: Tool, options?: { alwaysAllow?: boolean }): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Un tool con il nome '${tool.name}' è già registrato.`);
    }
    this.tools.set(tool.name, tool);
    if (options?.alwaysAllow) {
      this.alwaysAllow.add(tool.name);
    }
  }

  unregister(name: string): boolean {
    this.alwaysAllow.delete(name);
    return this.tools.delete(name);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Ritorna i soli tool adatti alla taglia dell'LLM corrente e consentiti dal ruolo attivo.
   * @param modelName Nome del modello corrente per determinarne il Tier (small, medium, large).
   * @param allowedTools Lista dei tool consentiti dal ruolo attivo. Se assente, abilita tutti i tool registrati.
   */
  listForLLM(modelName: string, allowedTools?: string[]): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: any;
    };
  }> {
    const modelTier = getModelTier(modelName);
    const result: Array<{
      type: 'function';
      function: { name: string; description: string; parameters: any };
    }> = [];

    for (const tool of this.tools.values()) {
      // Se il ruolo restringe l'elenco dei tool e questo non è presente, lo esclude
      // (i tool registrati a runtime con alwaysAllow, approvati dall'utente, sono sempre visibili)
      if (allowedTools && !allowedTools.includes(tool.name) && !this.alwaysAllow.has(tool.name)) {
        continue;
      }

      const schemaData = loadToolSchema(tool.name);

      // Filtro di compatibilità:
      // - Modello 'small' vede solo tool 'small'.
      // - Modello 'medium' vede tool 'small' e 'medium'.
      // - Modello 'large' vede tutti i tool.
      const tierOk =
        modelTier === 'small'
          ? schemaData.requiredTier === 'small'
          : modelTier === 'medium'
            ? schemaData.requiredTier !== 'large'
            : true;

      if (!tierOk) {
        continue;
      }

      result.push({
        type: 'function',
        function: {
          name: tool.name,
          description: schemaData.description,
          parameters: schemaData.schema
        }
      });
    }

    return result;
  }

  async executeTool(name: string, args: any, permissionManager: PermissionManager): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: `Errore: Tool '${name}' non registrato in Tsuka.`
      };
    }

    // Validazione minima degli argomenti contro lo schema JSON
    const schemaData = loadToolSchema(name);
    if (schemaData.schema?.type === 'object' && schemaData.schema?.properties) {
      const validationError = validateToolArgs(args, schemaData.schema, name);
      if (validationError) {
        return {
          success: false,
          output: `Errore di validazione per il tool '${name}': ${validationError}. Rivedi i parametri e riprova.`
        };
      }
    }

    let details = '';
    try {
      details = JSON.stringify(args);
    } catch {
      details = 'argomenti complessi';
    }

    if (name === 'execute_command' && args.command) {
      details = args.command;
    } else if (name === 'write_file' && args.path) {
      details = `Creazione/sovrascrittura di ${args.path}`;
    } else if (name === 'edit_file' && args.path) {
      details = `Modifica di ${args.path}`;
    } else if (name === 'delete_file' && args.path) {
      details = `Eliminazione di ${args.path}`;
    }

    const isApproved = await permissionManager.checkPermission(name, details, tool.riskLevel);
    if (!isApproved) {
      return {
        success: false,
        output: `Errore: Operazione '${name}' rifiutata dall'utente. Richiesta non eseguita.`
      };
    }

    try {
      const output = await tool.execute(args, { registry: this });
      return {
        success: true,
        output: output
      };
    } catch (error: any) {
      return {
        success: false,
        output: `Errore durante l'esecuzione del tool '${name}': ${error.message}`
      };
    }
  }
}
