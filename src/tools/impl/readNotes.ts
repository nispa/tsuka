import { Tool } from '../registry';
import { Blackboard } from '../../core/blackboard';

/**
 * Protocol tool (T6.2): reads notes left by team members on the current run blackboard (`src/core/blackboard.ts`),
 * with optional key prefix filtering. Available only during team/goal turns.
 */
export const readNotesTool: Tool = {
  name: 'read_notes',
  riskLevel: 'SAFE',
  execute: async (args: { prefix?: string }) => {
    const blackboard = Blackboard.current();
    if (!blackboard) {
      throw new Error('read_notes is only available within an active team/goal run.');
    }
    const prefix = (args.prefix || '').trim() || undefined;
    const notes = blackboard.read(prefix);
    if (notes.length === 0) {
      return prefix
        ? `No notes on the blackboard starting with key prefix '${prefix}'.`
        : 'No notes on the blackboard for this run.';
    }
    return notes
      .map((n) => `[${n.key}] (${n.author}, ${n.timestamp}): ${n.value}`)
      .join('\n');
  }
};
