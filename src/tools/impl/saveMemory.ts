import { Tool } from '../registry';
import { MemoryStore } from '../../core/memory';

export const saveMemoryTool: Tool = {
  name: 'save_memory',
  riskLevel: 'SAFE',
  execute: async (args: { content: string }) => {
    const content = (args.content || '').trim();
    if (!content) {
      throw new Error("Memory content cannot be empty.");
    }
    if (content.length > 500) {
      throw new Error('Memory content too long (max 500 characters): summarize essential facts.');
    }

    const store = MemoryStore.getInstance();
    const fact = store.addFact(content, 'agent');
    return `Fact saved to shared persistent memory (id: ${fact.id}). It will be accessible across sessions.`;
  }
};
