import { Tool } from '../registry';
import { MemoryStore, resolveMemoryKind } from '../../core/memory';

export const updateMemoryTool: Tool = {
  name: 'update_memory',
  riskLevel: 'SAFE',
  execute: async (args: { id: string; content?: string; summary?: string; kind?: string; tags?: string[] }) => {
    const id = (args.id || '').trim();
    if (!id) {
      throw new Error('Memory id cannot be empty: use recall_memory to find the fact id first.');
    }
    const patch: { content?: string; summary?: string; kind?: import('../../core/memory').MemoryKind; tags?: string[] } = {};
    if (args.content !== undefined) {
      const content = args.content.trim();
      if (!content) {
        throw new Error('Updated content cannot be empty; omit the field to keep the current content.');
      }
      if (content.length > 500) {
        throw new Error('Updated content too long (max 500 characters): summarize essential facts.');
      }
      patch.content = content;
    }
    if (args.summary && args.summary.trim().length > 0) {
      patch.summary = args.summary.trim();
    }
    if (args.kind) {
      patch.kind = resolveMemoryKind(args.kind);
    }
    if (Array.isArray(args.tags) && args.tags.length > 0) {
      patch.tags = args.tags.map(String);
    }

    const store = MemoryStore.getInstance();
    const updated = store.updateFact(id, patch);
    if (!updated) {
      throw new Error(`No memory fact found with id '${id}'. Use recall_memory to search the store.`);
    }
    return JSON.stringify({
      ok: true,
      id: updated.id,
      summary: updated.summary,
      kind: updated.kind,
      content: updated.content,
      tags: updated.tags ?? [],
    });
  }
};