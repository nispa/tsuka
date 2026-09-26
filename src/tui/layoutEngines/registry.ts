import { logSink } from '../../core/logSink';
import type { TuiLayoutEngine } from './types';

const engines = new Map<string, TuiLayoutEngine>();
const warned = new Set<string>();

/** Registers (or replaces) a layout engine; built-ins and plug-ins use the same call. */
export function registerLayoutEngine(engine: TuiLayoutEngine): void {
  engines.set(engine.id, engine);
}

export function listLayoutEngines(): TuiLayoutEngine[] {
  return Array.from(engines.values());
}

/**
 * The engine named in the layout config, or `fallbackId` when it is not registered
 * (a removed plug-in, a typo in tui.layout.json). Warned once per name: a missing
 * engine must not blank the screen, nor flood the log on every frame.
 */
export function resolveLayoutEngine(id: string, fallbackId: string): TuiLayoutEngine {
  const engine = engines.get(id);
  if (engine) return engine;
  if (!warned.has(id)) {
    warned.add(id);
    logSink.warn(`Layout engine '${id}' is not registered; using '${fallbackId}'.`);
  }
  const fallback = engines.get(fallbackId);
  if (!fallback) throw new Error(`Fallback layout engine '${fallbackId}' is not registered.`);
  return fallback;
}
