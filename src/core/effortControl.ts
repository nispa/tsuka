import chalk from 'chalk';
import { ReasoningEffort } from './provider';

/**
 * Controllo globale del reasoning_effort a runtime (T8.14, TASKS.md — FASE 3):
 * un livello in cima alla cascata a 4 livelli di T8.10 (resolveReasoningEffort,
 * agent.ts), azionabile dal comando `/effort`. Ordine finale: **pin globale →
 * override del chiamante → personaggio → ruolo → default di config**.
 *
 * Stato di PROCESSO, non persistito: variabili di modulo, mai scritte su
 * `tsuka.config.json` (quello resta il campo "reasoningEffort", letto da
 * `ConfigManager.getDefaultReasoningEffort()` — un concetto distinto, il
 * default che sopravvive al riavvio). Il pin sparisce da solo a ogni nuovo
 * processo, per costruzione: non serve nessuna pulizia esplicita.
 *
 * Questo modulo NON tocca `resolveReasoningEffort`: la cascata a 4 livelli
 * resta quella di T8.10, il pin si applica DOPO, ai punti che oggi la
 * chiamano (`cli/index.ts`, `strategies/common.ts`, `tools/impl/spawnAgent.ts`)
 * tramite `withEffortPin`.
 */

let pin: ReasoningEffort | undefined;
let askMode = false;

/** Pin globale attivo, se presente (undefined = nessun pin, cascata invariata). */
export function getEffortPin(): ReasoningEffort | undefined {
  return pin;
}

/** Fissa (o rimuove, con undefined) il pin globale. Non scrive su disco. */
export function setEffortPin(effort: ReasoningEffort | undefined): void {
  pin = effort;
}

/** Modalità `/effort ask` attiva? Vedi `confirmEffortDivergence` per l'uso. */
export function isAskModeEnabled(): boolean {
  return askMode;
}

export function setAskMode(enabled: boolean): void {
  askMode = enabled;
}

/**
 * SOLO test: riporta pin e ask mode allo stato iniziale. Necessario perché lo
 * stato è di modulo (condiviso fra i casi di uno stesso file di test) — senza
 * reset esplicito un test lascerebbe un pin attivo per quelli successivi.
 */
export function resetEffortControlForTest(): void {
  pin = undefined;
  askMode = false;
}

/**
 * Applica il pin sopra un valore già risolto dalla cascata a 4 livelli
 * (`resolveReasoningEffort`, agent.ts) o sopra l'override esplicito di un
 * chiamante (es. l'argomento `reasoningEffort` di `spawn_agent`, T8.13): il pin
 * vince su ENTRAMBI, essendo il livello più alto della cascata finale. Nessun
 * pin attivo → il valore passato torna invariato (comportamento identico a
 * prima di T8.14).
 */
export function withEffortPin(cascaded: ReasoningEffort | undefined): ReasoningEffort | undefined {
  return pin ?? cascaded;
}

export type EffortSource = 'pin' | 'personaggio' | 'ruolo' | 'default' | 'nessuno';

/**
 * Provenienza del livello effettivo per la chat interattiva (`/effort` senza
 * argomenti): stessa priorità della cascata di T8.10, con il pin aggiunto in
 * cima. Non replica il livello "override del chiamante": nella chat normale
 * non esiste (è un concetto solo di spawn_agent/team), quindi qui la cascata
 * comincia direttamente dal personaggio.
 */
// Parametri tipizzati `object` (non un tipo con `reasoningEffort` opzionale):
// stesso motivo di resolveReasoningEffort (agent.ts) — TypeScript tratta un
// tipo a sole proprietà opzionali come "weak type" e rifiuta (TS2559/TS2345)
// l'assegnazione diretta di un CharacterConfig/RoleConfig reale (nessuna
// proprietà in comune per nome, non avendo `reasoningEffort` nel tipo
// dichiarato in src/cli/shared.ts). Il campo esiste comunque a runtime nei
// file JSON; il cast interno più `?.` resta sicuro (undefined se assente).
export function describeEffortSource(
  character: object | null | undefined,
  role: object | null | undefined,
  configDefault: ReasoningEffort | undefined
): { effort: ReasoningEffort | undefined; source: EffortSource } {
  const char = character as { reasoningEffort?: ReasoningEffort } | null | undefined;
  const r = role as { reasoningEffort?: ReasoningEffort } | null | undefined;
  if (pin) return { effort: pin, source: 'pin' };
  if (char?.reasoningEffort !== undefined) return { effort: char.reasoningEffort, source: 'personaggio' };
  if (r?.reasoningEffort !== undefined) return { effort: r.reasoningEffort, source: 'ruolo' };
  if (configDefault !== undefined) return { effort: configDefault, source: 'default' };
  return { effort: undefined, source: 'nessuno' };
}

