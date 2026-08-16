import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ToolRegistry, Tool } from './registry';
import { logSink } from '../core/logSink';

/**
 * Creates and returns a ToolRegistry by dynamically loading all tools
 * residing in the 'impl/' directory.
 */
export async function createDefaultRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  const implDir = path.join(__dirname, 'impl');

  if (!fs.existsSync(implDir)) {
    throw new Error(`Tool implementation directory '${implDir}' does not exist.`);
  }

  const files = fs.readdirSync(implDir);
  
  for (const file of files) {
    const ext = path.extname(file);
    if ((ext === '.ts' || ext === '.js') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
      const filePath = path.join(implDir, file);
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

  return registry;
}
