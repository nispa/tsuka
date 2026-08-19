import { Tool } from '../registry';
import { MemoryStore, GLOBAL_SCOPE, AddFactOptions, resolveMemoryKind } from '../../core/memory';

export const saveMemoryTool: Tool = {
  name: 'save_memory',
  riskLevel: 'SAFE',
  execute: async (args: { content: string; summary?: string; kind?: string; global?: boolean }) => {
    const content = (args.content || '').trim();
    if (!content) {
      throw new Error("Memory content cannot be empty.");
    }
    if (content.length > 500) {
      throw new Error('Memory content too long (max 500 characters): summarize essential facts.');
    }

    const opts: AddFactOptions = {};
    if (args.summary && args.summary.trim().length > 0) {
      // T15.3: an overlong summary is capped downstream by addFact (normalizeSummary, 72 chars),
      // the same rule that applies to every derived summary — one cap, not two policies.
      opts.summary = args.summary.trim();
    }
    if (args.kind) {
      opts.kind = resolveMemoryKind(args.kind);
    }
    if (args.global === true) {
      opts.scope = GLOBAL_SCOPE;
    }

    const store = MemoryStore.getInstance();
    const fact = store.addFact(content, 'agent', opts);
    const scopeLabel = args.global === true ? 'global' : 'workspace';
    return `Fact saved to shared persistent memory (id: ${fact.id}, scope: ${scopeLabel}). It will be accessible across sessions.`;
  }
};
