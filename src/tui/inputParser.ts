/**
 * ANSI Terminal Input & Mouse Protocol Parser for TSUKA TUI.
 * Parses raw TTY byte streams into structured KeyPress and Mouse events (including SGR 1006).
 */

import keybindingsData from './keybindings.json';

export interface KeyPressEvent {
  name: string;
  sequence: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  char?: string;
}

export type KeyPressHandler = (key: KeyPressEvent) => void;
export type ResizeHandler = (cols: number, rows: number) => void;

export interface TuiMouseEvent {
  button: 'left' | 'middle' | 'right' | 'wheelup' | 'wheeldown';
  action: 'down' | 'up' | 'move';
  col: number;
  row: number;
  shift: boolean;
  ctrl: boolean;
}

export type TuiMouseHandler = (event: TuiMouseEvent) => void;

export interface InputParseResult {
  keys: KeyPressEvent[];
  mouseEvents: TuiMouseEvent[];
}

interface EscapeBinding {
  prefix: string;
  name: string;
  sequence: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

const ESCAPE_SEQUENCES: EscapeBinding[] = (keybindingsData as EscapeBinding[]).sort(
  (a, b) => b.prefix.length - a.prefix.length
);

export class InputParser {
  /**
   * Translates single-byte control character codes into a KeyPressEvent via switch statement.
   */
  static parseControlCharacter(code: number): KeyPressEvent | undefined {
    switch (code) {
      case 3: // Ctrl+C
        return { name: 'c', sequence: '\x03', ctrl: true, meta: false, shift: false };
      case 4: // Ctrl+D
        return { name: 'd', sequence: '\x04', ctrl: true, meta: false, shift: false };
      case 9: // Tab
        return { name: 'tab', sequence: '\t', ctrl: false, meta: false, shift: false };
      case 10: // Line Feed
      case 13: // Carriage Return
        return { name: 'return', sequence: '\r', ctrl: false, meta: false, shift: false };
      case 12: // Ctrl+L (Redraw)
        return { name: 'l', sequence: '\x0c', ctrl: true, meta: false, shift: false };
      case 24: // Ctrl+X (Interrupt)
        return { name: 'x', sequence: '\x18', ctrl: true, meta: false, shift: false };
      case 8: // Backspace (BS)
      case 127: // Backspace (DEL)
        return { name: 'backspace', sequence: '\x7f', ctrl: false, meta: false, shift: false };
      default:
        return undefined;
    }
  }

  /**
   * Matches ANSI escape sequences from keybindings data.
   */
  static matchEscapeSequence(str: string, index: number): { binding: EscapeBinding; length: number } | undefined {
    for (const binding of ESCAPE_SEQUENCES) {
      if (str.startsWith(binding.prefix, index)) {
        return { binding, length: binding.prefix.length };
      }
    }
    return undefined;
  }

  /**
   * Parses raw terminal input chunks into structured keypress and mouse events.
   */
  static parse(str: string): InputParseResult {
    const keys: KeyPressEvent[] = [];
    const mouseEvents: TuiMouseEvent[] = [];
    let i = 0;

    while (i < str.length) {
      // 1. SGR Extended Mouse Sequences: \x1b[<button;col;row(M|m)
      const mouseMatch = str.slice(i).match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (mouseMatch) {
        const btn = parseInt(mouseMatch[1], 10);
        const col = parseInt(mouseMatch[2], 10);
        const row = parseInt(mouseMatch[3], 10);
        const isRelease = mouseMatch[4] === 'm';

        let button: TuiMouseEvent['button'] = 'left';
        let action: TuiMouseEvent['action'] = isRelease ? 'up' : 'down';

        if (btn === 64) {
          button = 'wheelup';
          action = 'down';
        } else if (btn === 65) {
          button = 'wheeldown';
          action = 'down';
        } else if (btn === 1) {
          button = 'middle';
        } else if (btn === 2) {
          button = 'right';
        } else if (btn === 32) {
          button = 'left';
          action = 'move';
        }

        mouseEvents.push({
          button,
          action,
          col,
          row,
          shift: false,
          ctrl: false,
        });

        i += mouseMatch[0].length;
        continue;
      }

      // 2. Control Characters via clean switch dispatcher
      const ctrlKey = this.parseControlCharacter(str.charCodeAt(i));
      if (ctrlKey) {
        keys.push(ctrlKey);
        i++;
        continue;
      }

      // 3. ANSI Escape Sequences from data table
      const escMatch = this.matchEscapeSequence(str, i);
      if (escMatch) {
        const { binding, length } = escMatch;
        keys.push({
          name: binding.name,
          sequence: binding.sequence,
          ctrl: binding.ctrl,
          meta: binding.meta,
          shift: binding.shift,
        });
        i += length;
        continue;
      }

      // 4. Standalone Escape
      if (str.charCodeAt(i) === 27 && str.length === 1) {
        keys.push({ name: 'escape', sequence: '\x1b', ctrl: false, meta: false, shift: false });
        i++;
        continue;
      }

      // 5. Standard printable characters
      const char = str[i];
      keys.push({
        name: char,
        char,
        sequence: char,
        ctrl: false,
        meta: false,
        shift: char.toUpperCase() === char && char.toLowerCase() !== char,
      });
      i++;
    }

    return { keys, mouseEvents };
  }
}
