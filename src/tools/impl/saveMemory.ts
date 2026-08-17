import { Tool } from '../registry';
import { MemoryStore } from '../../core/memory';

export const saveMemoryTool: Tool = {
  name: 'save_memory',
  riskLevel: 'SAFE',
  execute: async (args: { content: string; global?: boolean }) => {
    const content = (args.content || '').trim();
    if (!content) {
      throw new Error("Memory content cannot be empty.");
    }
    if (content.length > 500) {
      throw new Error('Memory content too long (max 500 characters): summarize essential facts.');
    }

    const store = MemoryStore.getInstance();
    const opts = args.global === true ? { scope: 'global' } : undefined;
    const fact = store.addFact(content, 'agent', opts);
    const scopeLabel = args.global === true ? 'global' : 'workspace';
    return `Fact saved to shared persistent memory (id: ${fact.id}, scope: ${scopeLabel}). It will be accessible across sessions.`;
  }
};
