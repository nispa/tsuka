/**
 * Injectable logging sink for core and tools. `agentEvents.ts` declares that the core
 * should not print directly — but several utility classes (`MemoryStore`, `ConfigManager`,
 * `ToolRegistry`, `RunController`, tools themselves) run outside of `Agent.run()` and do
 * not have an `AgentEventHandler` available. This module provides a single, replaceable
 * output sink.
 *
 * Default: standard console printing. Custom UI layers or quiet test runners can call
 * `setLogSink()`. The default resolves `console.*` at call time, maintaining compatibility
 * with `logBuffer.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { homePath } from './apphome';

export interface LogSink {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function appendToFileLog(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  try {
    const logsDir = homePath('logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFile = path.join(logsDir, 'tsuka.log');
    const timestamp = new Date().toISOString();
    const cleanMsg = (message || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (cleanMsg) {
      fs.appendFileSync(logFile, `[${timestamp}] [${level}] ${cleanMsg}\n`, 'utf-8');
    }
  } catch {}
}

const defaultSink: LogSink = {
  log: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
};

let activeSink: LogSink = defaultSink;

/** Replaces the active log sink (e.g. to route to a UI other than the CLI). */
export function setLogSink(sink: LogSink): void {
  activeSink = sink;
}

/** Restores default console logging behavior. Useful in tests. */
export function resetLogSink(): void {
  activeSink = defaultSink;
}

/** Logging sink to use instead of direct `console.*` in core/tools. */
export const logSink = {
  log: (message: string) => {
    activeSink.log(message);
  },
  warn: (message: string) => {
    appendToFileLog('WARN', message);
    activeSink.warn(message);
  },
  error: (message: string) => {
    appendToFileLog('ERROR', message);
    activeSink.error(message);
  },
};

