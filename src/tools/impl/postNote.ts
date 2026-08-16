import { Tool } from '../registry';
import { Blackboard } from '../../core/blackboard';

/**
 * Protocol tool (T6.2): writes a note to the current run blackboard (`src/core/blackboard.ts`)
 * — decisions made, artifacts created, open items visible to team members in the SAME run.
 * Non-persistent (dies with the run). Available only during team/goal turns.
 */
export const postNoteTool: Tool = {
  name: 'post_note',
  riskLevel: 'SAFE',
  execute: async (args: { key: string; value: string }, context) => {
    const key = (args.key || '').trim();
    if (!key) {
      throw new Error("Please specify 'key': a short note key (e.g. 'decision', 'artifact').");
    }
    const value = (args.value || '').trim();
    if (!value) {
      throw new Error("Please specify 'value': the note content.");
    }
    const blackboard = Blackboard.current();
    if (!blackboard) {
      throw new Error('post_note is only available within an active team/goal run.');
    }
    const author = context?.requesterLabel || 'agent';
    blackboard.post(key, value, author);
    return `Note recorded on run blackboard: '${key}'.`;
  }
};
