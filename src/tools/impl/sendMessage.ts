import { Tool } from '../registry';
import { enqueueMessage } from '../../core/messageQueue';

export const sendMessageTool: Tool = {
  name: 'send_message',
  riskLevel: 'SAFE',
  execute: async (args: { target: string; message: string }) => {
    const target = (args.target || '').trim().replace(/^@/, '').toLowerCase();
    const message = (args.message || '').trim();

    if (!target) {
      throw new Error("Specificare il destinatario del messaggio (parametro 'target').");
    }
    if (!message) {
      throw new Error("Il messaggio non può essere vuoto.");
    }
    if (message.length > 1000) {
      throw new Error('Messaggio troppo lungo (max 1000 caratteri).');
    }

    const entry = enqueueMessage(target, message);
    return `Messaggio accodato per @${target}. Lo riceverà all'inizio del suo prossimo turno.`;
  }
};
