import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ToolRegistry, Tool } from './registry';

/**
 * Crea e restituisce un ToolRegistry caricando in modo del tutto dinamico
 * tutti i tool presenti all'interno della cartella 'impl/'.
 */
export async function createDefaultRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  const implDir = path.join(__dirname, 'impl');

  if (!fs.existsSync(implDir)) {
    throw new Error(`La directory di implementazione dei tool '${implDir}' non esiste.`);
  }

  // Scansiona la directory dei tool
  const files = fs.readdirSync(implDir);
  
  for (const file of files) {
    const ext = path.extname(file);
    // Considera solo file sorgenti TypeScript (.ts) o JavaScript compilati (.js)
    if ((ext === '.ts' || ext === '.js') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
      const filePath = path.join(implDir, file);
      try {
        // Converte il percorso assoluto in un URL "file://" valido (richiesto su Windows per import)
        const fileUrl = pathToFileURL(filePath).href;
        
        // Esegue l'importazione dinamica asincrona del modulo
        const module = await import(fileUrl);
        
        // Cerca tutti gli export del modulo per trovare definizioni conformi all'interfaccia Tool
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
        console.error(`Errore nel caricamento automatico del tool da '${file}': ${error.message}`);
      }
    }
  }

  return registry;
}
