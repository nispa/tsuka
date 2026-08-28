import * as fs from 'fs';
import { resolveAssetPath } from './apphome';
import { normalizeProviderClass, type ProviderClass } from './cloudProvider';
import { logSink } from './logSink';

export interface FreeModelsCapability {
  aliases?: string[];
  suffixes?: string[];
  includeZeroPriced?: boolean;
}

export interface ProviderCapabilities {
  freeModels?: FreeModelsCapability;
}

export interface ProviderDefinition {
  displayName: string;
  class: ProviderClass;
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv?: string;
  capabilities: ProviderCapabilities;
}

interface ProviderCatalogFile {
  version: number;
  providers: Record<string, Partial<ProviderDefinition>>;
}

export const PROVIDERS_PATH = resolveAssetPath('providers.json');

function sanitizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function parseDefinition(name: string, raw: Partial<ProviderDefinition>): ProviderDefinition | null {
  if (typeof raw.baseUrl !== 'string' || typeof raw.defaultModel !== 'string') return null;
  const freeRaw = raw.capabilities?.freeModels;
  return {
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : name,
    class: normalizeProviderClass(raw.class),
    baseUrl: raw.baseUrl,
    defaultModel: raw.defaultModel,
    apiKeyEnv: typeof raw.apiKeyEnv === 'string' && /^[A-Z][A-Z0-9_]*$/.test(raw.apiKeyEnv) ? raw.apiKeyEnv : undefined,
    capabilities: {
      freeModels: freeRaw ? {
        aliases: sanitizeStringList(freeRaw.aliases),
        suffixes: sanitizeStringList(freeRaw.suffixes),
        includeZeroPriced: freeRaw.includeZeroPriced === true,
      } : undefined,
    },
  };
}

export function loadProviderCatalog(filePath = PROVIDERS_PATH): Record<string, ProviderDefinition> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProviderCatalogFile;
    const result: Record<string, ProviderDefinition> = {};
    for (const [name, raw] of Object.entries(parsed.providers ?? {})) {
      const definition = parseDefinition(name, raw);
      if (definition) result[name] = definition;
      else logSink.warn(`Ignoring invalid provider definition '${name}' in ${filePath}.`);
    }
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logSink.error(`Error loading providers.json: ${message}.`);
    return {};
  }
}
