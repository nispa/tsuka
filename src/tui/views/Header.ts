/**
 * Header view for TSUKA TUI.
 * Displays application status, active persona, provider/model, and context window gauge.
 */

import chalk from 'chalk';
import { TuiState } from '../types';
import { TuiScreen } from '../screen';
import { composingLabel } from './composingLabel';
import { layoutTabs } from '../navigation';
import { TSUKA_PACKAGE } from '../../core/packageInfo';
import { LcarsChrome, TuiThemePalette } from '../layoutConfig';

/** The progress detail line appears only while generating, and only once there is one. */
function hasDetailLine(state: TuiState): boolean {
  return !!(state.isGenerating && state.generationStatus?.detail);
}

/**
 * LCARS separator: coloured segments with one-cell gaps, the way the TNG consoles
 * split a bar into blocks. Shares are fractions of the width; the last one absorbs
 * rounding so the bar always spans the row exactly.
 */
export function lcarsBar(lcars: LcarsChrome, width: number, glyph: string = '▀', segments = lcars.headerBar): string {
  let out = '';
  let used = 0;
  segments.forEach(([hex, share], i) => {
    const isLast = i === segments.length - 1;
    const run = isLast ? width - used : Math.max(1, Math.floor(width * share));
    const gap = isLast ? 0 : 1;
    out += chalk.hex(hex)(glyph.repeat(Math.max(0, run - gap))) + ' '.repeat(gap);
    used += run;
  });
  return out;
}

export class HeaderView {
  /** Rows the header occupies; the frame geometry and the mouse router read this. */
  static lineCount(state: TuiState): number {
    return hasDetailLine(state) ? 4 : 3;
  }

  static render(state: TuiState, width: number, activeTab: string = 'chat', theme?: TuiThemePalette): string[] {
    const lines: string[] = [];
    const lcars = theme?.lcars;

    // Line 1: Top Navigation Menu Tabs (labels and click zones come from `navigation.ts`).
    // An LCARS pill ` label ` is exactly as wide as `[label]`, so the zones still match.
    let tabsRow = ' ';
    layoutTabs(width, activeTab).forEach((zone, i) => {
      if (lcars) {
        const hex = zone.isActive ? lcars.activeTab : lcars.tabs[i % lcars.tabs.length];
        const pill = chalk.bgHex(hex).hex('#000000');
        tabsRow += (zone.isActive ? pill.bold : pill)(` ${zone.label} `) + ' ';
      } else if (theme) {
        tabsRow += zone.isActive
          ? chalk.inverse.bold(theme.primary(` ${zone.label} `)) + ' '
          : theme.secondary(`[${zone.label}]`) + ' ';
      } else {
        tabsRow += zone.isActive
          ? chalk.bgHex('#3178c6').white.bold(` ${zone.label} `) + ' '
          : chalk.hex('#818cf8')(`[${zone.label}]`) + ' ';
      }
    });

    const version = width > 95 ? ` v${TSUKA_PACKAGE.version}` : '';
    const brand = lcars
      ? chalk.bgHex(lcars.activeTab).hex('#000000').bold(' TSUKA ') + chalk.hex(lcars.activeTab)(version)
      : chalk.bold((theme?.accent ?? chalk.hex('#e879f9'))('TSUKA')) + chalk.gray(version);
    const tabsRowWidth = TuiScreen.stringWidth(tabsRow);
    const brandWidth = TuiScreen.stringWidth(brand);
    const spacing0 = Math.max(1, width - tabsRowWidth - brandWidth - 2);
    lines.push(TuiScreen.truncateOrPad(tabsRow + ' '.repeat(spacing0) + brand + ' ', width));

    lines.push(HeaderView.statusLine(state, width));

    const detail = HeaderView.detailLine(state, width);
    if (detail) lines.push(detail);

    // Line: Separator bar
    lines.push(lcars ? lcarsBar(lcars, width) : chalk.hex('#475569')('━'.repeat(width)));

    return lines;
  }

