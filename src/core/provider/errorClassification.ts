/**
 * Error classification and factory utilities for LLM provider exceptions.
 */

/**
 * Identifies malformed tool call JSON syntax errors from model output (T9.8).
 */
export function isMalformedToolCallJsonError(message: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('tool call') && (m.includes('json') || m.includes('parse'));
}

/**
 * Checks if the backend rejected the request because of unsupported reasoning_effort parameter.
 */
export function isReasoningEffortRejectionError(message: string): boolean {
  return typeof message === 'string' && message.includes('reasoning_effort');
}

/**
 * Creates an error instance enriched with partial reasoning traces if available.
 */
export function createProviderError(
  message: string,
  partialReasoning?: string
): Error & { partialReasoning?: string } {
  return Object.assign(new Error(message), {
    partialReasoning: partialReasoning || undefined,
  });
}
