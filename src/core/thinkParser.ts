/**
 * Incremental parser for `<think>...</think>` reasoning blocks emitted
 * by models like deepseek-r1 within the content stream.
 *
 * Separates the stream into two channels:
 *  - 'content':   User-facing response text (and chat history)
 *  - 'reasoning': Chain of thought, displayed as a live progress indicator
 *
 * Handles split tags across consecutive chunks (e.g. chunk 1 ends with "<thi"
 * and chunk 2 begins with "nk>"). `flush()` releases any leftover buffer at stream end.
 */

export type StreamChannel = 'content' | 'reasoning';

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/** Length of the longest suffix of `buf` that is a proper prefix of `tag`. */
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
          // Reasoning ended: trim leading whitespace often left by models after </think>
          this.trimNextContent = true;
        }
        this.state = this.state === 'content' ? 'reasoning' : 'content';
        continue;
      }

      // No complete tag found: hold trailing prefix if present
      const holdLen = trailingTagPrefixLen(buf, tag);
      this.held = holdLen > 0 ? buf.slice(buf.length - holdLen) : '';
      this.emitText(buf.slice(0, buf.length - holdLen), this.state);
      buf = '';
    }
  }

  /** Call at end of stream: releases held residue (e.g. literal '<'). */
  flush(): void {
    if (this.held) {
      // An unclosed <think> leaves state in 'reasoning'
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
 * Removes <think> blocks from complete text (non-streaming path).
 * Also handles orphan tags.
 */
export function stripThinkBlocks(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, '');

  const orphanOpen = out.indexOf(OPEN_TAG);
  if (orphanOpen !== -1) out = out.slice(0, orphanOpen);

  const orphanClose = out.indexOf(CLOSE_TAG);
  if (orphanClose !== -1) out = out.slice(orphanClose + CLOSE_TAG.length);

  return out.trim();
}
