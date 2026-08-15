import * as fs from 'fs';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { resolveSafePath } from '../tools/impl/utils';
import { executeCommandTool } from '../tools/impl/executeCommand';
import { PermissionManager } from '../safety/permissions';
import { ILLMProvider } from './provider';
import { Blackboard } from './blackboard';

export interface AcceptanceCriteria {
  /** Comando shell da eseguire (deve restituire exit code 0 per superare l'acceptance). */
  command?: string;
  /** Path relativo o assoluto ad un file che deve esistere sul disco. */
  fileExists?: string;
  /** Path relativo o assoluto ad un file JSON che deve esistere ed essere parsabile senza errori. */
  jsonValid?: string;
}

export interface RunLoopOptions {
  /** Compito o obiettivo iniziale. */
  task: string;
  /** Numero massimo di tentativi (default: 3). */
  maxAttempts?: number;
  /** Criteri oggettivi di accettazione (opzionale). */
  acceptance?: AcceptanceCriteria;
  /**
   * Funzione per eseguire un singolo tentativo.
   * Riceve il prompt (che include gli eventuali feedback di errore dei tentativi precedenti) ed il numero di tentativo (0-indexed).
   */
  executeAttempt: (
    prompt: string,
    attemptIndex: number
  ) => Promise<{ answer: string; issues?: string[]; modifiedFiles?: string[] }>;
  /** Etichetta dell'agente o del run (usata per permission manager e log). */
  agentLabel?: string;
  /** PermissionManager per autorizzare comandi in acceptance (opzionale). */
  permissionManager?: PermissionManager;
  /** Provider LLM per autorizzare comandi in acceptance (opzionale). */
  provider?: ILLMProvider;
}

export interface RunLoopResult {
  /** Esito del ciclo: success (tutto approvato), failed (maxAttempts raggiunto), no_progress (stallo/tentativo identico). */
  outcome: 'success' | 'failed' | 'no_progress';
  /** Numero totale di tentativi eseguiti. */
  attemptsCount: number;
  /** Risposta finale fornita dall'esecutore nell'ultimo tentativo. */
  finalAnswer: string;
  /** Eventuali problemi o rilievi rimasti aperti a fine run. */
  issues: string[];
  /** Firma del tentativo finale (per diagnostica/test). */
  lastSignature?: string;
}

/**
  * Calcola una firma deterministica del tentativo basata sul testo della risposta
  * (normalizzato nei caratteri spaziali) e sull'elenco ordinato dei file modificati.
  */
export function calculateAttemptSignature(answer: string, modifiedFiles: string[] = []): string {
  const normText = (answer || '').replace(/\s+/g, ' ').trim();
  const sortedFiles = [...modifiedFiles].sort().join(';');
  const raw = `${normText}::FILES::${sortedFiles}`;
  return crypto.createHash('sha256').update(raw, 'utf-8').digest('hex');
}

/**
 * Esegue la verifica dei criteri oggettivi di accettazione (Acceptance Criteria).
 * Ritorna un elenco di issue/errori riscontrati (vuoto se tutti i criteri sono superati).
 */
export async function checkAcceptance(
  acceptance: AcceptanceCriteria,
  permissionManager?: PermissionManager,
  provider?: ILLMProvider,
  agentLabel?: string
): Promise<string[]> {
  const issues: string[] = [];

  // 1) Verifica esistenza file
  if (acceptance.fileExists) {
    const safePath = resolveSafePath(acceptance.fileExists);
    if (!fs.existsSync(safePath)) {
      issues.push(`File richiesto non trovato sul disco: '${acceptance.fileExists}'.`);
    }
  }

  // 2) Verifica validità JSON
  if (acceptance.jsonValid) {
    const safePath = resolveSafePath(acceptance.jsonValid);
    if (!fs.existsSync(safePath)) {
      issues.push(`File JSON richiesto non trovato sul disco: '${acceptance.jsonValid}'.`);
    } else {
      try {
        const raw = fs.readFileSync(safePath, 'utf-8');
        JSON.parse(raw);
      } catch (err: any) {
        issues.push(`Il file '${acceptance.jsonValid}' contiene JSON non valido: ${err.message}.`);
      }
    }
  }

  // 3) Verifica comando shell (exit code 0)
  if (acceptance.command) {
    try {
      if (permissionManager) {
        const allowed = await permissionManager.checkPermission(
          'execute_command',
          acceptance.command,
          'DANGEROUS',
          agentLabel || 'RunController'
        );
        if (!allowed) {
          issues.push(`Comando di acceptance '${acceptance.command}' rifiutato dall'utente o dal PermissionManager.`);
          return issues;
        }
      }
      const output = await executeCommandTool.execute({ command: acceptance.command });
      if (output.includes('[Il processo è terminato con codice di errore:') || output.includes('[ERRORE:')) {
        issues.push(`Il comando di verifica '${acceptance.command}' ha fallito. Output:\n${output.slice(0, 1000)}`);
      }
    } catch (err: any) {
      issues.push(`Errore durante l'esecuzione del comando di verifica '${acceptance.command}': ${err.message}.`);
    }
  }

  return issues;
}

