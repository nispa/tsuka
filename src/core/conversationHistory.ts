import { ChatMessage } from './types';

export type MessageTokenEstimator = (message: Pick<ChatMessage, 'content' | 'tool_calls'>) => number;

/** Owns the mutable conversation array while keeping system-message invariants local. */
export class ConversationHistory {
  readonly messages: ChatMessage[] = [];

  clear(systemPrompt: string): void {
    this.messages.splice(0, this.messages.length, { role: 'system', content: systemPrompt });
  }

  setSystemPrompt(systemPrompt: string): void {
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = systemPrompt;
    } else {
      this.messages.unshift({ role: 'system', content: systemPrompt });
    }
  }

  replace(messages: ChatMessage[]): void {
    this.messages.splice(0, this.messages.length, ...messages);
  }

  /**
   * Removes the oldest messages while preserving the system message and avoiding
   * a history that starts in the middle of a tool response sequence.
   */
  prune(
    maxHistoryMessages: number,
    maxHistoryTokens: number,
    toolTokens: number,
    estimateTokens: MessageTokenEstimator,
    onPruned?: (removed: number) => void
  ): number {
    let start = 1;
    if (this.messages.length > maxHistoryMessages) {
      start = this.messages.length - (maxHistoryMessages - 1);
    }

    if (maxHistoryTokens > 0 && this.messages.length > 0) {
      let total = toolTokens + estimateTokens(this.messages[0]);
      for (let i = start; i < this.messages.length; i++) {
        total += estimateTokens(this.messages[i]);
      }
      while (total > maxHistoryTokens && start < this.messages.length - 3) {
        total -= estimateTokens(this.messages[start]);
        start++;
      }
    }

    while (start < this.messages.length - 1 && this.messages[start].role === 'tool') {
      start++;
    }

    const removed = start - 1;
    if (removed <= 0) return 0;

    this.replace([this.messages[0], ...this.messages.slice(start)]);
    onPruned?.(removed);
    return removed;
  }
}
