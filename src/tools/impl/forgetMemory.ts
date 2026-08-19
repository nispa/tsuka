import { Tool } from '../registry';
import { MemoryStore } from '../../core/memory';

export const forgetMemoryTool: Tool = {
  name: 'forget_memory',
  riskLevel: 'SAFE',
  execute: async (args: { id: string }) => {
    const id = (args.id || '').trim();
    if (!id) {
      throw new Error('Memory id cannot be empty: use recall_memory to find the fact id first.');
    }
    const store = MemoryStore.getInstance();
    const removed = store.forgetFact(id);
    if (!removed) {
      throw new Error(`No memory fact found with id '${id}'. Use recall_memory to search the store.`);
    }
    return JSON.stringify({ ok: true, removed: id });
  }
};