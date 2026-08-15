import { Tool } from '../registry';
import { Blackboard } from '../../core/blackboard';

/**
 * Tool di protocollo (T6.2, TASKS.md — FASE 2): scrive una nota sulla blackboard
 * del run corrente (`src/core/blackboard.ts`) — decisioni prese, artefatti
 * prodotti, punti aperti visibili a tutti i colleghi dello STESSO run, non
 * persistenti (muoiono col run, non finiscono mai in MemoryStore). Offerto solo
 * nei turni di team/goal (`runMemberTurn`, `strategies/common.ts`), riskLevel
 * SAFE come `report_status`/`route_next`/`cast_vote` — non è nella chat normale.
 */
export const postNoteTool: Tool = {
  name: 'post_note',
  riskLevel: 'SAFE',
  execute: async (args: { key: string; value: string }, context) => {
    const key = (args.key || '').trim();
    if (!key) {
      throw new Error("Specificare 'key': una chiave breve per la nota (es. 'decisione', 'artefatto').");
    }
    const value = (args.value || '').trim();
    if (!value) {
      throw new Error("Specificare 'value': il contenuto della nota.");
    }
    const blackboard = Blackboard.current();
    if (!blackboard) {
      // Nessuna degradazione silenziosa: se il tool viene invocato fuori da un run
      // attivo (non dovrebbe accadere, dato che è offerto solo nei turni di
      // team/goal), fallisce esplicitamente invece di scrivere altrove.
      throw new Error('post_note non è disponibile fuori da un run di team/goal attivo.');
    }
    const author = context?.requesterLabel || 'agente';
    blackboard.post(key, value, author);
    return `Nota registrata sulla blackboard del run: '${key}'.`;
  }
};
