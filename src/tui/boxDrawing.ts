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

    // ANSI-safe slicing using slice-ansi
    const sliced = sliceAnsi(sanitized, 0, width);
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
    borderColor: (s: string) => string = chalk.gray,
    scrollbar?: ScrollbarOptions
  ): string[] {
    const lines: string[] = [];
    const color = isFocused ? chalk.cyan : borderColor;
    const titleColor = isFocused ? chalk.bold.cyan : chalk.bold.white;

    // Top border
    let safeTitle = title;
    const maxTitleLen = Math.max(0, width - 6);
    if (safeTitle && BoxDrawing.stringWidth(safeTitle) > maxTitleLen) {
      safeTitle = BoxDrawing.truncateOrPad(safeTitle, maxTitleLen - 1) + '…';
    }

    const titleStr = safeTitle ? ` ${titleColor(safeTitle)} ` : '';
    const titleWidth = safeTitle ? BoxDrawing.stringWidth(safeTitle) + 2 : 0;
    const remainingTop = Math.max(0, width - 3 - titleWidth);
    const topBar = color('╭─') + titleStr + color('─'.repeat(remainingTop) + '╮');
    lines.push(topBar);

    // Content body
    const innerHeight = Math.max(0, height - 2);
    const innerWidth = Math.max(0, width - 2);

    // Scrollbar calculation
    let thumbStart = -1;
    let thumbEnd = -1;
    if (scrollbar && scrollbar.total > scrollbar.visible && innerHeight > 0) {
      const maxScroll = Math.max(1, scrollbar.total - scrollbar.visible);
      const thumbSize = Math.max(1, Math.round((scrollbar.visible / scrollbar.total) * innerHeight));
      // scrollbar.offset is 0 at bottom (newest) and maxScroll at top (oldest)
      const scrollRatio = Math.min(1, Math.max(0, 1 - (scrollbar.offset / maxScroll)));
      thumbStart = Math.min(innerHeight - thumbSize, Math.round(scrollRatio * (innerHeight - thumbSize)));
      thumbEnd = thumbStart + thumbSize;
    }

    for (let i = 0; i < innerHeight; i++) {
      const rawLine = contentLines[i] || '';
      const padded = BoxDrawing.truncateOrPad(rawLine, innerWidth);

      let rightBorderChar = color('│');
      if (thumbStart !== -1) {
        if (i >= thumbStart && i < thumbEnd) {
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
}
