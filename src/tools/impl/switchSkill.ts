import { Tool } from '../registry';

/**
 * Tool di protocollo per l'attivazione ed il cambio di skill (ruolo) in-session.
 * Valida la skill richiesta e conferma il cambio all'agente ed al contesto.
 */
export const switchSkillTool: Tool = {
  name: 'switch_skill',
  riskLevel: 'SAFE',
  execute: async (args: { skill: string; reason?: string }) => {
    const skill = (args.skill || '').trim().toLowerCase();
    if (!skill) {
      throw new Error("Il parametro 'skill' è obbligatorio per cambiare competenza.");
    }
    const reason = (args.reason || '').trim();
    const reasonMsg = reason ? ` (Motivo: ${reason})` : '';
    return `Skill commutata con successo su '${skill}'${reasonMsg}. Le competenze ed i tool della nuova skill sono ora attivi nel tuo contesto.`;
  }
};
