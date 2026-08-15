/**
 * Coda messaggi tra agenti (effimera, solo sessione corrente).
 * Permette a un agente di lasciare un messaggio per un collega,
 * che lo riceverà all'inizio del suo prossimo turno.
 */

export interface PendingMessage {
  from: string;
  to: string;
  message: string;
  timestamp: number;
}

let currentSenderName = 'agente';

/** Imposta il nome del mittente corrente (chiamato prima di ogni turno agente). */
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
  // Raccoglie TUTTI i messaggi per questo agente (non solo il primo)
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
    .map((m) => `[Messaggio da @${m.from}]: ${m.message}`)
    .join('\n');
}

export function clearMessageQueue(): void {
  queue.length = 0;
}
