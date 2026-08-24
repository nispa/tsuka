import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { homePath } from './apphome';
import { MemoryStore } from './memory';
import { AGENT_DEFAULTS } from './constants';
import { logSink } from './logSink';

/** Persists a sufficiently long reasoning trace and indexes the resulting artifact. */
export function persistReasoningTrace(
  text: string,
  taskExcerpt: string,
  interrupted: boolean,
  agentLabel?: string
): void {
  const trimmed = (text || '').trim();
  if (trimmed.length < AGENT_DEFAULTS.reasoningTraceMinChars) return;

  try {
    const dir = homePath('memory', 'thinking');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const label = (agentLabel || 'agent').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 30) || 'agent';
    const filename = `${stamp}-${label}${interrupted ? '-interrupted' : ''}.md`;
    fs.writeFileSync(path.join(dir, filename), trimmed, 'utf-8');

    const shortTask = (taskExcerpt || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const status = interrupted ? 'interrupted' : 'complete';
    const pointer =
      `Reasoning trace ${status} (${trimmed.length} chars) on "${shortTask}" saved in ` +
      `memory/thinking/${filename} — read with read_file before re-evaluating the task from scratch.`;
    MemoryStore.getInstance().addFact(pointer.slice(0, 500), agentLabel || 'agent', {
      kind: 'run',
      summary: `Reasoning trace ${status}: "${shortTask}"`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logSink.error(chalk.gray(`[Unable to save reasoning trace: ${message}]`));
  }
}
