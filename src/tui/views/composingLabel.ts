import { TuiGenerationStatus } from '../types';

/**
 * Label for the `composing` phase, shared by every view that shows it:
 * the tool being written and how many argument characters have arrived.
 */
export function composingLabel(gen: TuiGenerationStatus | undefined): string {
  const tool = gen?.toolName || 'tool call';
  const chars = gen?.argChars ?? 0;
  const size = chars >= 1000 ? `${(chars / 1000).toFixed(1)}K` : String(chars);
  return `${tool} · ${size} chars`;
}
