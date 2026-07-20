import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../../core/config';

/**
 * Risolve un percorso: se è assoluto lo restituisce, altrimenti lo relativizza al cwd.
 */
export function resolvePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

/**
 * Verifica se un file è binario leggendo i primi 512 byte e cercando un byte null.
 */
export function isBinaryFile(filePath: string): boolean {
  const buffer = Buffer.alloc(512);
  try {
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
  } catch {}
  return false;
}

/**
 * Risolve e valida un percorso per operazioni di file (lettura/scrittura/modifica/eliminazione).
 *
 * Se in tsuka.config.json è impostato "workspaceRoot", il percorso deve ricadere
 * all'interno di quella directory (o sue sottocartelle), altrimenti l'operazione
 * viene rifiutata con un errore descrittivo.
 *
 * Se workspaceRoot non è configurato, il comportamento è quello attuale
 * (nessuna restrizione, percorso risolto normalmente).
 */
export function resolveSafePath(filePath: string): string {
  const resolved = resolvePath(filePath);
  const root = new ConfigManager().getWorkspaceRoot();

  if (!root) {
    return resolved;
  }

  const normalized = path.normalize(resolved);
  const normalizedRoot = path.normalize(root) + path.sep;

  if (!normalized.startsWith(normalizedRoot)) {
    throw new Error(
      `Accesso negato: il percorso '${filePath}' è fuori dal workspace autorizzato ` +
      `('${root}'). Tutti i file devono trovarsi all'interno del workspace.`
    );
  }

  return resolved;
}
