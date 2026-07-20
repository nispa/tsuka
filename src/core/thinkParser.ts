/**
 * Parser incrementale per i blocchi di reasoning `<think>...</think>` emessi
 * da modelli come deepseek-r1 dentro lo stream di contenuto.
 *
 * Separa lo stream in due canali:
 *  - 'content':   testo destinato all'utente (e alla cronologia)
 *  - 'reasoning': catena di pensiero, da mostrare solo come indicatore live
 *
 * Gestisce i tag spezzati tra chunk consecutivi (es. un chunk termina con
 * "<thi" e il successivo inizia con "nk>"): il possibile prefisso di tag viene
 * trattenuto e riconsiderato al chunk successivo. `flush()` rilascia
 * l'eventuale residuo a fine stream.
 */

export type StreamChannel = 'content' | 'reasoning';

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/** Lunghezza del più lungo suffisso di `buf` che è prefisso proprio di `tag`. */
function trailingTagPrefixLen(buf: string, tag: string): number {
  const max = Math.min(buf.length, tag.length - 1);
  for (let len = max; len > 0; len--) {
    if (buf.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

export class ThinkTagParser {
  private state: StreamChannel = 'content';
  private held = '';
  private trimNextContent = false;

  constructor(private emit: (text: string, channel: StreamChannel) => void) {}

  push(chunk: string): void {
    let buf = this.held + chunk;
    this.held = '';

    while (buf.length > 0) {
      const tag = this.state === 'content' ? OPEN_TAG : CLOSE_TAG;
      const idx = buf.indexOf(tag);

      if (idx !== -1) {
        this.emitText(buf.slice(0, idx), this.state);
        buf = buf.slice(idx + tag.length);
        if (this.state === 'reasoning') {
          // Fine reasoning: il primo contenuto successivo va ripulito dal
          // whitespace che i modelli lasciano dopo </think>
          this.trimNextContent = true;
        }
        this.state = this.state === 'content' ? 'reasoning' : 'content';
        continue;
      }

      // Nessun tag completo: trattiene un eventuale prefisso di tag in coda
      const holdLen = trailingTagPrefixLen(buf, tag);
      this.held = holdLen > 0 ? buf.slice(buf.length - holdLen) : '';
      this.emitText(buf.slice(0, buf.length - holdLen), this.state);
      buf = '';
    }
  }

  /** Da chiamare a fine stream: rilascia il residuo trattenuto (es. un '<' letterale). */
  flush(): void {
    if (this.held) {
      // Un <think> mai chiuso lascia lo stato su 'reasoning': il residuo resta reasoning
      this.emitText(this.held, this.state);
      this.held = '';
    }
  }

  private emitText(text: string, channel: StreamChannel): void {
    if (!text) return;
    if (channel === 'content' && this.trimNextContent) {
      text = text.replace(/^\s+/, '');
      if (!text) return;
      this.trimNextContent = false;
    }
    this.emit(text, channel);
  }
}

/**
 * Rimuove i blocchi <think> da un testo completo (path non-streaming).
 * Gestisce anche i tag orfani: un <think> mai chiuso scarta tutto ciò che segue,
 * un </think> senza apertura scarta tutto ciò che precede.
 */
export function stripThinkBlocks(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, '');

  const orphanOpen = out.indexOf(OPEN_TAG);
  if (orphanOpen !== -1) out = out.slice(0, orphanOpen);

  const orphanClose = out.indexOf(CLOSE_TAG);
  if (orphanClose !== -1) out = out.slice(orphanClose + CLOSE_TAG.length);

  return out.trim();
}
