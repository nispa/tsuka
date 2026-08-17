/**
 * Header view for TSUKA TUI.
 * Displays application status, active persona, provider/model, and context window gauge.
 */

import chalk from 'chalk';
import { TuiState } from '../types';
import { TuiScreen } from '../screen';

export class HeaderView {
  static render(state: TuiState, width: number, activeTab: string = 'chat'): string[] {
    const lines: string[] = [];

    // Line 1: Top Navigation Menu Tabs
    const tabs = [
      { id: 'chat', label: 'F1 💬 Chat' },
      { id: 'tools', label: 'F2 ⚡ Tools' },
      { id: 'personas', label: 'F3 👥 Personas' },
      { id: 'teams', label: 'F4 🤝 Teams' },
      { id: 'memory', label: 'F5 🧠 Memory' },
      { id: 'models', label: 'F6 ⚡ Models' },
      { id: 'layout', label: 'F7 📐 Layout' },
      { id: 'help', label: '? Help' },
    ];

    let tabsRow = ' ';
    for (const t of tabs) {
      const isActive = activeTab === t.id;
      if (isActive) {
        tabsRow += chalk.bgHex('#3178c6').white.bold(` ${t.label} `) + ' ';
      } else {
        tabsRow += chalk.hex('#818cf8')(`[${t.label}]`) + ' ';
      }
    }

    const brand = chalk.bold.hex('#e879f9')('TSUKA') + chalk.gray(' v0.4.0');
    const tabsRowWidth = TuiScreen.stringWidth(tabsRow);
    const brandWidth = TuiScreen.stringWidth(brand);
    const spacing0 = Math.max(1, width - tabsRowWidth - brandWidth - 2);
    lines.push(tabsRow + ' '.repeat(spacing0) + brand + ' ');

    // Line 2: Active Persona, Model & Token Gauge
    const agentBadge = chalk.bold.hex('#38bdf8')(`👤 ${state.activeAiName}`) +
      chalk.gray(` (${state.activeCharacterRole} • ${state.activeCharacterTrait})`);
    const modelBadge = chalk.hex('#fbbf24')(`⚡ ${state.activeModel}`) + chalk.gray(` @ ${state.activeProvider}`);

    const { usedTokens, maxTokens, percentage, reasoningEffort } = state.stats;
    const barWidth = Math.min(18, Math.max(8, Math.floor(width / 7)));
    const filled = Math.min(barWidth, Math.max(0, Math.round((percentage / 100) * barWidth)));
    const empty = Math.max(0, barWidth - filled);

    let barColor = chalk.hex('#2dd4bf');
    if (percentage > 80) barColor = chalk.red;
    else if (percentage > 60) barColor = chalk.yellow;

    const progressBar = chalk.gray('[') + barColor('█'.repeat(filled)) + chalk.gray('░'.repeat(empty)) + chalk.gray(']');
    const tokenInfo = `${progressBar} ${barColor(`${percentage}%`)} ${chalk.gray(`(${usedTokens.toLocaleString()}/${maxTokens.toLocaleString()})`)}`;
    const effortInfo = reasoningEffort ? chalk.hex('#e879f9')(` [${reasoningEffort}]`) : '';

    const statusBadge = state.isGenerating
      ? chalk.bold.bgHex('#ea580c').white(' ⚡ THINKING ')
      : chalk.hex('#2dd4bf')('● Ready');

    const leftLine2 = `  ${statusBadge}  ${agentBadge}  ${modelBadge}${effortInfo}`;
    const rightLine2 = `${tokenInfo} `;
    const l2w = TuiScreen.stringWidth(leftLine2);
    const r2w = TuiScreen.stringWidth(rightLine2);
    const spacing1 = Math.max(1, width - l2w - r2w);

    lines.push(leftLine2 + ' '.repeat(spacing1) + rightLine2);

    // Line 3: Separator bar
    lines.push(chalk.hex('#475569')('━'.repeat(width)));

    return lines;
  }
}
