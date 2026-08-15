import { Tool } from '../registry';

const VALID_VOTES = ['APPROVO', 'MODIFICARE', 'RIFIUTO'];

/**
 * Tool di protocollo (T2.1, PLANNING-QUALITA.md): usato nei round di discussione
 * con voting attivo (team hybrid) per esprimere il voto, sostituendo il marker
 * testuale "VOTO: ...". team.ts legge la tool_call in runDiscussionRound;
 * l'execute qui valida solo l'input.
 */
export const castVoteTool: Tool = {
  name: 'cast_vote',
  riskLevel: 'SAFE',
  execute: async (args: { vote: string; reason: string }) => {
    const vote = (args.vote || '').trim().toUpperCase();
    if (!VALID_VOTES.includes(vote)) {
      throw new Error(`Voto non valido: '${args.vote}'. Usa uno tra ${VALID_VOTES.join(', ')}.`);
    }
    const reason = (args.reason || '').trim();
    if (!reason) {
      throw new Error("Specificare 'reason' a supporto del voto.");
    }
    return `Voto registrato: ${vote}.`;
  }
};
