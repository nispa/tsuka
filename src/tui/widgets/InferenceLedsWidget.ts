import chalk from 'chalk';
import { TuiState } from '../types';

export class InferenceLedsWidget {
  static render(state: TuiState, width: number): string[] {
    const lines: string[] = [];
    const telem = state.telemetry || { phase: 'idle' };
    const genPhase = state.generationStatus?.phase || (state.isGenerating ? 'streaming' : 'idle');

    // Determine which LED is actively lit
    const isTool = telem.phase === 'tool' || genPhase === 'tool';
    const isThink = genPhase === 'reasoning';
    const isPrefill = telem.phase === 'prefill';
    const isDecode = (telem.phase === 'decoding' || genPhase === 'streaming') && !isThink && !isTool && !isPrefill;
    const isReady = !state.isGenerating && (telem.phase === 'idle' || genPhase === 'idle') && !isTool;

    // LED symbols & colors
    const ledOn = (color: (s: string) => string, symbol = '●') => color(symbol);
    const ledOff = chalk.hex('#334155')('○');

    const rdyLabel = isReady ? chalk.hex('#22c55e').bold('[RDY]') : chalk.gray(' RDY ');
    const rdyLed = isReady ? ledOn(chalk.hex('#22c55e').bold) : ledOff;

    const preLabel = isPrefill ? chalk.hex('#fbbf24').bold('[PRE]') : chalk.gray(' PRE ');
    const preLed = isPrefill ? ledOn(chalk.hex('#fbbf24').bold) : ledOff;

    const thkLabel = isThink ? chalk.hex('#c084fc').bold('[THK]') : chalk.gray(' THK ');
    const thkLed = isThink ? ledOn(chalk.hex('#c084fc').bold) : ledOff;

    const decLabel = isDecode ? chalk.hex('#38bdf8').bold('[DEC]') : chalk.gray(' DEC ');
    const decLed = isDecode ? ledOn(chalk.hex('#38bdf8').bold) : ledOff;

    const tolLabel = isTool ? chalk.hex('#f43f5e').bold('[TOL]') : chalk.gray(' TOL ');
    const tolLed = isTool ? ledOn(chalk.hex('#f43f5e').bold) : ledOff;

    lines.push(chalk.bold.hex('#818cf8')('◆ STATUS LEDS'));
    lines.push(` ${rdyLabel} ${preLabel} ${thkLabel} ${decLabel} ${tolLabel}`);
    lines.push(`   ${rdyLed}     ${preLed}     ${thkLed}     ${decLed}     ${tolLed}`);

    // Contextual status text line
    let statusText = chalk.hex('#22c55e')('Ready (Idle)');
    if (isTool) {
      statusText = chalk.hex('#f43f5e')('Tool Execution');
    } else if (isThink) {
      statusText = chalk.hex('#c084fc')('Thinking (CoT)');
    } else if (isPrefill) {
      statusText = chalk.hex('#fbbf24')('KV Ingestion');
    } else if (isDecode) {
      statusText = chalk.hex('#38bdf8')('Streaming Response');
    }

    lines.push(chalk.gray('  State: ') + statusText);

    return lines;
  }
}
