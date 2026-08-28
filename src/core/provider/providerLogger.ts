import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../apphome';
import { logSink } from '../logSink';

export interface ProviderFailureInfo {
  provider?: string;
  baseUrl: string;
  model?: string;
  apiKey?: string;
  operation: 'chat.completions' | 'models.list' | 'probe' | 'warmup' | string;
  status?: number | string;
  error: Error | string;
  requestPayload?: unknown;
  responseBody?: unknown;
  attempt?: number;
  maxRetries?: number;
}

/**
 * Masks sensitive credentials, authorization bearer tokens, and API keys.
 */
export function maskSensitiveCredentials(input: string): string {
  if (!input) return '';
  return input
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{4,}/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[A-Za-z0-9_\-\.]{4,}(["']?)/gi, '$1[REDACTED]$2')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_\-]{8,})\b/g, 'sk-[REDACTED]')
    .replace(/((?:password|secret|token|credential|auth)[_-]?(?:key)?["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]');
}

function formatTokenSummary(key?: string): string {
  if (!key) return ' [Token: EMPTY]';
  const trimmed = key.trim();
  if (trimmed === 'local' || !trimmed) return ' [Token: LOCAL/NONE]';
  if (trimmed.length <= 8) return ` [Token: *** (len ${trimmed.length})]`;
  return ` [Token: ${trimmed.slice(0, 4)}...${trimmed.slice(-4)} (len ${trimmed.length})]`;
}

/**
 * Appends diagnostic failure details to logs/providers.log when a provider call returns non-200.
 */
export function logProviderFailure(info: ProviderFailureInfo): void {
  try {
    const logsDir = process.env.TSUKA_LOGS_DIR || homePath('logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFile = path.join(logsDir, 'providers.log');
    const timestamp = new Date().toISOString();

    const providerLabel = info.provider ? ` [${info.provider}]` : '';
    const statusLabel = info.status ? ` [HTTP ${info.status}]` : ' [ERROR]';
    const modelLabel = info.model ? ` model=${info.model}` : '';
    const attemptLabel = info.attempt ? ` attempt=${info.attempt}/${info.maxRetries ?? info.attempt}` : '';
    const tokenLabel = formatTokenSummary(info.apiKey);
    const cleanUrl = maskSensitiveCredentials(info.baseUrl);

    let errorMsg = typeof info.error === 'string' ? info.error : info.error?.message || String(info.error);
    errorMsg = maskSensitiveCredentials(errorMsg).replace(/\x1b\[[0-9;]*m/g, '').trim();

    let requestStr = '';
    if (info.requestPayload !== undefined && info.requestPayload !== null) {
      try {
        const rawPayload = typeof info.requestPayload === 'string'
          ? info.requestPayload
          : JSON.stringify(info.requestPayload, null, 2);
        requestStr = `\n  Request Payload:\n${maskSensitiveCredentials(rawPayload).split('\n').map(l => '    ' + l).join('\n')}`;
      } catch {}
    }

    let detailsStr = '';
    if (info.responseBody !== undefined && info.responseBody !== null) {
      try {
        const rawJson = typeof info.responseBody === 'string'
          ? info.responseBody
          : JSON.stringify(info.responseBody, null, 2);
        detailsStr = `\n  Response Body:\n${maskSensitiveCredentials(rawJson).split('\n').map(l => '    ' + l).join('\n')}`;
      } catch {}
    }

    let remediation = '';
    const errorLower = errorMsg.toLowerCase();
    if (info.status === 401 || info.status === 403 || errorLower.includes('unauthorized') || errorLower.includes('forbidden') || errorLower.includes('api key')) {
      remediation = '\n  Remediation: Check your API key in .env or verify account quota/permissions with the provider.';
    } else if (errorLower.includes('econnrefused') || errorLower.includes('fetch failed')) {
      remediation = '\n  Remediation: Verify that the local or remote LLM server is running and accessible at the configured baseUrl.';
    }

    const logEntry =
      `[${timestamp}]${statusLabel}${providerLabel}${tokenLabel} operation=${info.operation}${modelLabel} endpoint=${cleanUrl}${attemptLabel}\n` +
      `  Message: ${errorMsg}` +
      requestStr +
      detailsStr +
      remediation +
      '\n\n';

    fs.appendFileSync(logFile, logEntry, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logSink.warn(`Failed to write to providers.log: ${message}`);
  }
}
