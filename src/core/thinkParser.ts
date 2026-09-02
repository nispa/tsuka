/**
 * Incremental parser for `<think>...</think>` reasoning blocks emitted by
 * reasoning models. Complete and streaming responses share this parser so
 * malformed-tag recovery cannot diverge between CLI, TUI, and persistence.
 */

import { AGENT_DEFAULTS } from './constants';

export type StreamChannel = 'content' | 'reasoning';

const THINK_TAG = /^<\s*(\/?)\s*think\s*>$/i;

export class ThinkTagParser {
  private state: StreamChannel = 'content';
  private held = '';
  private trimNextContent = false;

  constructor(private emit: (text: string, channel: StreamChannel) => void) {}

  push(chunk: string): void {
    let buffer = this.held + chunk;
    this.held = '';

    while (buffer.length > 0) {
      const tagStart = buffer.indexOf('<');
      if (tagStart === -1) {
        this.emitText(buffer, this.state);
        return;
      }

      this.emitText(buffer.slice(0, tagStart), this.state);
      buffer = buffer.slice(tagStart);

      const tagEnd = buffer.indexOf('>');
      if (tagEnd === -1) {
        // Bound malformed candidates instead of retaining an arbitrary stream.
        if (buffer.length > AGENT_DEFAULTS.thinkTagCandidateMaxChars) {
          this.emitText(buffer[0], this.state);
          buffer = buffer.slice(1);
          continue;
        }
        this.held = buffer;
        return;
      }

      const candidate = buffer.slice(0, tagEnd + 1);
      buffer = buffer.slice(tagEnd + 1);
      const match = THINK_TAG.exec(candidate);
      const isClose = match?.[1] === '/';

      if (match && !isClose && this.state === 'content') {
        this.state = 'reasoning';
      } else if (match && isClose && this.state === 'reasoning') {
        this.state = 'content';
        this.trimNextContent = true;
      } else {
        // Orphan, nested, and malformed tags are ordinary text in their channel.
        this.emitText(candidate, this.state);
      }
    }
  }

  /** Releases an incomplete tag candidate at the end of the stream. */
  flush(): void {
    if (this.held) {
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

/** Removes reasoning blocks using the same recovery contract as streaming. */
export function stripThinkBlocks(text: string): string {
  let content = '';
  const parser = new ThinkTagParser((chunk, channel) => {
    if (channel === 'content') content += chunk;
  });
  parser.push(text);
  parser.flush();
  return content.trim();
}
