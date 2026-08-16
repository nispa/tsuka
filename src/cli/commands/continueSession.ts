import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../../core/apphome';
import { InteractiveMenu } from '../ui';

/**
 * `/continue` command: forces resumption of an interrupted reasoning trace
 * from `memory/thinking/*.md` directly into the conversation.
 */

export interface ThinkingTraceEntry {
  filename: string;
  fullPath: string;
  mtime: Date;
  interrupted: boolean;
}

/** Lists thinking traces saved in memory/thinking/, sorted most recent first. */
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
 * Resolves which trace to resume: matching filename if arg provided,
 * or most recent in non-TTY, or interactive select menu in TTY.
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
    title: `${t.interrupted ? '⚠ interrupted' : '✔ complete'} · ${t.mtime.toLocaleString()} · ${t.filename}`,
    value: t.filename,
  }));
  const selected = await InteractiveMenu.select<string>(
    'Which reasoning trace would you like to resume? (use arrow keys)',
    choices
  );
  return traces.find((t) => t.filename === selected) || null;
}

/**
 * Builds user prompt directive containing the complete reasoning trace.
 */
export function buildResumeDirective(traceContent: string): string {
  const trimmed = (traceContent || '').trim();
  return `[FORCED RESUMPTION OF AN INTERRUPTED TASK]\n` +
    `This is your complete reasoning trace from the prior session on this exact task, saved before interruption:\n\n` +
    `---\n${trimmed}\n---\n\n` +
    `Do NOT restart from scratch or re-read workspace files from zero: the reasoning trace above is already complete. ` +
    `If it converges to a decision, take it and act IMMEDIATELY with tools (write/edit files). ` +
    `If minor doubts remain, resolve pragmatically in a sentence and proceed.`;
}
