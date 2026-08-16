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
        ? `No memories found in shared memory matching "${args.query}".`
        : 'Shared memory is empty: no facts saved yet.';
    }

    const header = args.query
      ? `Found ${results.length} memory item(s) for "${args.query}":`
      : `Recent ${results.length} memory item(s) in shared memory:`;

    const lines = results.map(
      (f) => `- [${f.timestamp.slice(0, 10)}] (${f.source}) ${f.content}`
    );
    return `${header}\n${lines.join('\n')}`;
  }
};
