/**
 * ANSI Box Drawing, String Width & Padding Primitives for TSUKA TUI.
 * Provides safe ANSI string operations, proportional scrollbars, and styled containers.
 */

import chalk from 'chalk';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';
import sliceAnsi from 'slice-ansi';

export interface ScrollbarOptions {
  total: number;
  visible: number;
  offset: number;
}

type Paint = (s: string) => string;

/**
 * How a pane frame is drawn. Every style keeps the exact same geometry — one row
 * above and below the content, one column on each side — because hit-testing and
 * the scrollbar maths are built on that box, not on its looks.
 *
 * - `rounded`: the thin rounded box, in a classic theme's colours;
 * - `lcars`: an LCARS elbow in `color` (hex), for panes framed on their own;
 * - `caption`: only a coloured title line, for panes sitting inside a larger LCARS
 *   frame (the console layout), where a box of their own would double the chrome.
 *
 * Absent, the box uses the historical defaults (views rendered without a layout).
 */
export type FrameSpec =
  | { style: 'rounded'; focused: Paint; unfocused: Paint; title: Paint }
  | { style: 'lcars'; color: string }
  | { style: 'caption'; color: string };

export class BoxDrawing {
  static stripAnsi(text: string): string {
    return stripAnsi(text || '');
  }

  static stringWidth(text: string): number {
    return stringWidth((text || '').replace(/\r/g, '').replace(/\t/g, '  '));
  }

  static truncateOrPad(text: string, width: number, padChar: string = ' '): string {
    const sanitized = (text || '').replace(/\r/g, '').replace(/\t/g, '  ');
    const visualWidth = stringWidth(sanitized);

    if (visualWidth === width) return sanitized;
    if (visualWidth < width) {
      return sanitized + padChar.repeat(width - visualWidth);
    }

    // ANSI-safe slicing using slice-ansi. It counts some emoji (e.g. ⚡) as one column
    // where string-width and the terminal count two, so trim until the row really fits:
    // a row even one column too wide wraps and shifts the whole frame down.
    let end = width;
    let sliced = sliceAnsi(sanitized, 0, end);
    while (end > 0 && stringWidth(sliced) > width) sliced = sliceAnsi(sanitized, 0, --end);
    const slicedWidth = stringWidth(sliced);
    if (slicedWidth < width) {
      return sliced + padChar.repeat(width - slicedWidth);
    }
    return sliced;
  }

  static drawBox(
    title: string,
    contentLines: string[],
    width: number,
    height: number,
    isFocused: boolean = false,
    borderColor?: Paint,
    scrollbar?: ScrollbarOptions,
    frame?: FrameSpec
  ): string[] {
    if (frame?.style === 'lcars') {
      return BoxDrawing.drawLcarsBox(title, contentLines, width, height, frame.color, scrollbar);
    }
    if (frame?.style === 'caption') {
      return BoxDrawing.drawCaptionBox(title, contentLines, width, height, frame.color, scrollbar);
    }
    const lines: string[] = [];
    // A view's own border colour (e.g. the busy prompt) wins over the theme when unfocused.
    const themed = frame?.style === 'rounded' ? frame : undefined;
    const color = isFocused ? (themed?.focused ?? chalk.cyan) : (borderColor ?? themed?.unfocused ?? chalk.gray);
    const titleColor = isFocused ? chalk.bold.cyan : chalk.bold.white;
    const titlePaint = themed ? (s: string) => chalk.bold(themed.title(s)) : titleColor;

    // Top border
    let safeTitle = title;
    const maxTitleLen = Math.max(0, width - 6);
    if (safeTitle && BoxDrawing.stringWidth(safeTitle) > maxTitleLen) {
      safeTitle = BoxDrawing.truncateOrPad(safeTitle, maxTitleLen - 1) + '…';
    }

    const titleStr = safeTitle ? ` ${titlePaint(safeTitle)} ` : '';
    const titleWidth = safeTitle ? BoxDrawing.stringWidth(safeTitle) + 2 : 0;
    const remainingTop = Math.max(0, width - 3 - titleWidth);
    const topBar = color('╭─') + titleStr + color('─'.repeat(remainingTop) + '╮');
    lines.push(topBar);

    // Content body
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);

    const thumb = BoxDrawing.scrollThumb(scrollbar, innerHeight);

    for (let i = 0; i < innerHeight; i++) {
      const rawLine = contentLines[i] || '';
      const padded = BoxDrawing.truncateOrPad(rawLine, innerWidth);

      let rightBorderChar = color('│');
      if (thumb) {
        if (i >= thumb[0] && i < thumb[1]) {
          rightBorderChar = chalk.bold.hex('#38bdf8')('█');
        } else {
          rightBorderChar = chalk.hex('#475569')('░');
        }
      }

      lines.push(color('│') + padded + rightBorderChar);
    }

    // Bottom border with scroll indicator if scrolled
    let bottomTrack = '─'.repeat(innerWidth);
    if (scrollbar && scrollbar.total > scrollbar.visible) {
      const pct = Math.round(((scrollbar.total - scrollbar.visible - scrollbar.offset) / (scrollbar.total - scrollbar.visible)) * 100);
      const tag = scrollbar.offset === 0 ? ' [END] ' : ` [${Math.max(0, Math.min(100, pct))}%] `;
      if (tag.length < innerWidth - 4) {
        bottomTrack = '─'.repeat(innerWidth - tag.length) + chalk.cyan(tag);
      }
    }
    const bottomBar = color('╰' + bottomTrack + '╯');
    lines.push(bottomBar);

