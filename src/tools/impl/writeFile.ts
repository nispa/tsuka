import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

export const writeFileTool: Tool = {
  name: 'write_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string; content: string; append?: boolean | string }) => {
    const fullPath = resolveSafePath(args.path);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // T9.9: 'append' permette di costruire un file grande a pezzi con più
    // chiamate piccole invece di una sola con tutto il contenuto in un unico
    // argomento JSON — è quest'ultimo il caso che rompe la generazione JSON di
    // una tool call su un modello locale (stesso problema affrontato per
    // spawn_agent in T9.8, qui più rilevante perché write_file è il tool con
    // cui si scrive codice vero, spesso il file più lungo dell'intero compito).
    // Default false: comportamento identico a prima, nessuna rottura per i
    // chiamanti esistenti. Normalizzato a mano (non solo `if (args.append)`):
    // un modello può mandare la STRINGA "false" invece del booleano JSON —
    // una stringa non vuota è truthy in JS e la sovrascrittura richiesta
    // diventerebbe silenziosamente un accodamento.
    const append = args.append === true || (typeof args.append === 'string' && args.append.trim().toLowerCase() === 'true');
    if (append) {
      fs.appendFileSync(fullPath, args.content, 'utf-8');
      const totalSize = fs.statSync(fullPath).size;
      return `Contenuto accodato a '${args.path}' (+${Buffer.byteLength(args.content)} byte, ${totalSize} byte totali).`;
    }

    fs.writeFileSync(fullPath, args.content, 'utf-8');
    return `File '${args.path}' scritto con successo (${Buffer.byteLength(args.content)} byte).`;
  }
};