  /**
   * Status row: run state, active agent, model and the context gauge. Shared by every
   * layout engine, so the same information reads the same wherever the header lives.
   */
  static statusLine(state: TuiState, width: number): string {
    // Line 2: Active Persona, Model & Token Gauge
    const modelName = state.activeModel || 'default';
    const providerName = state.activeProvider || 'provider';

    const { usedTokens, subagentUsedTokens = 0, maxTokens, percentage, reasoningEffort } = state.stats;
    const barWidth = Math.min(18, Math.max(6, Math.floor(width / 8)));

    // Multi-color token stacking (Parent Agent + Subagent)
    const agentRatio = Math.min(1, usedTokens / maxTokens);
    const subRatio = Math.min(1, subagentUsedTokens / maxTokens);

    const agentBlocks = Math.min(barWidth, Math.max(0, Math.round(agentRatio * barWidth)));
    let subBlocks = Math.min(barWidth - agentBlocks, Math.max(0, Math.round(subRatio * barWidth)));

    if (subagentUsedTokens > 0 && subBlocks === 0 && (agentBlocks + subBlocks) < barWidth) {
      subBlocks = 1;
    }

    const emptyBlocks = Math.max(0, barWidth - agentBlocks - subBlocks);

    let barColor = chalk.hex('#2dd4bf');
    if (percentage > 80) barColor = chalk.red;
    else if (percentage > 60) barColor = chalk.yellow;

    const subColor = chalk.hex('#c084fc');

    const progressBar = chalk.gray('[') +
      barColor('█'.repeat(agentBlocks)) +
      subColor('█'.repeat(subBlocks)) +
      chalk.gray('░'.repeat(emptyBlocks)) +
      chalk.gray(']');

    const subText = subagentUsedTokens > 0
      ? chalk.gray(` (${usedTokens.toLocaleString()} + `) + subColor(`${subagentUsedTokens.toLocaleString()} sub`) + chalk.gray(` / ${maxTokens.toLocaleString()})`)
      : chalk.gray(` (${usedTokens.toLocaleString()}/${maxTokens.toLocaleString()})`);

    const compactSubText = chalk.gray(` (${usedTokens.toLocaleString()}/${maxTokens.toLocaleString()})`);

    let statusBadge: string;
    if (!state.isGenerating) {
      statusBadge = chalk.hex('#2dd4bf')('● Ready');
    } else {
      const gen = state.generationStatus;
      const sub = state.activeSpawnedAgent;
      const isSubRunning = sub && sub.status === 'running';

      if (gen?.phase === 'tool' && gen.toolName) {
        const who = gen.agentName ? `@${gen.agentName}: ` : '';
        statusBadge = chalk.bold.bgHex('#d97706').white(` 🔧 ${who}${gen.toolName} `);
      } else if (gen?.phase === 'composing') {
        const who = gen.agentName && gen.agentName !== state.activeAiName ? `@${gen.agentName}: ` : '';
        statusBadge = chalk.bold.bgHex('#0d9488').white(` 🧩 ${who}${composingLabel(gen)} `);
      } else if (gen?.phase === 'streaming') {
        const who = gen.agentName && gen.agentName !== state.activeAiName ? ` @${gen.agentName}` : '';
        const isNoEffort = state.activeReasoningEffort === 'none';
        const label = isNoEffort ? 'WORKING' : 'TYPING';
        statusBadge = chalk.bold.bgHex('#0284c7').white(` 💬 ${label}${who} `);
      } else {
        const agentName = gen?.agentName || (isSubRunning ? sub.name : state.activeAiName);
        const who = agentName && agentName !== state.activeAiName ? ` @${agentName}` : '';
        statusBadge = chalk.bold.bgHex('#ea580c').white(` ⚡ THINKING${who} `);
      }
    }

    // Adaptively format line 2 elements to fit exact width without wrapping
    const modelBadge = chalk.hex('#fbbf24')(`⚡ ${modelName}`) + (width > 85 ? chalk.gray(` @ ${providerName}`) : '');
    const effortInfo = reasoningEffort && width > 90 ? chalk.hex('#e879f9')(` [${reasoningEffort}]`) : '';

    let agentBadge = chalk.bold.hex('#38bdf8')(`👤 ${state.activeAiName}`) +
      chalk.gray(` (${state.activeCharacterRole} • ${state.activeCharacterTrait})`);

    let tokenInfo = `${progressBar} ${barColor(`${percentage}%`)}${subText}`;

    let leftLine2 = `  ${statusBadge}  ${agentBadge}  ${modelBadge}${effortInfo}`;
    let rightLine2 = `${tokenInfo} `;

    // If total width exceeds screen width, iteratively compact
    if (TuiScreen.stringWidth(leftLine2) + TuiScreen.stringWidth(rightLine2) + 2 > width) {
      agentBadge = chalk.bold.hex('#38bdf8')(`👤 ${state.activeAiName}`) + chalk.gray(` (${state.activeCharacterRole})`);
      leftLine2 = `  ${statusBadge}  ${agentBadge}  ${modelBadge}${effortInfo}`;
    }

    if (TuiScreen.stringWidth(leftLine2) + TuiScreen.stringWidth(rightLine2) + 2 > width) {
      tokenInfo = `${progressBar} ${barColor(`${percentage}%`)}${compactSubText}`;
      rightLine2 = `${tokenInfo} `;
    }

    if (TuiScreen.stringWidth(leftLine2) + TuiScreen.stringWidth(rightLine2) + 2 > width) {
      agentBadge = chalk.bold.hex('#38bdf8')(`👤 ${state.activeAiName}`);
      leftLine2 = `  ${statusBadge}  ${agentBadge}  ${modelBadge}`;
    }

    if (TuiScreen.stringWidth(leftLine2) + TuiScreen.stringWidth(rightLine2) + 2 > width) {
      tokenInfo = `${progressBar} ${barColor(`${percentage}%`)}`;
      rightLine2 = `${tokenInfo} `;
    }

    const l2w = TuiScreen.stringWidth(leftLine2);
    const r2w = TuiScreen.stringWidth(rightLine2);
    const spacing1 = Math.max(1, width - l2w - r2w);

    return TuiScreen.truncateOrPad(leftLine2 + ' '.repeat(spacing1) + rightLine2, width);
  }

  /** Live progress of a long CLI workflow while generating, when it reports one. */
  static detailLine(state: TuiState, width: number): string | undefined {
    // Line 3 (optional): live progress detail from a long-running CLI workflow's spinner
    // (e.g. `/benchmark`'s current model/step — see core/progressSink.ts). Only while
    // generating, and only once there is something to say — most turns never set it.
    if (!hasDetailLine(state) || !state.generationStatus?.detail) return undefined;
    {
      const prefix = '     └─ ';
      const maxDetailWidth = Math.max(4, width - prefix.length);
      const detail = state.generationStatus.detail.length > maxDetailWidth
        ? state.generationStatus.detail.slice(0, maxDetailWidth - 1) + '…'
        : state.generationStatus.detail;
      return TuiScreen.truncateOrPad(chalk.gray(prefix) + chalk.hex('#94a3b8')(detail), width);
    }
  }
}
