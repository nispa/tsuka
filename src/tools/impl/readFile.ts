import * as fs from 'fs';
import { Tool } from '../registry';
import { resolveSafePath, isBinaryFile } from './utils';

// Limite dimensione file per la lettura: evita di caricare in memoria file enormi
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const readFileTool: Tool = {
  name: 'read_file',
  riskLevel: 'SAFE',
  execute: async (args: { path: string; startLine?: number; endLine?: number }) => {
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
        `Usa startLine/endLine per leggere un intervallo specifico.`
      );
    }
    if (isBinaryFile(fullPath)) {
      throw new Error(`Il file '${args.path}' sembra essere un file binario.`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split(/\r?\n/);

    const start = args.startLine !== undefined ? Math.max(1, args.startLine) : 1;
    const end = args.endLine !== undefined ? Math.min(lines.length, args.endLine) : lines.length;

    if (start > lines.length) {
      return `[File: ${args.path} - Righe: ${lines.length}]\n(Il file ha meno righe di startLine)`;
    }

    const selectedLines = lines.slice(start - 1, end);
    return `[Contenuto di ${args.path} (Righe ${start}-${end} di ${lines.length})]\n${selectedLines.join('\n')}`;
  }
};
