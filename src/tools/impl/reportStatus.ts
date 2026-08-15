import { Tool } from '../registry';

const VALID_STATUSES = ['COMPLETATO', 'DA_CONTINUARE', 'FALLITO'];

/**
 * Tool di protocollo (T2.1, PLANNING-QUALITA.md): sostituisce il marker testuale
 * "STATO: ..." con una tool call strutturata. team.ts legge la tool_call dalla
 * cronologia del turno per decidere l'esito (vedi resolveTurnStatus); l'execute
 * qui sotto valida solo l'input e conferma al modello, non decide nulla da sé.
 */
export const reportStatusTool: Tool = {
  name: 'report_status',
  riskLevel: 'SAFE',
  execute: async (args: { status: string; summary: string; next_hint?: string }) => {
    const status = (args.status || '').trim().toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Stato non valido: '${args.status}'. Usa uno tra ${VALID_STATUSES.join(', ')}.`);
    }
    const summary = (args.summary || '').trim();
    if (!summary) {
      throw new Error("Il campo 'summary' non può essere vuoto: descrivi cosa hai fatto o cosa manca.");
    }
    return `Stato registrato: ${status}.`;
  }
};
