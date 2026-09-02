import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';
import { safeFetch } from '../../core/network';
import { ConfigManager } from '../../core/config';
import type { ToolExecutionContext } from '../types';

/**
 * Infers a sensible filename from a URL or content-type header.
 */
function inferFilenameFromUrl(urlStr: string, contentType: string = ''): string {
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname;
    const base = path.basename(pathname);
    if (base && base.includes('.')) {
      return base.replace(/[^a-zA-Z0-9._-]/g, '_');
    }
  } catch {}

  let ext = '.bin';
  if (contentType.includes('image/png')) ext = '.png';
  else if (contentType.includes('image/jpeg')) ext = '.jpg';
  else if (contentType.includes('image/webp')) ext = '.webp';
  else if (contentType.includes('image/gif')) ext = '.gif';
  else if (contentType.includes('video/mp4')) ext = '.mp4';
  else if (contentType.includes('video/webm')) ext = '.webm';
  else if (contentType.includes('application/pdf')) ext = '.pdf';
  else if (contentType.includes('application/json')) ext = '.json';
  else if (contentType.includes('text/plain')) ext = '.txt';

  return `download_${Date.now()}${ext}`;
}

export const downloadFileTool: Tool = {
  name: 'download_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { url: string; path?: string }, context?: ToolExecutionContext) => {
    let targetUrl = args.url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const config = new ConfigManager();
    const fetchTimeoutMs = config.getDownloadFetchTimeoutMs();
    const maxBytes = config.getDownloadMaxBytes();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, fetchTimeoutMs);
    const abortFromCaller = () => controller.abort();
    if (context?.signal?.aborted) controller.abort();
    else context?.signal?.addEventListener('abort', abortFromCaller, { once: true });
    let temporaryPath: string | undefined;

    try {
      const response = await safeFetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const declaredLength = response.headers.get('content-length');
      const contentLength = declaredLength && /^\d+$/.test(declaredLength) ? Number(declaredLength) : undefined;
      if (contentLength !== undefined && contentLength > maxBytes) {
        throw new Error(`Download exceeds the configured limit of ${maxBytes} bytes.`);
      }
      if (!response.body) {
        throw new Error('Response body is empty.');
      }

      let destPath = (args.path || '').trim();
      if (!destPath || destPath.endsWith('/') || destPath.endsWith('\\')) {
        const filename = inferFilenameFromUrl(targetUrl, contentType);
        destPath = destPath ? path.join(destPath, filename) : path.join('downloads', filename);
      }

      const fullPath = resolveSafePath(destPath);
      const parentDir = path.dirname(fullPath);

      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      temporaryPath = path.join(parentDir, `.${path.basename(fullPath)}.${randomUUID()}.part`);
      let downloadedBytes = 0;
      const byteCounter = new (class extends Transform {
        override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
          downloadedBytes += chunk.byteLength;
          if (downloadedBytes > maxBytes) {
            callback(new Error(`Download exceeds the configured limit of ${maxBytes} bytes.`));
            return;
          }
          callback(null, chunk);
        }
      })();
      await pipeline(
        Readable.fromWeb(response.body as import('stream/web').ReadableStream),
        byteCounter,
        fs.createWriteStream(temporaryPath, { flags: 'wx' }),
        { signal: controller.signal }
      );
      fs.renameSync(temporaryPath, fullPath);
      temporaryPath = undefined;

      const sizeKb = (downloadedBytes / 1024).toFixed(1);
      const sizeFormatted = downloadedBytes > 1024 * 1024
        ? `${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB`
        : `${sizeKb} KB`;

      return `✔ File downloaded successfully from '${targetUrl}' to '${destPath}' (${sizeFormatted}, type: ${contentType || 'binary'}).`;
    } catch (error: any) {
      if (controller.signal.aborted && timedOut) {
        throw new Error(`Timeout: download from '${targetUrl}' exceeded limit of ${fetchTimeoutMs / 1000}s.`);
      }
      if (controller.signal.aborted) {
        throw new Error(`Download from '${targetUrl}' was cancelled.`);
      }
      throw new Error(`Failed to download file from '${targetUrl}': ${error.message}`);
    } finally {
      clearTimeout(timeout);
      context?.signal?.removeEventListener('abort', abortFromCaller);
      if (temporaryPath) {
        try { fs.unlinkSync(temporaryPath); } catch {}
      }
    }
  }
};
