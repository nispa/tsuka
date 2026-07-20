import { Tool } from '../registry';
import { MemoryStore } from '../../core/memory';

export const saveMemoryTool: Tool = {
  name: 'save_memory',
  riskLevel: 'SAFE',
  execute: async (args: { content: string }) => {
    const content = (args.content || '').trim();
    if (!content) {
      throw new Error("Il contenuto del ricordo non può essere vuoto.");
    }
    if (content.length > 500) {
      throw new Error('Ricordo troppo lungo (max 500 caratteri): sintetizza il fatto essenziale.');
    }

    const store = MemoryStore.getInstance();
    const fact = store.addFact(content, 'agente');
    return `Fatto salvato nella memoria condivisa persistente (id: ${fact.id}). Sarà disponibile a tutti gli agenti e anche nelle sessioni future.`;
  }
};
