import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

/**
 * Deduce un nome file sensato dall'URL o da un header se l'utente non lo specifica.
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

  // Mappa estensione da contentType se non presente nel path
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

    const FETCH_TIMEOUT_MS = 60_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Errore HTTP ${response.status}: ${response.statusText}`);
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

      return `✔ File scaricato con successo da '${targetUrl}' e salvato in '${destPath}' (${sizeFormatted}, tipo: ${contentType || 'binario'}).`;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Timeout: il download da '${targetUrl}' ha superato il limite di ${FETCH_TIMEOUT_MS / 1000}s.`);
      }
      throw new Error(`Impossibile scaricare il file da '${targetUrl}': ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
};