    return lines;
  }

  /** Scrollbar thumb rows `[start, end)` inside `innerHeight`, or null when everything fits. */
  private static scrollThumb(scrollbar: ScrollbarOptions | undefined, innerHeight: number): [number, number] | null {
    if (!scrollbar || scrollbar.total <= scrollbar.visible || innerHeight <= 0) return null;
    const maxScroll = Math.max(1, scrollbar.total - scrollbar.visible);
    const thumbSize = Math.max(1, Math.round((scrollbar.visible / scrollbar.total) * innerHeight));
    // offset is 0 at the bottom (newest) and maxScroll at the top (oldest).
    const scrollRatio = Math.min(1, Math.max(0, 1 - scrollbar.offset / maxScroll));
    const start = Math.min(innerHeight - thumbSize, Math.round(scrollRatio * (innerHeight - thumbSize)));
    return [start, start + thumbSize];
  }

  /**
   * Title line only, for a pane inside a larger LCARS frame: the uppercase title in
   * the pane colour on top, the scroll position (if any) at the bottom right, and the
   * scrollbar in the right column. Same geometry as every other frame.
   */
  static drawCaptionBox(
    title: string,
    contentLines: string[],
    width: number,
    height: number,
    hex: string,
    scrollbar?: ScrollbarOptions
  ): string[] {
    const fg = chalk.hex(hex);
    const innerWidth = Math.max(0, width - 2);
    const innerHeight = Math.max(0, height - 2);
    const lines = [' ' + BoxDrawing.truncateOrPad(title ? fg.bold(title.toUpperCase()) : '', innerWidth) + ' '];

    const thumb = BoxDrawing.scrollThumb(scrollbar, innerHeight);
    for (let i = 0; i < innerHeight; i++) {
      const edge = !thumb ? ' ' : i >= thumb[0] && i < thumb[1] ? fg('█') : chalk.hex('#3a3a3a')('│');
      lines.push(' ' + BoxDrawing.truncateOrPad(contentLines[i] || '', innerWidth) + edge);
    }

    let tag = '';
    if (scrollbar && scrollbar.total > scrollbar.visible) {
      const pct = Math.round(((scrollbar.total - scrollbar.visible - scrollbar.offset) / (scrollbar.total - scrollbar.visible)) * 100);
      tag = scrollbar.offset === 0 ? 'END' : `${Math.max(0, Math.min(100, pct))}%`;
    }
    lines.push(' ' + BoxDrawing.truncateOrPad(' '.repeat(Math.max(0, innerWidth - tag.length)) + fg(tag), innerWidth) + ' ');
    return lines;
  }

  /**
   * LCARS elbow (Star Trek TNG): a solid band across the top carrying the title in
   * black, a solid bar down the left edge, a thinner band along the bottom, and an
   * open right side. The quadrant glyphs ▟ and ▜ cut the outer corners so the elbow
   * reads as rounded; the right column stays blank unless it carries the scrollbar.
   */
  static drawLcarsBox(
    title: string,
    contentLines: string[],
    width: number,
    height: number,
    hex: string,
    scrollbar?: ScrollbarOptions
  ): string[] {
    const fg = chalk.hex(hex);
    const band = chalk.bgHex(hex).hex('#000000');
    const innerWidth = Math.max(0, width - 2);
    const innerHeight = Math.max(0, height - 2);

    // Top band: corner, a short bar stub, the title, then solid bar to the gap.
    const label = title ? ` ${title.toUpperCase()} ` : '';
    const head = band('  ') + band.bold(label);
    const fill = Math.max(0, innerWidth - BoxDrawing.stringWidth(head));
    const lines = [fg('▟') + BoxDrawing.truncateOrPad(head + band(' '.repeat(fill)), innerWidth) + ' '];

    const thumb = BoxDrawing.scrollThumb(scrollbar, innerHeight);
    for (let i = 0; i < innerHeight; i++) {
      const edge = !thumb ? ' ' : i >= thumb[0] && i < thumb[1] ? fg('█') : fg('│');
      lines.push(fg('█') + BoxDrawing.truncateOrPad(contentLines[i] || '', innerWidth) + edge);
    }

    // Bottom band: half-height, so the elbow is visibly thicker at the top.
    let tag = '';
    if (scrollbar && scrollbar.total > scrollbar.visible) {
      const pct = Math.round(((scrollbar.total - scrollbar.visible - scrollbar.offset) / (scrollbar.total - scrollbar.visible)) * 100);
      tag = scrollbar.offset === 0 ? ' END ' : ` ${Math.max(0, Math.min(100, pct))}% `;
      if (tag.length >= innerWidth - 4) tag = '';
    }
    const bottomRun = fg('▀'.repeat(Math.max(0, innerWidth - tag.length - 1))) + (tag ? ' ' + fg.bold(tag) : ' ');
    lines.push(fg('▜') + BoxDrawing.truncateOrPad(bottomRun, innerWidth) + ' ');

    return lines;
  }
}
