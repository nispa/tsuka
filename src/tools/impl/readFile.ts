import * as fs from 'fs';
import { Tool } from '../registry';
import { resolveSafePath, isBinaryFile } from './utils';
import { capForContext } from '../../core/contextBudget';

// Limite dimensione file per la lettura: evita di caricare in memoria file enormi
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const readFileTool: Tool = {
  name: 'read_file',
  riskLevel: 'SAFE',
  execute: async (args: { path: string; startLine?: number; endLine?: number; offset?: number; limit?: number }) => {
    const fullPath = resolveSafePath(args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Il file '${args.path}' non esiste.`);
    }
    if (fs.statSync(fullPath).isDirectory()) {
      throw new Error(`Il percorso '${args.path}' è una directory, non un file.`);
    }
    if (fs.statSync(fullPath).size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `Il file '${args.path}' supera il limite di ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB. ` +
        `Usa startLine/endLine (o offset/limit) per leggere un intervallo specifico.`
      );
    }
    if (isBinaryFile(fullPath)) {
      throw new Error(`Il file '${args.path}' sembra essere un file binario.`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split(/\r?\n/);

    // T8.8: offset/limit sono l'alias in stile paginazione (offset = riga di partenza
    // 1-indexed, limit = numero di righe) di startLine/endLine, tenuti per compatibilità
    // con i chiamanti esistenti. Se entrambe le coppie sono assenti si legge tutto il file
    // (il tetto di contesto sotto ci pensa a non farlo esplodere in cronologia).
    let start: number;
    let end: number;
    if (args.offset !== undefined || args.limit !== undefined) {
      start = args.offset !== undefined ? Math.max(1, Math.floor(args.offset)) : 1;
      const limit = args.limit !== undefined ? Math.max(1, Math.floor(args.limit)) : (lines.length - start + 1);
      end = Math.min(lines.length, start + limit - 1);
    } else {
      start = args.startLine !== undefined ? Math.max(1, args.startLine) : 1;
      end = args.endLine !== undefined ? Math.min(lines.length, args.endLine) : lines.length;
    }

    if (start > lines.length) {
      return `[File: ${args.path} - Righe: ${lines.length}]\n(Il file ha meno righe di quelle richieste)`;
    }

    const selectedLines = lines.slice(start - 1, end);
    const body = `[Contenuto di ${args.path} (Righe ${start}-${end} di ${lines.length})]\n${selectedLines.join('\n')}`;

    return capForContext(body, undefined, {
      label: `il file '${args.path}'`,
      recoveryHint: `Richiama di nuovo read_file su '${args.path}' con offset=${end + 1} (o startLine=${end + 1})` +
        ` per proseguire dalla riga successiva, oppure con offset/limit più piccoli per una porzione mirata,` +
        ` oppure usa grep_search per trovare solo le righe rilevanti.`
    });
  }
};