/**
 * Esegue il loop di controllo agentico (RunController): esegui → verifica → correggi.
 */
export async function runLoop(options: RunLoopOptions): Promise<RunLoopResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  let currentPrompt = options.task;
  let previousSignature: string | null = null;
  let lastAnswer = '';
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log(chalk.gray(`\n[RunController] Tentativo ${attempt + 1} di ${maxAttempts}...`));

    // Esegue il tentativo corrente
    const attemptResult = await options.executeAttempt(currentPrompt, attempt);
    lastAnswer = attemptResult.answer || '';
    const currentIssues: string[] = [...(attemptResult.issues || [])];

    // Calcolo della firma anti-stallo
    const signature = calculateAttemptSignature(lastAnswer, attemptResult.modifiedFiles);
    if (previousSignature !== null && signature === previousSignature) {
      console.log(chalk.yellow(`\n[RunController] Rilevato stallo (no_progress): la risposta ed i file prodotti nel tentativo ${attempt + 1} sono identici al precedente.`));
      
      const bb = Blackboard.current();
      if (bb) {
        bb.post('loop_stalled', `Stallo rilevato al tentativo ${attempt + 1}: risposta e file identici.`, options.agentLabel || 'RunController');
      }

      return {
        outcome: 'no_progress',
        attemptsCount: attempt + 1,
        finalAnswer: lastAnswer,
        issues: ['Stallo rilevato: nessuna modifica o progresso rispetto al tentativo precedente.'],
        lastSignature: signature
      };
    }
    previousSignature = signature;

    // Se opzionalmente definiti, esegue i controlli di acceptance oggettivi
    if (options.acceptance) {
      const acceptanceIssues = await checkAcceptance(
        options.acceptance,
        options.permissionManager,
        options.provider,
        options.agentLabel
      );
      currentIssues.push(...acceptanceIssues);
    }

    lastIssues = currentIssues;

    // Se non ci sono problemi/issues, il task è completato con successo
    if (currentIssues.length === 0) {
      console.log(chalk.green(`\n[RunController] Tentativo ${attempt + 1} superato con successo!`));
      return {
        outcome: 'success',
        attemptsCount: attempt + 1,
        finalAnswer: lastAnswer,
        issues: [],
        lastSignature: signature
      };
    }

    // Se ci sono problemi ed abbiamo ancora tentativi disponibili, prepariamo il prompt di correzione
    console.log(chalk.yellow(`\n[RunController] Tentativo ${attempt + 1} non superato. Trovate ${currentIssues.length} issue da correggere.`));

    // Registra le issue sulla lavagna di run se attiva
    const bb = Blackboard.current();
    if (bb) {
      bb.post(
        'loop_issues',
        `Tentativo ${attempt + 1} fallito. Issue: ${currentIssues.join(' | ')}`,
        options.agentLabel || 'RunController'
      );
    }

    // Costruisce il prompt arricchito con il feedback puntuale sui problemi riscontrati
    const formattedIssues = currentIssues.map((issue) => `- ${issue}`).join('\n');
    currentPrompt = `${options.task}\n\n[SISTEMA — FEEDBACK DI CORREZIONE DAI TENTATIVI PRECEDENTI]:
Nel tentativo precedente sono stati riscontrati i seguenti problemi concreti. Correggili nel tuo prossimo intervento:
${formattedIssues}`;
  }

  // Budget di tentativi esaurito senza superare le verifiche
  console.log(chalk.red(`\n[RunController] Esauriti i ${maxAttempts} tentativi disponibili senza superare tutte le verifiche.`));
  return {
    outcome: 'failed',
    attemptsCount: maxAttempts,
    finalAnswer: lastAnswer,
    issues: lastIssues,
    lastSignature: previousSignature || undefined
  };
}
