/**
 * Modal view for TSUKA TUI.
 * Renders centered popup dialogs (e.g. Permission prompts, selection menus).
 */

import chalk from 'chalk';
import { TuiModalState } from '../types';
import { TuiScreen } from '../screen';

export class ModalView {
  static renderOverlay(modal: TuiModalState, screenLines: string[], screenWidth: number, screenHeight: number): string[] {
    const modalWidth = Math.min(68, Math.max(34, screenWidth - 8));
    const maxInnerHeight = Math.max(4, Math.min(screenHeight - 6, 12));
    const contentLines: string[] = [];

    if (modal.type === 'permission' && modal.permissionReq) {
      const req = modal.permissionReq;
      const riskBadge = req.riskLevel === 'DANGEROUS'
        ? chalk.bgRed.white.bold(' CRITICAL SECURITY AUTHORIZATION ')
        : chalk.bgYellow.black.bold(' TOOL AUTHORIZATION REQUEST ');

      contentLines.push(riskBadge);
      contentLines.push('');
      contentLines.push(chalk.white(`Tool   : ${chalk.bold.cyan(req.toolName)}`));
      contentLines.push(chalk.white(`Action : ${chalk.yellow(req.details)}`));
      if (req.requesterLabel) {
        contentLines.push(chalk.gray(`Agent  : ${req.requesterLabel}`));
      }
      contentLines.push('');
      contentLines.push(chalk.bold.white('Select authorization decision:'));

      const options = modal.options || [
        { label: '✔ Approve this execution (y)', value: 'yes' },
        { label: '✘ Deny this execution (n)', value: 'no' },
        { label: '★ Always approve for this session (a)', value: 'always' },
      ];

      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const isSelected = i === modal.selectedIndex;
        const prefix = isSelected ? chalk.bold.cyan(' ❯ ') : '   ';
        const label = isSelected ? chalk.bold.cyan(opt.label) : chalk.white(opt.label);
        contentLines.push(`${prefix}${label}`);
      }
      contentLines.push('');
      contentLines.push(chalk.gray('(↑/↓ choose, Enter confirm, y/n/a hotkeys, Esc cancel)'));
    } else if (modal.type === 'help') {
      contentLines.push(chalk.bold.hex('#e879f9')('TSUKA Keyboard & Navigation Cheatsheet'));
      contentLines.push('');
      contentLines.push(chalk.white('  F1           : Chat Feed view'));
      contentLines.push(chalk.white('  F2 / Ctrl+T  : Tools Inspector view'));
      contentLines.push(chalk.white('  F3           : Persona Picker popup'));
      contentLines.push(chalk.white('  F4           : Team Picker popup'));
      contentLines.push(chalk.white('  F5           : Memory Facts popup'));
      contentLines.push(chalk.white('  F6           : LLM Backend Models popup'));
      contentLines.push(chalk.white('  Tab          : Cycle focus between panes'));
      contentLines.push(chalk.white('  ↑ / ↓        : Scroll / History / Select'));
      contentLines.push(chalk.white('  Esc          : Dismiss popup / Interrupt generation'));
      contentLines.push(chalk.white('  Ctrl+C       : Exit TSUKA'));
      contentLines.push('');
      contentLines.push(chalk.gray('Press Enter or Esc to close'));
    } else if (modal.options && modal.options.length > 0) {
      const totalOpts = modal.options.length;
      const visibleCount = Math.min(totalOpts, maxInnerHeight);
      
      // Calculate scroll window centered around selectedIndex
      let startIdx = 0;
      if (modal.selectedIndex >= visibleCount) {
        startIdx = Math.min(totalOpts - visibleCount, modal.selectedIndex - Math.floor(visibleCount / 2));
      }
      startIdx = Math.max(0, startIdx);
      const endIdx = Math.min(totalOpts, startIdx + visibleCount);

      if (startIdx > 0) {
        contentLines.push(chalk.gray(`  ▲ ... (${startIdx} more above)`));
      }

      for (let i = startIdx; i < endIdx; i++) {
        const opt = modal.options[i];
        const isSelected = i === modal.selectedIndex;
        const prefix = isSelected ? chalk.bold.hex('#38bdf8')(' ❯ ') : '   ';
        const label = isSelected ? chalk.bold.hex('#38bdf8')(opt.label) : chalk.white(opt.label);
        const hint = opt.hint ? chalk.gray(` • ${opt.hint}`) : '';
        contentLines.push(`${prefix}${label}${hint}`);
      }

      if (endIdx < totalOpts) {
        contentLines.push(chalk.gray(`  ▼ ... (${totalOpts - endIdx} more below)`));
      }
    }

    const modalHeight = contentLines.length + 2;
    const modalBox = TuiScreen.drawBox(
      modal.title || 'Dialog',
      contentLines,
      modalWidth,
      modalHeight,
      true,
      chalk.hex('#818cf8')
    );

    const startY = Math.max(1, Math.floor((screenHeight - modalHeight) / 2));
    const startX = Math.max(1, Math.floor((screenWidth - modalWidth) / 2));
    const rightMargin = Math.max(0, screenWidth - startX - modalWidth);

    const result = [...screenLines];
    for (let i = 0; i < modalBox.length; i++) {
      const lineIdx = startY + i;
      if (lineIdx >= 0 && lineIdx < result.length) {
        const modalLine = modalBox[i];
        // Clean ANSI-safe compositing: left padding spaces + modalLine + right padding spaces
        result[lineIdx] = ' '.repeat(startX) + modalLine + ' '.repeat(rightMargin);
      }
    }

    return result;
  }
}
