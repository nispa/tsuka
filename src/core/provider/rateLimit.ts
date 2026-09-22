import { LLM_DEFAULTS } from '../constants';

type RateLimitError = {
  status?: number;
  headers?: { get?: (name: string) => string | null } | Record<string, string>;
  error?: { metadata?: { limit_source?: string } };
};

export function isRateLimitError(error: RateLimitError): boolean {
  return error.status === 429;
}

/** Provider response text is untrusted; expose only the known source classification. */
export function rateLimitDescription(error: RateLimitError): string {
  return error.error?.metadata?.limit_source === 'upstream_provider_shared_pool'
    ? 'The upstream provider shared pool is temporarily rate-limited.'
    : 'The provider rate limit was reached.';
}

export function rateLimitDelayMs(error: RateLimitError, attempt: number, now = Date.now()): number {
  const headers = error.headers;
  const value = typeof headers?.get === 'function'
    ? headers.get('retry-after')
    : (headers as Record<string, string> | undefined)?.['retry-after'];
  let requestedMs: number | undefined;
  if (value) {
    const seconds = Number(value);
    requestedMs = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Date.parse(value) - now;
  }
  const fallback = LLM_DEFAULTS.rateLimitRetryBaseMs * 2 ** (attempt - 1);
  const delay = requestedMs !== undefined && Number.isFinite(requestedMs) && requestedMs >= 0
    ? requestedMs
    : fallback;
  return Math.min(LLM_DEFAULTS.rateLimitRetryMaxMs, delay);
}

/** Return false on cancellation and always release the abort listener and timer. */
export function waitForRateLimit(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(ready);
    };
    const onAbort = () => finish(false);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(true), delayMs);
    if (signal?.aborted) finish(false);
  });
}