/**
 * Livello di riferimento per rilevare la divergenza (T8.14): il pin se attivo,
 * altrimenti il default persistente di configurazione. Usato sia per il log
 * automatico (`logEffortDivergence`) sia per la modalità ask
 * (`confirmEffortDivergence`).
 */
export function getReferenceEffort(configDefault: ReasoningEffort | undefined): ReasoningEffort | undefined {
  return pin ?? configDefault;
}

const effortLabel = (e: ReasoningEffort | undefined) => e ?? 'nessuno (decide il modello)';

/**
 * Confronta due elenchi di nomi di tool (prima/dopo un cambio di effort) e
 * descrive la differenza in una frase: l'annuncio esplicito richiesto da T8.14
 * quando il pin cambia il tier ("il comando deve renderlo visibile, non farlo
 * di nascosto"). null se le due liste coincidono (nessun cambiamento).
 */
export function describeToolDiff(before: string[], after: string[]): string | null {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((t) => !beforeSet.has(t));
  const removed = before.filter((t) => !afterSet.has(t));
  if (added.length === 0 && removed.length === 0) return null;
  const parts: string[] = [];
  if (added.length > 0) parts.push(`+${added.length} disponibili (${added.join(', ')})`);
  if (removed.length > 0) parts.push(`-${removed.length} nascosti (${removed.join(', ')})`);
  return parts.join('; ');
}

/**
 * Segnala (SOLO log, mai un prompt) quando l'effort effettivo di un turno
 * diverge dal livello di riferimento. Usata da `/team`/`/goal`
 * (`runMemberTurn`, strategies/common.ts) e dai figli di `spawn_agent`: per
 * vincolo esplicito di T8.14 questi contesti non chiedono MAI conferma, a
 * prescindere dalla modalità ask globale — solo la chat interattiva
 * (cli/index.ts) può farlo, tramite `confirmEffortDivergence` qui sotto.
 * No-op se non c'è divergenza.
 */
export function logEffortDivergence(
  agentLabel: string,
  effective: ReasoningEffort | undefined,
  configDefault: ReasoningEffort | undefined
): void {
  const reference = getReferenceEffort(configDefault);
  if (effective === reference) return;
  console.log(chalk.gray(
    `[Effort] ${agentLabel}: turno a '${effortLabel(effective)}' (riferimento: '${effortLabel(reference)}'${pin ? ', pin attivo' : ''}).`
  ));
}

/**
 * Versione interattiva usata SOLO dalla chat REPL (`cli/index.ts`): se la
 * modalità ask è attiva e l'effort diverge dal riferimento, chiede conferma
 * tramite `confirmFn` (iniettabile — nessuna dipendenza diretta da `prompts`
 * qui, per restare testabile senza stdin reale); altrimenti si comporta come
 * `logEffortDivergence`. Ritorna l'effort da usare per QUESTO turno soltanto:
 * un rifiuto ripiega sul riferimento, senza toccare pin/cascata per i turni
 * successivi.
 */
export async function confirmEffortDivergence(
  agentLabel: string,
  effective: ReasoningEffort | undefined,
  configDefault: ReasoningEffort | undefined,
  confirmFn: (effective: ReasoningEffort | undefined, reference: ReasoningEffort | undefined) => Promise<boolean>
): Promise<ReasoningEffort | undefined> {
  const currentPin = getEffortPin();
  if (currentPin !== undefined && effective === currentPin) {
    return effective;
  }
  const reference = getReferenceEffort(configDefault);
  if (effective === reference) return effective;
  if (!askMode) {
    logEffortDivergence(agentLabel, effective, configDefault);
    return effective;
  }
  const proceed = await confirmFn(effective, reference);
  if (proceed) return effective;
  console.log(chalk.yellow(
    `[Effort] Turno rifiutato a '${effortLabel(effective)}': eseguito invece al riferimento '${effortLabel(reference)}'.`
  ));
  return reference;
}
