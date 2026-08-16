import * as fs from 'fs';
import { ConfigManager, CONFIG_PATH } from './config';

/**
 * Tetto di contesto per un singolo risultato di tool (T8.8).
 *
 * I limiti già esistenti nei singoli tool (5MB per `read_file`/`grep_search`, 50KB per
 * `execute_command`) sono guardie di sicurezza pensate per una finestra di contesto molto
 * più grande di quella reale del modello locale in uso (46k token): un solo risultato di
 * tool può saturarla prima che la potatura della history (`Agent.pruneHistory`) abbia la
 * possibilità di intervenire, perché a quel punto il messaggio con il risultato è già
 * stato costruito e inviato al modello.
 *
 * `capForContext` aggiunge un tetto più stretto, **in token stimati** (stessa convenzione
 * ~3,5 caratteri/token di `Agent.charsPerToken`, src/core/agent.ts), applicato all'INGRESSO
 * da ogni tool che può produrre output arbitrariamente grande. Non è un vicolo cieco: la
 * nota inserita al centro del testo tagliato dice sempre come recuperare la parte omessa
 * (`grep_search` per cercare un termine, `read_file` con `offset`/`limit` per paginare) —
 * il modello non deve mai accorciare da solo un contenuto, gli basta chiederne il resto.
 */

// Stima caratteri→token: fissa (non adattiva come Agent.charsPerToken) perché questo
// helper agisce prima che un Agent esista — è il primo filtro, non l'ultimo.
const CHARS_PER_TOKEN = 3.5;

const DEFAULT_RECOVERY_HINT =
  "Per il resto: usa grep_search per cercare un termine specifico, oppure read_file con " +
  "offset/limit (o startLine/endLine) per leggere la porzione successiva.";

// Istanza condivisa del ConfigManager, ricaricata solo se il file su disco cambia
// (stesso schema di webSearch.ts: evita di istanziare/ricaricare la config a ogni chiamata tool)
let cachedConfigManager: ConfigManager | null = null;
let cachedConfigMtime = -1;

function getSharedConfigManager(): ConfigManager {
  let mtime = -1;
  try {
    mtime = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {}
  if (!cachedConfigManager || mtime !== cachedConfigMtime) {
    cachedConfigManager = new ConfigManager();
    cachedConfigMtime = mtime;
  }
  return cachedConfigManager;
}

/** Tetto configurato (o di default) per un singolo risultato di tool, in token stimati. */
export function getMaxToolResultTokens(): number {
  return getSharedConfigManager().getMaxToolResultTokens();
}

export interface CapForContextOptions {
  /** Cosa si sta tagliando, usato nella nota (es. "file 'x.txt'", "output del comando"). */
  label?: string;
  /** Suggerimento su come recuperare la parte omessa. Sostituisce il default generico. */
  recoveryHint?: string;
}

/**
 * Se `text` supera il tetto (in token stimati), ritorna testa + coda con al centro una
 * nota esplicita che dichiara quanto è stato tagliato e come recuperare il resto.
 * Sotto il tetto, ritorna `text` invariato.
 *
 * @param text Il testo da limitare.
 * @param maxTokens Tetto in token stimati; default: `getMaxToolResultTokens()`.
 * @param options Etichetta e suggerimento di recupero da inserire nella nota di taglio.
 */
export function capForContext(text: string, maxTokens?: number, options: CapForContextOptions = {}): string {
  const limit = maxTokens ?? getMaxToolResultTokens();
  const maxChars = Math.max(0, Math.floor(limit * CHARS_PER_TOKEN));
  if (text.length <= maxChars) {
    return text;
  }

  const label = options.label || 'questo contenuto';
  const recoveryHint = options.recoveryHint || DEFAULT_RECOVERY_HINT;
  const totalTokensEst = Math.ceil(text.length / CHARS_PER_TOKEN);

  const note =
    `\n\n[--- TAGLIATO per restare sotto il tetto di contesto: ${label} è di ~${totalTokensEst} ` +
    `token stimati, qui mostrato solo un tetto di ~${limit} token. NON è un vicolo cieco: ${recoveryHint} ---]\n\n`;

  // Testa + coda: il centro (dove finiscono la maggior parte dei risultati non rilevanti
  // in output lunghi) è la parte sacrificata. 60/40 tra testa e coda: la testa contiene
  // di solito l'intestazione/i primi risultati, la coda l'esito finale (es. errori a fondo
  // output di un comando).
  const remaining = Math.max(0, maxChars - note.length);
  const headChars = Math.ceil(remaining * 0.6);
  const tailChars = remaining - headChars;

  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(text.length - tailChars) : '';

  return head + note + tail;
}

export type ReasoningEffortLevel = 'none' | 'low' | 'medium' | 'xhigh' | 'high';

export interface ReasoningBudgetResult {
  /** Livello di reasoning effort effettivo (eventualmente ridotto per evitare overflow) */
  effectiveEffort?: string;
  /** Indica se iniettare la direttiva di sintesi nel prompt */
  concisionRequired: boolean;
  /** Tetto massimo stimato di token di reasoning consentiti per questo round */
  maxReasoningTokens: number;
  /** Percentuale di contesto libero residuo */
  freeContextPercent: number;
}

/**
 * Calcola il budget e l'effort di ragionamento consentito in base al contesto residuo (T11.10).
 * Previene context overflow e troncamenti a metà CoT.
 */
export function calculateReasoningBudget(
  promptTokens: number,
  maxContextTokens: number,
  requestedEffort?: string
): ReasoningBudgetResult {
  const safeMax = Math.max(1024, maxContextTokens);
  const remaining = Math.max(0, safeMax - promptTokens);
  const freePercent = Math.round((remaining / safeMax) * 100);

  // Default se non specificato o se non è stringa
  const effort = typeof requestedEffort === 'string' ? requestedEffort.toLowerCase() : undefined;

  // Spazio abbondante (> 55% libero): nessun throttling
  if (freePercent > 55) {
    return {
      effectiveEffort: requestedEffort,
      concisionRequired: false,
      maxReasoningTokens: Math.min(8192, Math.floor(remaining * 0.6)),
      freeContextPercent: freePercent
    };
  }

  // Spazio medio (30% - 55% libero): consiglia concisione, abbassa solo se xhigh
  if (freePercent >= 30) {
    let throttledEffort = requestedEffort;
    if (effort === 'xhigh' || effort === 'high') {
      throttledEffort = 'medium';
    }
    return {
      effectiveEffort: throttledEffort,
      concisionRequired: true,
      maxReasoningTokens: Math.min(4096, Math.floor(remaining * 0.5)),
      freeContextPercent: freePercent
    };
  }

  // Spazio critico (< 30% libero): throttling aggressivo (low o none) e concisione obbligatoria
  let throttledEffort: string | undefined = 'none';
  if (effort === 'xhigh' || effort === 'high' || effort === 'medium') {
    throttledEffort = freePercent >= 15 ? 'low' : 'none';
  } else if (effort === 'low') {
    throttledEffort = freePercent >= 15 ? 'low' : 'none';
  } else {
    throttledEffort = requestedEffort;
  }

  return {
    effectiveEffort: throttledEffort,
    concisionRequired: true,
    maxReasoningTokens: Math.min(2048, Math.floor(remaining * 0.4)),
    freeContextPercent: freePercent
  };
}

