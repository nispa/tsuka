import * as fs from 'fs';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { resolveSafePath } from '../tools/impl/utils';
import { executeCommandTool } from '../tools/impl/executeCommand';
import { PermissionManager } from '../safety/permissions';
import { ILLMProvider } from './provider';
import { Blackboard } from './blackboard';
import { logSink } from './logSink';

export interface AcceptanceCriteria {
  /** Shell command to execute (must return exit code 0 to pass acceptance). */
  command?: string;
  /** Relative or absolute path to a file that must exist on disk. */
  fileExists?: string;
  /** Relative or absolute path to a JSON file that must exist and parse cleanly. */
  jsonValid?: string;
}

export interface RunLoopOptions {
  /** Initial task or goal. */
  task: string;
  /** Maximum number of attempts (default: 3). */
  maxAttempts?: number;
  /** Objective acceptance criteria (optional). */
  acceptance?: AcceptanceCriteria;
  /**
   * Execution function for a single attempt.
   * Receives prompt (including issue feedback from prior attempts) and attempt index (0-indexed).
   */
  executeAttempt: (
    prompt: string,
    attemptIndex: number
  ) => Promise<{ answer: string; issues?: string[]; modifiedFiles?: string[] }>;
  /** Agent or run label (for permission manager and logs). */
  agentLabel?: string;
  /** PermissionManager for authorizing acceptance commands (optional). */
  permissionManager?: PermissionManager;
  /** LLM Provider for authorizing acceptance commands (optional). */
  provider?: ILLMProvider;
}

export interface RunLoopResult {
  /** Execution outcome: success (passed), failed (maxAttempts reached), no_progress (stalled/identical). */
  outcome: 'success' | 'failed' | 'no_progress';
  /** Total number of attempts executed. */
  attemptsCount: number;
  /** Final answer returned by executor in the last attempt. */
  finalAnswer: string;
  /** Issues remaining open at end of run. */
  issues: string[];
  /** Deterministic signature of the final attempt (for diagnostics/tests). */
  lastSignature?: string;
}

/**
 * Calculates a deterministic attempt signature based on normalized answer text and modified files.
 */
export function calculateAttemptSignature(answer: string, modifiedFiles: string[] = []): string {
  const normText = (answer || '').replace(/\s+/g, ' ').trim();
  const sortedFiles = [...modifiedFiles].sort().join(';');
  const raw = `${normText}::FILES::${sortedFiles}`;
  return crypto.createHash('sha256').update(raw, 'utf-8').digest('hex');
}

/**
 * Verifies objective acceptance criteria.
 * Returns an array of issues found (empty if all passed).
 */
export async function checkAcceptance(
  acceptance: AcceptanceCriteria,
  permissionManager?: PermissionManager,
  provider?: ILLMProvider,
  agentLabel?: string
): Promise<string[]> {
  const issues: string[] = [];

  // 1) File existence check
  if (acceptance.fileExists) {
    const safePath = resolveSafePath(acceptance.fileExists);
    if (!fs.existsSync(safePath)) {
      issues.push(`Required file not found on disk: '${acceptance.fileExists}'.`);
    }
  }

  // 2) JSON validity check
  if (acceptance.jsonValid) {
    const safePath = resolveSafePath(acceptance.jsonValid);
    if (!fs.existsSync(safePath)) {
      issues.push(`Required JSON file not found on disk: '${acceptance.jsonValid}'.`);
    } else {
      try {
        const raw = fs.readFileSync(safePath, 'utf-8');
        JSON.parse(raw);
      } catch (err: any) {
        issues.push(`File '${acceptance.jsonValid}' contains invalid JSON: ${err.message}.`);
      }
    }
  }

  // 3) Shell command check (exit code 0)
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
          issues.push(`Acceptance command '${acceptance.command}' rejected by user or PermissionManager.`);
          return issues;
        }
      }
      const output = await executeCommandTool.execute({ command: acceptance.command });
      if (output.includes('[Il processo è terminato con codice di errore:') || output.includes('[ERRORE:')) {
        issues.push(`Verification command '${acceptance.command}' failed. Output:\n${output.slice(0, 1000)}`);
      }
    } catch (err: any) {
      issues.push(`Error executing verification command '${acceptance.command}': ${err.message}.`);
    }
  }

  return issues;
}

/**
 * Executes the iterative agentic control loop (RunController): execute -> verify -> correct.
 */
export async function runLoop(options: RunLoopOptions): Promise<RunLoopResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  let currentPrompt = options.task;
  let previousSignature: string | null = null;
  let lastAnswer = '';
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    logSink.log(chalk.gray(`\n[RunController] Attempt ${attempt + 1} of ${maxAttempts}...`));

    // Execute current attempt
    const attemptResult = await options.executeAttempt(currentPrompt, attempt);
    lastAnswer = attemptResult.answer || '';
    const currentIssues: string[] = [...(attemptResult.issues || [])];

    // Anti-stall signature check
    const signature = calculateAttemptSignature(lastAnswer, attemptResult.modifiedFiles);
    if (previousSignature !== null && signature === previousSignature) {
      logSink.log(chalk.yellow(`\n[RunController] Stall detected (no_progress): answer and modified files in attempt ${attempt + 1} are identical to previous attempt.`));
      
      const bb = Blackboard.current();
      if (bb) {
        bb.post('loop_stalled', `Stall detected at attempt ${attempt + 1}: identical answer and files.`, options.agentLabel || 'RunController');
      }

      return {
        outcome: 'no_progress',
        attemptsCount: attempt + 1,
        finalAnswer: lastAnswer,
        issues: ['Stall detected: no changes or progress compared to prior attempt.'],
        lastSignature: signature
      };
    }
    previousSignature = signature;

    // Check acceptance criteria if defined
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

    // If no issues, task succeeded
    if (currentIssues.length === 0) {
      logSink.log(chalk.green(`\n[RunController] Attempt ${attempt + 1} passed successfully!`));
      return {
        outcome: 'success',
        attemptsCount: attempt + 1,
        finalAnswer: lastAnswer,
        issues: [],
        lastSignature: signature
      };
    }

    // If issues remain, prepare feedback prompt for next attempt
    logSink.log(chalk.yellow(`\n[RunController] Attempt ${attempt + 1} failed. Found ${currentIssues.length} issue(s) to correct.`));

    const bb = Blackboard.current();
    if (bb) {
      bb.post(
        'loop_issues',
        `Attempt ${attempt + 1} failed. Issues: ${currentIssues.join(' | ')}`,
        options.agentLabel || 'RunController'
      );
    }

    const formattedIssues = currentIssues.map((issue) => `- ${issue}`).join('\n');
    currentPrompt = `${options.task}\n\n[SYSTEM — CORRECTION FEEDBACK FROM PREVIOUS ATTEMPTS]:\nThe following concrete issues were found in the previous attempt. Fix them in your next action:\n${formattedIssues}`;
  }

  // Attempts exhausted without passing verification
  logSink.log(chalk.red(`\n[RunController] Exhausted ${maxAttempts} available attempts without satisfying all criteria.`));
  return {
    outcome: 'failed',
    attemptsCount: maxAttempts,
    finalAnswer: lastAnswer,
    issues: lastIssues,
    lastSignature: previousSignature || undefined
  };
}
