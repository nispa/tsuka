import { Tool } from '../registry';

/**
 * Tool di protocollo (T2.1, PLANNING-QUALITA.md): usato dall'orchestrator di un
 * team in modalità "orchestrated" per decidere chi lavora al prossimo turno,
 * sostituendo il marker testuale "AGENTE: @nome" / "FINE". team.ts legge la
 * tool_call in runOrchestrated; l'execute qui valida solo l'input.
 */
export const routeNextTool: Tool = {
  name: 'route_next',
  riskLevel: 'SAFE',
  execute: async (args: { agent: string; reason: string }) => {
    const agent = (args.agent || '').trim();
    if (!agent) {
      throw new Error("Specificare 'agent': il nome del membro a cui passare il turno, oppure 'FINE'.");
    }
    const reason = (args.reason || '').trim();
    if (!reason) {
      throw new Error("Specificare 'reason': perché questo membro (o la fine del lavoro) è la scelta giusta.");
    }
    return `Routing registrato verso: ${agent}.`;
  }
};
