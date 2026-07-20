import * as fs from 'fs';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

export const editFileTool: Tool = {
  name: 'edit_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string; targetContent: string; replacementContent: string }) => {
    const fullPath = resolveSafePath(args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Il file '${args.path}' non esiste.`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const occurrences = content.split(args.targetContent).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `Impossibile trovare il testo target in '${args.path}'. Assicurati che corrisponda esattamente.`
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `Trovate ${occurrences} occorrenze in '${args.path}'. Rendi il blocco 'targetContent' più specifico.`
      );
    }

    // NOTA: si usa una replacer function per evitare che pattern speciali
    // ($&, $', $`, $1...) nel replacementContent vengano interpretati da String.replace,
    // corrompendo silenziosamente il file modificato.
    const updatedContent = content.replace(args.targetContent, () => args.replacementContent);
    fs.writeFileSync(fullPath, updatedContent, 'utf-8');
    return `File '${args.path}' modificato con successo.`;
  }
};
