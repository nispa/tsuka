import * as fs from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { ConfigManager } from '../../core/config';

/**
 * Root del workspace temporanea (T3.2, PLANNING-QUALITA.md): usata per isolare
 * ogni branch di un blocco PARALLELO di /goal nella propria cartella di staging,
 * invece che nella workspace reale (evita scritture parziali visibili prima che
 * il blocco sia concluso e permette il merge/conflict-detection a fine blocco).
 * AsyncLocalStorage e non una variabile globale mutabile: branch paralleli
 * concorrenti nello stesso processo Node (Promise.all) non si contaminano.
 */
const workspaceOverride = new AsyncLocalStorage<string>();

/** Esegue `fn` con una workspace root temporanea attiva per tutta la sua closure asincrona. */
export function withWorkspaceOverride<T>(root: string, fn: () => Promise<T>): Promise<T> {
  return workspaceOverride.run(root, fn);
}

/** Root effettiva usata per risolvere i path relativi e per la jail: l'override
 * attivo nel contesto asincrono corrente (se presente), altrimenti la workspace
 * root configurata. */
function getEffectiveRoot(): string {
  return workspaceOverride.getStore() ?? new ConfigManager().getWorkspaceRoot();
}

/**
 * Risolve un percorso: se è assoluto lo restituisce, altrimenti lo relativizza
 * alla workspace root effettiva (vedi getEffectiveRoot).
 */
export function resolvePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(getEffectiveRoot(), filePath);
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
 * Il percorso deve ricadere all'interno della workspace root (o sue sottocartelle),
 * altrimenti l'operazione viene rifiutata con un errore descrittivo. Default della
 * workspace root: cwd del processo (vedi `ConfigManager.getWorkspaceRoot`).
 */
export function resolveSafePath(filePath: string): string {
  const resolved = resolvePath(filePath);
  const root = getEffectiveRoot();

  const normalized = path.normalize(resolved);
  const normalizedRoot = path.normalize(root) + path.sep;

  if (normalized !== path.normalize(root) && !normalized.startsWith(normalizedRoot)) {
    throw new Error(
      `Accesso negato: il percorso '${filePath}' è fuori dal workspace autorizzato ` +
      `('${root}'). Tutti i file devono trovarsi all'interno del workspace.`
    );
  }

  return resolved;
}
