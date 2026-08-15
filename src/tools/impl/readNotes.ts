import { Tool } from '../registry';
import { Blackboard } from '../../core/blackboard';

/**
 * Tool di protocollo (T6.2, TASKS.md — FASE 2): legge le note lasciate dai
 * colleghi sulla blackboard del run corrente (`src/core/blackboard.ts`), con
 * filtro opzionale per prefisso di key. Stesso ambito di offerta di `post_note`:
 * solo nei turni di team/goal, non nella chat normale.
 */
export const readNotesTool: Tool = {
  name: 'read_notes',
  riskLevel: 'SAFE',
  execute: async (args: { prefix?: string }) => {
    const blackboard = Blackboard.current();
    if (!blackboard) {
      throw new Error('read_notes non è disponibile fuori da un run di team/goal attivo.');
    }
    const prefix = (args.prefix || '').trim() || undefined;
    const notes = blackboard.read(prefix);
    if (notes.length === 0) {
      return prefix
        ? `Nessuna nota sulla blackboard con chiave che inizia per '${prefix}'.`
        : 'Nessuna nota sulla blackboard per questo run.';
    }
    return notes
      .map((n) => `[${n.key}] (${n.author}, ${n.timestamp}): ${n.value}`)
      .join('\n');
  }
};
