import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

// T9.11: tetto RIGIDO sulla singola chiamata, non solo un consiglio in
// tools_schemas/write_file.json. La descrizione del tool già suggeriva di
// spezzare i file lunghi in più chiamate con 'append', ma è un'istruzione che
// il modello può ignorare (osservato in produzione: un unico write_file con
// l'intero contenuto di un file multi-livello ha rotto ripetutamente il
// parsing JSON della tool call lato server — vedi il commento T9.8 più sotto).
// Qui il limite è fatto rispettare: oltre questa soglia il tool rifiuta la
// chiamata con un errore che prescrive come dividerla, invece di sperare che
// il modello segua la descrizione da solo.
const MAX_CONTENT_LENGTH = 4000;

export const writeFileTool: Tool = {
  name: 'write_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string; content: string; append?: boolean | string }) => {
    if (args.content.length > MAX_CONTENT_LENGTH) {
      // T9.11: NON troncare il contenuto per farlo stare nel limite — significa
      // scrivere un file incompleto in silenzio. L'unica uscita legittima è
      // dividere la chiamata: prima porzione con append:false (o omesso),
      // porzioni successive con append:true, come già indicato in
      // tools_schemas/write_file.json.
      throw new Error(
        `Contenuto troppo lungo per una singola chiamata: ${args.content.length} caratteri (limite ${MAX_CONTENT_LENGTH}). ` +
        `NON troncarlo per farlo stare nel limite: scriveresti un file incompleto senza che nessuno se ne accorga. ` +
        `Dividi il contenuto in più chiamate a 'write_file' sullo stesso percorso '${args.path}': la prima senza 'append' ` +
        `(o con append:false), le successive con 'append': true, finché il file non è completo.`
      );
    }

    const fullPath = resolveSafePath(args.path);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // T9.9: 'append' permette di costruire un file grande a pezzi con più
    // chiamate piccole invece di una sola con tutto il contenuto in un unico
    // argomento JSON — è quest'ultimo il caso che rompe la generazione JSON di
    // una tool call su un modello locale (stesso problema affrontato per
    // spawn_agent in T9.8, qui più rilevante perché write_file è il tool con
    // cui si scrive codice vero, spesso il file più lungo dell'intero compito).
    // Default false: comportamento identico a prima, nessuna rottura per i
    // chiamanti esistenti. Normalizzato a mano (non solo `if (args.append)`):
    // un modello può mandare la STRINGA "false" invece del booleano JSON —
    // una stringa non vuota è truthy in JS e la sovrascrittura richiesta
    // diventerebbe silenziosamente un accodamento.
    const append = args.append === true || (typeof args.append === 'string' && args.append.trim().toLowerCase() === 'true');
    if (append) {
      fs.appendFileSync(fullPath, args.content, 'utf-8');
      const totalSize = fs.statSync(fullPath).size;
      return `Contenuto accodato a '${args.path}' (+${Buffer.byteLength(args.content)} byte, ${totalSize} byte totali).`;
    }

    fs.writeFileSync(fullPath, args.content, 'utf-8');
    return `File '${args.path}' scritto con successo (${Buffer.byteLength(args.content)} byte).`;
  }
};
