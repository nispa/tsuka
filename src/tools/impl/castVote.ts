import { Tool } from '../registry';

const VALID_VOTES = ['APPROVO', 'MODIFICARE', 'RIFIUTO'];

/**
 * Protocol tool (T2.1): used in discussion rounds with voting enabled (hybrid teams)
 * to cast structured votes.
 */
export const castVoteTool: Tool = {
  name: 'cast_vote',
  riskLevel: 'SAFE',
  execute: async (args: { vote: string; reason: string }) => {
    const vote = (args.vote || '').trim().toUpperCase();
    if (!VALID_VOTES.includes(vote)) {
      throw new Error(`Invalid vote: '${args.vote}'. Use one of: ${VALID_VOTES.join(', ')}.`);
    }
    const reason = (args.reason || '').trim();
    if (!reason) {
      throw new Error("Please specify 'reason' supporting your vote.");
    }
    return `Vote recorded: ${vote}.`;
  }
};
