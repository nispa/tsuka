import { Tool } from '../registry';
import { enqueueMessage } from '../../core/messageQueue';

export const sendMessageTool: Tool = {
  name: 'send_message',
  riskLevel: 'SAFE',
  execute: async (args: { target: string; message: string }) => {
    const target = (args.target || '').trim().replace(/^@/, '').toLowerCase();
    const message = (args.message || '').trim();

    if (!target) {
      throw new Error("Target recipient required ('target' parameter).");
    }
    if (!message) {
      throw new Error("Message content cannot be empty.");
    }
    if (message.length > 1000) {
      throw new Error('Message too long (max 1000 characters).');
    }

    const entry = enqueueMessage(target, message);
    return `Message queued for @${target}. It will be received at the start of their next turn.`;
  }
};
