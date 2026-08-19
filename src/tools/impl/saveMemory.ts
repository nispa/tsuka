import { Tool } from '../registry';
import { MemoryStore } from '../../core/memory';

export const saveMemoryTool: Tool = {
  name: 'save_memory',
  riskLevel: 'SAFE',
  execute: async (args: { content: string; summary: string; global?: boolean }) => {
    const content = (args.content || '').trim();
    if (!content) {
      throw new Error("Memory content cannot be empty.");
    }
    if (content.length > 500) {
      throw new Error('Memory content too long (max 500 characters): summarize essential facts.');
    }
    const summary = (args.summary || '').trim();
    if (!summary) {
      // T14.20: every list of facts (the TUI's /memory picker, `recall_memory`'s results) shows
      // this, not `content` — the whole point is a caller who wrote an unreadable pile of nearly
      // identical entries. Reject rather than silently deriving one: a caller that skips this is
      // exactly the caller who needs to be told to stop and think of one.
      throw new Error("summary cannot be empty: a short label (like a commit subject) for what this memory holds, distinct from the full content.");
    }
    if (summary.length > 72) {
      throw new Error('summary too long (max 72 characters): shorten it to a single scannable label, keep the detail in content.');
    }

    const store = MemoryStore.getInstance();
    const opts = { summary, ...(args.global === true ? { scope: 'global' } : {}) };
    const fact = store.addFact(content, 'agent', opts);
    const scopeLabel = args.global === true ? 'global' : 'workspace';
    return `Fact saved to shared persistent memory (id: ${fact.id}, scope: ${scopeLabel}). It will be accessible across sessions.`;
  }
};
