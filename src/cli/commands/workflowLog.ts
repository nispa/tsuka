import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../../core/apphome';
import { ChatMessage } from '../../core/types';
import { ProtocolLogEntry } from './strategies/common';
import { BlackboardNote } from '../../core/blackboard';

interface WorkflowLogInput {
  team: { name: string; displayName: string; mode?: string; members: string[]; orchestrator?: string };
  task: string;
  completed: boolean;
  failed: boolean;
  roundsDone: number;
  teamMessages: ChatMessage[];
  turnLog: ProtocolLogEntry[];
  /** Snapshot della blackboard del run (T6.2, TASKS.md — FASE 2): stato condiviso
   * *di questo run*, muore col run — qui viene solo fotografato per il log, non
   * riletto né riusato altrove. */
  blackboard: BlackboardNote[];
}

/**
 * Salva il report JSON di un workflow `/team` in `workflow_logs/` (silenzioso su
 * errore: un log mancato non deve far fallire il workflow). Include `protocolLog`
 * (T2.1): il meccanismo di decisione — tool_call/regex/fallback — di ogni turno.
 * Include `blackboard` (T6.2): lo snapshot delle note lasciate dagli agenti sulla
 * lavagna condivisa di QUESTO run (post_note/read_notes) — non è memoria
 * persistente, questa è l'unica traccia che ne resta dopo la fine del run.
 */
export function writeWorkflowLog(input: WorkflowLogInput): void {
  try {
    const { team, task, completed, failed, roundsDone, teamMessages, turnLog, blackboard } = input;
    const logsDir = homePath('workflow_logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const report = {
      team: team.name,
      displayName: team.displayName,
      mode: team.mode,
      task,
      completed,
      failed,
      roundsDone,
      members: team.members,
      orchestrator: team.orchestrator,
      timestamp: new Date().toISOString(),
      historySummary: teamMessages.filter((m) => m.role === 'assistant').slice(-10).map((m) =>
        typeof m.content === 'string' ? m.content.slice(0, 200) : ''
      ),
      protocolLog: turnLog,
      blackboard
    };
    fs.writeFileSync(
      path.join(logsDir, `${team.name}-${timestamp}.json`),
      JSON.stringify(report, null, 2),
      'utf-8'
    );
  } catch {}
}
