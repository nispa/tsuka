import chalk from 'chalk';
import { TuiState } from '../types';

export class InferenceTelemetryWidget {
  static render(state: TuiState, width: number): string[] {
    const lines: string[] = [];
    const innerWidth = Math.max(10, width - 4);
    const telem = state.telemetry || { phase: 'idle' };

    lines.push(chalk.bold.hex('#38bdf8')('◆ INFERENCE TELEMETRY'));

    // Status / Phase badge
    if (telem.phase === 'prefill') {
      const pTok = telem.prefillTokens ? `${telem.prefillTokens.toLocaleString('en-US')} tok` : 'Context Ingestion';
      const pSpeed = telem.prefillTokensPerSec ? ` @ ${chalk.yellow(Math.round(telem.prefillTokensPerSec))} t/s` : '';
      lines.push(chalk.hex('#fbbf24').bold('  ⚡ PREFILL: ') + chalk.white(`${pTok}${pSpeed}`));
    } else if (telem.phase === 'decoding') {
      const speed = telem.tokensPerSec ? `${telem.tokensPerSec.toFixed(1)} t/s` : 'streaming';
      const ttft = telem.ttftMs ? ` (TTFT: ${telem.ttftMs}ms)` : '';
      lines.push(chalk.hex('#22c55e').bold('  🌊 DECODE:  ') + chalk.green(`${speed}`) + chalk.gray(ttft));
    } else if (telem.phase === 'tool') {
      lines.push(chalk.hex('#e879f9').bold('  🔧 TOOL:    ') + chalk.magenta('Executing tool...'));
    } else {
      const ttft = telem.ttftMs ? ` · TTFT: ${telem.ttftMs}ms` : '';
      lines.push(chalk.gray('  ● IDLE:     ') + chalk.green('Ready') + chalk.gray(ttft));
    }

    // Confidence / Latent state if available
    if (telem.confidence !== undefined && telem.confidence > 0) {
      const confPct = Math.min(100, Math.max(0, Math.round(telem.confidence)));
      const barWidth = Math.max(4, Math.min(10, innerWidth - 18));
      const filled = Math.round((confPct / 100) * barWidth);
      const empty = Math.max(0, barWidth - filled);
      const confBar = chalk.hex('#22c55e')('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
      lines.push(chalk.white(`  Conf : [${confBar}] ${chalk.yellow(confPct + '%')}`));
    }

    // Top candidates from logits if available
    if (telem.topCandidates && telem.topCandidates.length > 0) {
      const topStr = telem.topCandidates
        .slice(0, 2)
        .map((c) => `${chalk.cyan(JSON.stringify(c.token))}:${chalk.gray(Math.round(c.prob * 100) + '%')}`)
        .join(' ');
      lines.push(chalk.gray(`  Logits: ${topStr}`));
    }

    return lines;
  }
}
