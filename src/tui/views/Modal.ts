/**
 * Modal view for TSUKA TUI.
 * Renders centered popup dialogs (permission prompts, pickers, file viewer).
 *
 * Each modal type contributes only its own box (content, size, border); the
 * placement over the screen buffer is shared, so a new modal type means one
 * more entry in `BOX_BUILDERS` and nothing else.
 */

import chalk from 'chalk';
import { TuiModalState } from '../types';
import { TuiScreen } from '../screen';
import { TUI_TABS } from '../navigation';

type Colorizer = (s: string) => string;

interface ModalBox {
  title: string;
  lines: string[];
  width: number;
  height: number;
  borderColor: Colorizer;
  scrollbar?: { total: number; visible: number; offset: number };
}

interface ScreenSize {
  width: number;
  height: number;
}

/** Default geometry shared by every dialog except the file viewer. */
function dialogWidth(screen: ScreenSize): number {
  return Math.min(68, Math.max(34, screen.width - 8));
}

function renderOptionList(modal: TuiModalState, screen: ScreenSize): string[] {
  const options = modal.options || [];
  const lines: string[] = [];
  const maxInnerHeight = Math.max(4, Math.min(screen.height - 6, 12));
  const visibleCount = Math.min(options.length, maxInnerHeight);

  // Scroll window centered on the selection
  let startIdx = 0;
  if (modal.selectedIndex >= visibleCount) {
    startIdx = Math.min(options.length - visibleCount, modal.selectedIndex - Math.floor(visibleCount / 2));
  }
  startIdx = Math.max(0, startIdx);
  const endIdx = Math.min(options.length, startIdx + visibleCount);

  if (startIdx > 0) lines.push(chalk.gray(`  ▲ ... (${startIdx} more above)`));

  for (let i = startIdx; i < endIdx; i++) {
    const opt = options[i];
    const isSelected = i === modal.selectedIndex;
    const prefix = isSelected ? chalk.bold.hex('#38bdf8')(' ❯ ') : '   ';
    const label = isSelected ? chalk.bold.hex('#38bdf8')(opt.label) : chalk.white(opt.label);
    const hint = opt.hint ? chalk.gray(` • ${opt.hint}`) : '';
    lines.push(`${prefix}${label}${hint}`);
  }

  if (endIdx < options.length) lines.push(chalk.gray(`  ▼ ... (${options.length - endIdx} more below)`));

  return lines;
}

function buildPermissionBox(modal: TuiModalState, screen: ScreenSize): ModalBox {
  const req = modal.permissionReq!;
  const lines: string[] = [];

  lines.push(req.riskLevel === 'DANGEROUS'
    ? chalk.bgRed.white.bold(' CRITICAL SECURITY AUTHORIZATION ')
    : chalk.bgYellow.black.bold(' TOOL AUTHORIZATION REQUEST '));
  lines.push('');
  lines.push(chalk.white(`Tool   : ${chalk.bold.cyan(req.toolName)}`));
  lines.push(chalk.white(`Action : ${chalk.yellow(req.details)}`));
  if (req.requesterLabel) lines.push(chalk.gray(`Agent  : ${req.requesterLabel}`));
  lines.push('');
  lines.push(chalk.bold.white('Select authorization decision:'));

  const options = modal.options || [
    { label: '✔ Approve this execution (y)', value: 'yes' },
    { label: '✘ Deny this execution (n)', value: 'no' },
    { label: '★ Always approve for this session (a)', value: 'always' },
  ];

  options.forEach((opt, i) => {
    const isSelected = i === modal.selectedIndex;
    const prefix = isSelected ? chalk.bold.cyan(' ❯ ') : '   ';
    lines.push(prefix + (isSelected ? chalk.bold.cyan(opt.label) : chalk.white(opt.label)));
  });

  lines.push('');
  lines.push(chalk.gray('(↑/↓ choose, Enter confirm, y/n/a hotkeys, Esc cancel)'));

  return dialogBox(modal, lines, screen);
}

/** Shortcuts not tied to a tab: the tab rows come from the navigation table. */
const GENERAL_SHORTCUTS: Array<[string, string]> = [
  ['Tab', 'Cycle focus between panes'],
  ['↑ / ↓', 'Scroll / History / Select'],
  ['→ / ←', 'Files: enter folder / go back up'],
  ['Enter', 'Files: open folder or preview file'],
  ['Esc', 'Dismiss popup / Interrupt generation'],
  ['Ctrl+C', 'Exit TSUKA'],
];

