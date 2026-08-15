import * as fs from 'fs';
import * as path from 'path';
import { homePath } from './apphome';

/**
 * Workspace isolati per i branch di un blocco PARALLELO (T3.2, PLANNING-QUALITA.md).
 *
 * Ogni branch scrive in una propria cartella di staging sotto l'app home
 * (`workspace/parallel-<n>/`, non nella workspace reale del progetto): evita che
 * scritture concorrenti si sovrappongano prima che il blocco sia concluso e
 * permette di rilevare conflitti — stesso path relativo, contenuto diverso tra
 * branch — prima di toccare la workspace principale. Nessuna sovrascrittura
 * silenziosa: un path in conflitto non viene mai copiato nella workspace
 * principale, che resta intatta per quel file.
 */

export interface ParallelBranch {
  index: number;
  /** Etichetta del branch (es. aiName del personaggio), per i log e i conflitti. */
  label: string;
  /** Cartella di staging assoluta di questo branch. */
  root: string;
}

export interface MergeConflict {
  relativePath: string;
  labels: string[];
}

export interface MergeResult {
  merged: string[];
  conflicts: MergeConflict[];
}

/** Crea (pulendole prima, in caso di run precedenti interrotte) le cartelle di staging. */
export function createParallelBranches(labels: string[]): ParallelBranch[] {
  const base = homePath('workspace');
  return labels.map((label, i) => {
    const index = i + 1;
    const root = path.join(base, `parallel-${index}`);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    return { index, label, root };
  });
}

/** Elenca ricorsivamente tutti i file di `dir`, come path relativi a `dir`. */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(dir, full));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/**
 * Unisce i file prodotti dai branch nella workspace principale. Se due o più
 * branch hanno scritto lo stesso path relativo con contenuto diverso (confronto
 * byte a byte, non testuale: sicuro anche per file binari), il path finisce in
 * `conflicts` e NON viene copiato — la workspace principale resta intatta per
 * quel file, incluso se già esisteva prima del blocco. Se il contenuto coincide
 * tra tutti i branch che l'hanno scritto (o un solo branch l'ha scritto), il file
 * viene copiato in `mainWorkspaceRoot`. Le cartelle di staging vengono sempre
 * ripulite al termine, anche in presenza di conflitti.
 */
export function mergeParallelWorkspaces(branches: ParallelBranch[], mainWorkspaceRoot: string): MergeResult {
  const writers = new Map<string, { label: string; content: Buffer }[]>();

  for (const branch of branches) {
    for (const relPath of listFilesRecursive(branch.root)) {
      const content = fs.readFileSync(path.join(branch.root, relPath));
      const list = writers.get(relPath) ?? [];
      list.push({ label: branch.label, content });
      writers.set(relPath, list);
    }
  }

  const merged: string[] = [];
  const conflicts: MergeConflict[] = [];

  for (const [relPath, entries] of writers) {
    const distinct: Buffer[] = [];
    for (const e of entries) {
      if (!distinct.some((b) => b.equals(e.content))) distinct.push(e.content);
    }

    if (distinct.length > 1) {
      conflicts.push({ relativePath: relPath, labels: entries.map((e) => e.label) });
      continue;
    }

    const target = path.join(mainWorkspaceRoot, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, distinct[0]);
    merged.push(relPath);
  }

  for (const branch of branches) {
    try { fs.rmSync(branch.root, { recursive: true, force: true }); } catch {}
  }

  return { merged, conflicts };
}
