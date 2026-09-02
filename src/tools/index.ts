import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ToolRegistry, Tool } from './registry';
import { logSink } from '../core/logSink';

import { homePath, localWorkspacePath } from '../core/apphome';

export interface DefaultRegistryOptions {
  /** Loads create_tool and executable custom tool modules. Disabled by default. */
  selfAuthoringEnabled?: boolean;
}

/**
 * Loads tools from a directory into the given ToolRegistry.
 */
async function loadToolsFromDir(
  dirPath: string,
  registry: ToolRegistry,
  options: { forceDangerous?: boolean } = {}
): Promise<void> {
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
            const tool = exportItem as Tool;
            if (options.forceDangerous) {
              // Custom module source is not trusted to lower its own permission boundary.
              // In particular, classifyRisk would otherwise turn a DANGEROUS custom tool
              // into SAFE for a selected call after the user enabled self-authoring.
              tool.riskLevel = 'DANGEROUS';
              tool.classifyRisk = undefined;
            }
            registry.register(tool);
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
  await loadToolsFromDir(globalCustomDir, registry, { forceDangerous: true });

  // 3. Load local custom tools (.tsuka/ in project workspace)
  const localCustomDir = localWorkspacePath('custom_tools');
  if (localCustomDir) {
    await loadToolsFromDir(localCustomDir, registry, { forceDangerous: true });
  }

  return registry;
}