function buildHelpBox(modal: TuiModalState, screen: ScreenSize): ModalBox {
  const shortcut = (key: string, description: string) =>
    chalk.white(`  ${key.padEnd(12, ' ')} : ${description}`);

  const lines = [
    chalk.bold.hex('#e879f9')('TSUKA Keyboard & Navigation Cheatsheet'),
    '',
    // Derived from the tab table: a renamed or added tab documents itself here.
    ...TUI_TABS.map((tab) => shortcut(
      tab.key.toUpperCase() + (tab.id === 'tools' ? ' / Ctrl+T' : ''),
      tab.description
    )),
    ...GENERAL_SHORTCUTS.map(([key, description]) => shortcut(key, description)),
    '',
    chalk.gray('Press Enter or Esc to close'),
  ];

  return dialogBox(modal, lines, screen);
}

function buildFileViewerBox(modal: TuiModalState, screen: ScreenSize): ModalBox {
  const fv = modal.fileViewer!;
  const width = Math.min(105, Math.max(40, screen.width - 6));
  const height = Math.min(26, Math.max(10, screen.height - 4));
  const innerHeight = Math.max(4, height - 5);
  const innerWidth = Math.max(10, width - 4);

  const lines: string[] = [
    chalk.gray(`Size: ${chalk.cyan((fv.fileSize / 1024).toFixed(1) + ' KB')} • Lines: ${chalk.cyan(fv.totalLines)} • Path: ${chalk.gray(fv.filePath)}`),
    '',
  ];

  const padLen = Math.max(2, String(fv.totalLines).length);
  const startIdx = Math.max(0, Math.min(fv.totalLines - 1, fv.scrollOffset));
  const endIdx = Math.min(fv.totalLines, startIdx + innerHeight);

  for (let i = startIdx; i < endIdx; i++) {
    const rawLine = fv.lines[i] ?? '';
    const availWidth = Math.max(5, innerWidth - padLen - 3);
    const displayLine = rawLine.length > availWidth ? rawLine.slice(0, availWidth - 1) + '…' : rawLine;
    lines.push(chalk.gray(String(i + 1).padStart(padLen, ' ') + ' │ ') + chalk.white(displayLine));
  }

  while (lines.length < innerHeight + 2) lines.push('');
  lines.push(chalk.gray('[▲/▼ / PgUp/PgDn scroll • i insert in prompt • c copy path • Esc / Enter close]'));

  return {
    title: modal.title || `📄 File Viewer: ${fv.filename}`,
    lines,
    width,
    height,
    borderColor: chalk.hex('#38bdf8'),
    scrollbar: { total: fv.totalLines, visible: innerHeight, offset: fv.scrollOffset },
  };
}

/** Standard dialog: width from the screen, height from the content. */
function dialogBox(modal: TuiModalState, lines: string[], screen: ScreenSize): ModalBox {
  return {
    title: modal.title || 'Dialog',
    lines,
    width: dialogWidth(screen),
    height: lines.length + 2,
    borderColor: chalk.hex('#818cf8'),
  };
}

/**
 * Box builder per modal type. Types with no entry — and any modal whose payload
 * is missing — fall back to the option list, which is what pickers need.
 */
const BOX_BUILDERS: Partial<Record<TuiModalState['type'], (m: TuiModalState, s: ScreenSize) => ModalBox>> = {
  file_viewer: (m, s) => (m.fileViewer ? buildFileViewerBox(m, s) : dialogBox(m, renderOptionList(m, s), s)),
  permission: (m, s) => (m.permissionReq ? buildPermissionBox(m, s) : dialogBox(m, renderOptionList(m, s), s)),
  help: buildHelpBox,
};

export class ModalView {
  static renderOverlay(modal: TuiModalState, screenLines: string[], screenWidth: number, screenHeight: number): string[] {
    const screen: ScreenSize = { width: screenWidth, height: screenHeight };
    const build = BOX_BUILDERS[modal.type];
    const box = build ? build(modal, screen) : dialogBox(modal, renderOptionList(modal, screen), screen);

    const rendered = TuiScreen.drawBox(box.title, box.lines, box.width, box.height, true, box.borderColor, box.scrollbar);
    return ModalView.composite(screenLines, rendered, box, screen);
  }

  /** Places the box at the center of the screen buffer, ANSI-safely. */
  private static composite(screenLines: string[], box: string[], geometry: ModalBox, screen: ScreenSize): string[] {
    const startY = Math.max(1, Math.floor((screen.height - geometry.height) / 2));
    const startX = Math.max(1, Math.floor((screen.width - geometry.width) / 2));
    const rightMargin = Math.max(0, screen.width - startX - geometry.width);

    const result = [...screenLines];
    box.forEach((line, i) => {
      const lineIdx = startY + i;
      if (lineIdx >= 0 && lineIdx < result.length) {
        result[lineIdx] = ' '.repeat(startX) + line + ' '.repeat(rightMargin);
      }
    });

    return result;
  }
}
