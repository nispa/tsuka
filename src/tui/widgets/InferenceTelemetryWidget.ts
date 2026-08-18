import chalk from 'chalk';
import { TuiState } from '../types';

/**
 * Real inference telemetry (T14.9).
 * Every value shown here is measured: TTFT and speeds come from the provider clock,
 * confidence and candidates only exist when the backend returns logprobs
 * (`inferenceLogprobs` in the config). Nothing is synthesized to fill the panel.
 */
export class InferenceTelemetryWidget {
  static render(state: TuiState, width: number): string[] {
    const lines: string[] = [];
    const innerWidth = Math.max(10, width - 4);
    const telem = state.telemetry || { phase: 'idle' };

    lines.push(chalk.bold.hex('#38bdf8')('◆ INFERENCE TELEMETRY'));

    // Status / Phase badge
    if (telem.phase === 'prefill') {
      const prefix = telem.prefillTokensEstimated ? '~' : '';
      const suffix = telem.prefillTokensEstimated ? ' est.' : '';
      const pTok = telem.prefillTokens
        ? `${prefix}${telem.prefillTokens.toLocaleString('en-US')} tok${suffix}`
        : 'Context Ingestion';
      lines.push(chalk.hex('#fbbf24').bold('  ⚡ PREFILL: ') + chalk.white(pTok));
    } else if (telem.phase === 'decoding') {
      const speed = telem.tokensPerSec !== undefined ? `${telem.tokensPerSec.toFixed(1)} t/s` : 'streaming';
      const tokens = telem.decodedTokens ? chalk.gray(` · ${telem.decodedTokens} tok`) : '';
      lines.push(chalk.hex('#22c55e').bold('  🌊 DECODE:  ') + chalk.green(speed) + tokens);
    } else if (telem.phase === 'tool') {
      lines.push(chalk.hex('#e879f9').bold('  🔧 TOOL:    ') + chalk.magenta('Executing tool...'));
    } else {
      const speed = telem.tokensPerSec !== undefined ? chalk.gray(` · ${telem.tokensPerSec.toFixed(1)} t/s`) : '';
      lines.push(chalk.gray('  ● IDLE:     ') + chalk.green('Ready') + speed);
    }

    // Measured latency line: TTFT and prompt ingestion speed (promptTokens / TTFT)
    const latencyParts: string[] = [];
    if (telem.ttftMs !== undefined) latencyParts.push(`TTFT: ${telem.ttftMs}ms`);
    if (telem.prefillTokensPerSec !== undefined) latencyParts.push(`prefill ${Math.round(telem.prefillTokensPerSec)} t/s`);
    if (latencyParts.length > 0) {
      lines.push(chalk.gray('  ' + latencyParts.join(' · ')));
    }

    // Latent space: shown only with real logprobs from the backend
    if (telem.confidence !== undefined && telem.confidence > 0) {
      const confPct = Math.min(100, Math.max(0, Math.round(telem.confidence)));
      const barWidth = Math.max(4, Math.min(10, innerWidth - 18));
      const filled = Math.round((confPct / 100) * barWidth);
      const empty = Math.max(0, barWidth - filled);
      const confBar = chalk.hex('#22c55e')('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
      lines.push(chalk.white(`  Conf : [${confBar}] ${chalk.yellow(confPct + '%')}`));
    }

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
