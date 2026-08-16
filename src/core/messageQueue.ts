/**
 * Inter-agent message queue (ephemeral, current session only).
 * Allows an agent to leave a message for a colleague, which will be received
 * at the start of their next turn.
 */

export interface PendingMessage {
  from: string;
  to: string;
  message: string;
  timestamp: number;
}

let currentSenderName = 'agent';

/** Sets the current sender name (called before each agent turn). */
export function setCurrentSenderName(name: string): void {
  currentSenderName = name;
}

export function getCurrentSenderName(): string {
  return currentSenderName;
}

const queue: PendingMessage[] = [];

export function enqueueMessage(to: string, message: string): PendingMessage {
  const entry: PendingMessage = { from: currentSenderName, to: to.toLowerCase(), message, timestamp: Date.now() };
  queue.push(entry);
  return entry;
}

export function dequeueMessages(agentName: string): PendingMessage[] {
  const target = agentName.toLowerCase();
  const idx = queue.findIndex((m) => m.to === target);
  if (idx === -1) return [];
  // Collect all messages for this agent (not just the first one)
  const all: PendingMessage[] = [];
  let i = queue.length;
  while (i--) {
    if (queue[i].to === target) {
      all.unshift(queue[i]);
      queue.splice(i, 1);
    }
  }
  return all;
}

export function formatPendingMessages(messages: PendingMessage[]): string {
  if (messages.length === 0) return '';
  return messages
    .map((m) => `[Message from @${m.from}]: ${m.message}`)
    .join('\n');
}

export function clearMessageQueue(): void {
  queue.length = 0;
}
