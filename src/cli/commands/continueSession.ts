import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../../core/apphome';
import { InteractiveMenu } from '../ui';

/**
 * Comando `/continue`: forza la ripresa di un compito interrotto invece di
 * lasciare che il modello ricominci da capo su un agente respawnato.
 *
 * Il gap che colma: `Agent.persistReasoningTrace` (T9.12) salva già il
 * ragionamento completo su file (`memory/thinking/*.md`) con un puntatore in
 * `MemoryStore` — ma è un meccanismo PASSIVO: dipende dal modello che
 * decide di sua iniziativa di chiamare `recall_memory` e poi `read_file`, e
 * di prendere sul serio "non rileggere da capo". In pratica un agente
 * respawnato senza history spesso rilegge la spec e ri-arriva alle stesse
 * domande, invece di leggere la traccia e agire. `/continue` inietta la
 * traccia direttamente nel prossimo turno con un'istruzione esplicita.
 */

export interface ThinkingTraceEntry {
  filename: string;
  fullPath: string;
  mtime: Date;
  interrupted: boolean;
}

/** Elenca le tracce di ragionamento salvate in memory/thinking/, più recenti prima. */
export function listThinkingTraces(limit: number = 15): ThinkingTraceEntry[] {
  const dir = homePath('memory', 'thinking');
  if (!fs.existsSync(dir)) return [];

  const entries: ThinkingTraceEntry[] = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((filename) => {
      const fullPath = path.join(dir, filename);
      let mtime = new Date(0);
      try {
        mtime = fs.statSync(fullPath).mtime;
      } catch {}
      return { filename, fullPath, mtime, interrupted: filename.includes('-interrotto') };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return entries.slice(0, limit);
}

/**
 * Risolve quale traccia riprendere: match esplicito sul filename se `arg` è
 * dato (utile per script/non-TTY e per scegliere una traccia specifica senza
 * menu); altrimenti la più recente in non-TTY, o un menu interattivo in TTY.
 */
export async function resolveThinkingTrace(
  arg: string,
  traces: ThinkingTraceEntry[] = listThinkingTraces()
): Promise<ThinkingTraceEntry | null> {
  if (traces.length === 0) return null;

  const trimmedArg = arg.trim().toLowerCase();
  if (trimmedArg) {
    return traces.find((t) => t.filename.toLowerCase().includes(trimmedArg)) || null;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return traces[0];
  }

  const choices = traces.map((t) => ({
    title: `${t.interrupted ? '⚠ interrotto' : '✔ completo'} · ${t.mtime.toLocaleString()} · ${t.filename}`,
    value: t.filename,
  }));
  const selected = await InteractiveMenu.select<string>(
    'Quale ragionamento vuoi riprendere? (usa le frecce)',
    choices
  );
  return traces.find((t) => t.filename === selected) || null;
}

/**
 * Costruisce il messaggio da inviare come prossimo turno utente: la traccia
 * completa più un'istruzione esplicita di NON ri-derivarla, ma decidere e
 * agire. È testo semplice (nessun tool coinvolto): l'agente riceve la stessa
 * cosa che avrebbe letto da solo con `read_file`, ma senza doverlo scegliere.
 */
export function buildResumeDirective(traceContent: string): string {
  const trimmed = (traceContent || '').trim();
  return `[RIPRESA FORZATA DI UN COMPITO INTERROTTO]\n` +
    `Questo è il tuo ragionamento completo dell'ultima sessione su questo stesso compito, salvato prima dell'interruzione:\n\n` +
    `---\n${trimmed}\n---\n\n` +
    `NON ripartire da capo e non rileggere le specifiche o il contesto da zero: il ragionamento sopra è già completo. ` +
    `Se converge già a una decisione, prendila ed esegui SUBITO con i tool (scrivi/modifica i file). ` +
    `Se restano dubbi aperti, risolvili con una scelta pragmatica in una frase e procedi — non serve rivalutare di nuovo tutte le alternative.`;
}
