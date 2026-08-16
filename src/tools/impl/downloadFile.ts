import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

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
  execute: async (args: { url: string; path?: string }) => {
    let targetUrl = args.url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    let fetchTimeoutMs = 60_000;
    try {
      const { ConfigManager } = require('../../core/config');
      fetchTimeoutMs = new ConfigManager().getDownloadFetchTimeoutMs();
    } catch {}
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

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

      fs.writeFileSync(fullPath, buffer);

      const sizeKb = (buffer.byteLength / 1024).toFixed(1);
      const sizeFormatted = buffer.byteLength > 1024 * 1024
        ? `${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB`
        : `${sizeKb} KB`;

      return `✔ File downloaded successfully from '${targetUrl}' to '${destPath}' (${sizeFormatted}, type: ${contentType || 'binary'}).`;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Timeout: download from '${targetUrl}' exceeded limit of ${fetchTimeoutMs / 1000}s.`);
      }
      throw new Error(`Failed to download file from '${targetUrl}': ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
};
