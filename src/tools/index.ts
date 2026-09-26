import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ToolRegistry, Tool } from './registry';
import { logSink } from '../core/logSink';

import { homePath, localWorkspacePath } from '../core/apphome';
import { isolatedCustomTool } from './customToolRunner';

export interface DefaultRegistryOptions {
  /** Loads create_tool and executable custom tool modules. Disabled by default. */
  selfAuthoringEnabled?: boolean;
}

/**
 * Loads tools from a directory into the given ToolRegistry.
 */
/**
 * Registers self-authored modules (T23.8). They are never imported into this process:
 * each becomes a DANGEROUS proxy that runs the file in a confined child on every call
 * (customToolRunner). The tool name is the file name, as written by create_tool.
 */
function loadCustomToolsFromDir(dirPath: string, registry: ToolRegistry): void {
  if (!fs.existsSync(dirPath)) return;
  for (const file of fs.readdirSync(dirPath)) {
    if (path.extname(file) !== '.js') continue;
    const name = path.basename(file, '.js');
    if (!/^[a-z0-9_]+$/.test(name)) {
      logSink.warn(`Skipping custom tool '${file}': name must use lowercase letters, digits and underscores.`);
      continue;
    }
    if (registry.getTool(name)) {
      logSink.warn(`Skipping custom tool '${file}': a tool named '${name}' is already registered.`);
      continue;
    }
    registry.register(isolatedCustomTool(name, path.join(dirPath, file)));
  }
}

async function loadToolsFromDir(dirPath: string, registry: ToolRegistry): Promise<void> {
  if (!fs.existsSync(dirPath)) return;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const ext = path.extname(file);
    if ((ext === '.ts' || ext === '.js') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
      const filePath = path.join(dirPath, file);
      try {
        let module: any;
        try {
          module = await import(pathToFileURL(filePath).href);
        } catch {
          module = require(filePath);
        }

        for (const key of Object.keys(module)) {
          const exportItem = module[key];

          if (
            exportItem &&
            typeof exportItem === 'object' &&
            typeof exportItem.name === 'string' &&
            typeof exportItem.riskLevel === 'string' &&
            typeof exportItem.execute === 'function'
          ) {
            registry.register(exportItem as Tool);
          }
        }
      } catch (error: any) {
        logSink.error(`Error auto-loading tool from '${file}': ${error.message}`);
      }
    }
  }
}

/**
 * Creates and returns a ToolRegistry by dynamically loading all tools
 * residing in the 'impl/' directory as well as user-created 'custom_tools/'.
 */
export async function createDefaultRegistry(options: DefaultRegistryOptions = {}): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  const implDir = path.join(__dirname, 'impl');

  if (!fs.existsSync(implDir)) {
    throw new Error(`Tool implementation directory '${implDir}' does not exist.`);
  }

  // 1. Load native core tools
  await loadToolsFromDir(implDir, registry);

  if (!options.selfAuthoringEnabled) {
    registry.unregister('create_tool');
    return registry;
  }

  // 2. Load global custom tools (TSUKA_HOME)
  const globalCustomDir = homePath('custom_tools');
  loadCustomToolsFromDir(globalCustomDir, registry);

  // 3. Load local custom tools (.tsuka/ in project workspace)
  const localCustomDir = localWorkspacePath('custom_tools');
  if (localCustomDir) {
    loadCustomToolsFromDir(localCustomDir, registry);
  }

  return registry;
}
