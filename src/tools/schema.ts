import * as fs from 'fs';
import { homePath, localWorkspacePath } from '../core/apphome';
import { logSink } from '../core/logSink';
import type { ToolSchemaData } from './types';

export function fallbackSchema(name: string): ToolSchemaData {
  return {
    description: `Tool ${name}`,
    schema: { type: 'object', properties: {} },
    requiredTier: 'small'
  };
}

const schemaCache = new Map<string, { mtimeMs: number; data: ToolSchemaData }>();

/**
 * Loads tool description, parameter schema, and minimum required tier from tools_schemas/*.json.
 */
export function loadToolSchema(name: string): ToolSchemaData {
  try {
    const localCustomSchemaPath = localWorkspacePath('custom_tools_schemas', `${name}.json`);
    const globalCustomSchemaPath = homePath('custom_tools_schemas', `${name}.json`);
    const coreSchemaPath = homePath('tools_schemas', `${name}.json`);

    let schemaPath = coreSchemaPath;
    if (localCustomSchemaPath && fs.existsSync(localCustomSchemaPath)) {
      schemaPath = localCustomSchemaPath;
    } else if (fs.existsSync(globalCustomSchemaPath)) {
      schemaPath = globalCustomSchemaPath;
    }

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
      // 'schema' is a legacy alias of 'parameters': some schema files (and hand-written
      // user tools) use that key. Without the alias the tool reaches the model with EMPTY
      // parameters and nothing to validate against — silent and hard to spot.
      schema: data.parameters || data.schema || { type: 'object', properties: {} },
      requiredTier: data.requiredTier || 'small'
    };
    schemaCache.set(name, { mtimeMs, data: schemaData });
    return schemaData;
  } catch (error: any) {
    logSink.error(`Error loading JSON schema for '${name}': ${error.message}`);
    return fallbackSchema(name);
  }
}

/**
 * Lightweight tool arguments validation against parameter JSON schema.
 */
export function validateToolArgs(args: unknown, schema: Record<string, unknown>, toolName: string): string | null {
  if (!args || typeof args !== 'object') {
    return 'Missing or invalid arguments (expected JSON object)';
  }

  const recordArgs = args as Record<string, unknown>;

  if (recordArgs._error === 'invalid_json_arguments') {
    return `Invalid or malformed JSON arguments (expected valid JSON object). Re-try calling '${toolName}' with valid JSON syntax`;
  }

  const required = (Array.isArray(schema.required) ? schema.required : []) as string[];
  const missingFields = required.filter((field) => recordArgs[field] === undefined || recordArgs[field] === null);
  if (missingFields.length > 0) {
    if (missingFields.length === 1) {
      return `Missing required parameter '${missingFields[0]}'`;
    }
    return `Missing required parameters: ${missingFields.map((f) => `'${f}'`).join(', ')}. All required parameters must be provided together in every call`;
  }

  const properties = (schema.properties && typeof schema.properties === 'object' ? schema.properties : {}) as Record<string, Record<string, unknown>>;
  for (const [field, propSchema] of Object.entries(properties)) {
    const value = recordArgs[field];
    if (value === undefined || value === null) continue;

    const expectedType = propSchema?.type;
    if (!expectedType) continue;

    const actualType = typeof value;
    if (expectedType === 'string' && actualType !== 'string') {
      return `'${field}' must be a string, received ${actualType}`;
    }
    if ((expectedType === 'integer' || expectedType === 'number') && actualType !== 'number' && actualType !== 'string') {
      return `'${field}' must be a number, received ${actualType}`;
    }
    if (expectedType === 'integer' && typeof value === 'string' && !/^-?\d+$/.test(value)) {
      return `'${field}' must be an integer, received "${value}"`;
    }
  }

  return null;
}
