/**
 * Double-Buffered Terminal Screen Driver for TSUKA TUI.
 * Manages raw TTY lifecycle, differential frame rendering, resize detection, and event distribution.
 */

import { InputParser, KeyPressEvent, KeyPressHandler, ResizeHandler, TuiMouseEvent, TuiMouseHandler } from './inputParser';
import { BoxDrawing, ScrollbarOptions } from './boxDrawing';

export { KeyPressEvent, KeyPressHandler, ResizeHandler, TuiMouseEvent, TuiMouseHandler, ScrollbarOptions };

export class TuiScreen {
  private width: number = 80;
  private height: number = 24;
  private keyListeners: Set<KeyPressHandler> = new Set();
  private mouseListeners: Set<TuiMouseHandler> = new Set();
  private resizeListeners: Set<ResizeHandler> = new Set();
  private isRunning: boolean = false;
  private currentBuffer: string[] = [];
  private renderQueued: boolean = false;
  private nextFrameRenderer?: () => string[];

  constructor() {
    this.updateDimensions();
  }

  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private updateDimensions(): void {
    this.width = process.stdout.columns || 80;
    this.height = process.stdout.rows || 24;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Enter alternate buffer, hide cursor, clear screen, enable SGR extended mouse tracking
    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H\x1b[?1000h\x1b[?1002h\x1b[?1006h');

    // Setup raw mode for key handling
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf-8');
      } catch (err) {
        // Fallback if raw mode is not supported
      }
    }

    process.stdin.on('data', this.handleInput);
    process.stdout.on('resize', this.handleResize);
    this.updateDimensions();
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    process.stdin.removeListener('data', this.handleInput);
    process.stdout.removeListener('resize', this.handleResize);

    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch (err) {
        // Ignore on shutdown
      }
    }

    // Disable mouse tracking, show cursor, exit alternate screen buffer
    process.stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?25h\x1b[?1049l');
  }

  onKey(handler: KeyPressHandler): () => void {
    this.keyListeners.add(handler);
    return () => this.keyListeners.delete(handler);
  }

  onMouse(handler: TuiMouseHandler): () => void {
    this.mouseListeners.add(handler);
    return () => this.mouseListeners.delete(handler);
  }

  onResize(handler: ResizeHandler): () => void {
    this.resizeListeners.add(handler);
    return () => this.resizeListeners.delete(handler);
  }

  private handleResize = (): void => {
    this.updateDimensions();
    this.clearBuffer();
    process.stdout.write('\x1b[2J');
    for (const listener of this.resizeListeners) {
      listener(this.width, this.height);
    }
    this.requestRender();
  };

  private handleInput = (data: Buffer | string): void => {
    const str = data.toString('utf-8');
    const { keys, mouseEvents } = InputParser.parse(str);

    for (const mouse of mouseEvents) {
      for (const listener of this.mouseListeners) {
        listener(mouse);
      }
    }

    for (const key of keys) {
      for (const listener of this.keyListeners) {
        listener(key);
      }
    }
  };

  setRenderer(renderer: () => string[]): void {
    this.nextFrameRenderer = renderer;
  }

  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    setImmediate(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  clearBuffer(): void {
    this.currentBuffer = [];
  }

  private render(): void {
    if (!this.isRunning || !this.nextFrameRenderer) return;
    this.updateDimensions();

    const newLines = this.nextFrameRenderer();
    let out = '';

    for (let r = 0; r < this.height; r++) {
      const newLine = newLines[r] || '';
      const oldLine = this.currentBuffer[r];

      // Double-buffering: write only dirty lines that changed
      if (newLine !== oldLine) {
        out += `\x1b[${r + 1};1H${newLine}\x1b[K`;
        this.currentBuffer[r] = newLine;
      }
    }

    if (out.length > 0) {
      process.stdout.write(out);
    }
  }

  // ── Delegated Helper Drawing Primitives ──

  static stripAnsi(text: string): string {
    return BoxDrawing.stripAnsi(text);
  }

  static stringWidth(text: string): number {
    return BoxDrawing.stringWidth(text);
  }

  static truncateOrPad(text: string, width: number, padChar: string = ' '): string {
    return BoxDrawing.truncateOrPad(text, width, padChar);
  }

  static drawBox(
    title: string,
    contentLines: string[],
    width: number,
    height: number,
    isFocused: boolean = false,
    borderColor?: (s: string) => string,
    scrollbar?: ScrollbarOptions
  ): string[] {
    return BoxDrawing.drawBox(title, contentLines, width, height, isFocused, borderColor, scrollbar);
  }
}
