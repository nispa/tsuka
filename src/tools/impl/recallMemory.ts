import { Tool } from '../registry';
import { MemoryStore } from '../../core/memory';

export const recallMemoryTool: Tool = {
  name: 'recall_memory',
  riskLevel: 'SAFE',
  execute: async (args: { query?: string; limit?: number }) => {
    const store = MemoryStore.getInstance();
    const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 50) : 10;
    const results = args.query ? store.search(args.query, limit) : store.getRecent(limit);

    if (results.length === 0) {
      return args.query
        ? `Nessun ricordo trovato nella memoria condivisa per "${args.query}".`
        : 'La memoria condivisa è vuota: nessun fatto salvato finora.';
    }

    const header = args.query
      ? `Trovati ${results.length} ricordi per "${args.query}":`
      : `Ultimi ${results.length} ricordi nella memoria condivisa:`;

    const lines = results.map(
      (f) => `- [${f.timestamp.slice(0, 10)}] (${f.source}) ${f.content}`
    );
    return `${header}\n${lines.join('\n')}`;
  }
};
