import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath, isBinaryFile } from './utils';
import { capForContext } from '../../core/contextBudget';

// Salta file più grandi di questo limite durante la ricerca grep (ogni file)
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const grepSearchTool: Tool = {
  name: 'grep_search',
  riskLevel: 'SAFE',
  execute: async (args: { query: string; path?: string }) => {
    const startDir = resolveSafePath(args.path || '.');
    const matches: string[] = [];
    const maxMatches = 50;

    function searchDir(currentDir: string) {
      if (matches.length >= maxMatches) return;
      const items = fs.readdirSync(currentDir);

      for (const item of items) {
        if (item === '.git' || item === 'node_modules' || item === 'dist') continue;
        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          searchDir(fullPath);
        } else if (stat.isFile()) {
          if (stat.size > MAX_FILE_SIZE_BYTES) continue;
          if (isBinaryFile(fullPath)) continue;
          
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes(args.query)) {
            const lines = content.split(/\r?\n/);
            lines.forEach((line, index) => {
              if (line.includes(args.query) && matches.length < maxMatches) {
                const relPath = path.relative(process.cwd(), fullPath);
                matches.push(`${relPath}:${index + 1}: ${line.trim()}`);
              }
            });
          }
        }
      }
    }

    try {
      searchDir(startDir);
    } catch (err: any) {
      throw new Error(`Errore durante la ricerca grep: ${err.message}`);
    }

    if (matches.length === 0) {
      return `Nessun risultato trovato per "${args.query}" in '${args.path || '.'}'.`;
    }

    const body = `Trovati ${matches.length} risultati per "${args.query}":\n${matches.join('\n')}`;

    // T8.8: il limite di ${maxMatches} righe non basta da solo — anche poche righe possono
    // saturare il tetto se sono molto lunghe (es. minified/log a riga unica). Tetto in token
    // applicato all'uscita, come per gli altri tool a output non delimitato.
    return capForContext(body, undefined, {
      label: `i risultati di grep_search per "${args.query}"`,
      recoveryHint: `Restringi la ricerca con un termine più specifico o con "path" su una sottocartella.`
    });
  }
};
