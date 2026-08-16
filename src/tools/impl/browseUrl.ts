import { Tool } from '../registry';
import { capForContext } from '../../core/contextBudget';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Resolves a relative or absolute URL against a base URL.
 */
export function resolveAbsoluteUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute, baseUrl).href;
  } catch {
    return relativeOrAbsolute;
  }
}

/**
 * Extracts relevant images and media elements from HTML for multimodal/vision agents.
 */
export function extractMedia(html: string, baseUrl: string): { images: { alt: string; url: string }[]; videos: { title: string; url: string }[] } {
  const images: { alt: string; url: string }[] = [];
  const videos: { title: string; url: string }[] = [];
  const seenUrls = new Set<string>();

  // 1. Image extraction <img ...>
  const imgRegex = /<img\s+[^>]*?src=["']([^"']+)["'][^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const fullTag = imgMatch[0];
    const rawSrc = imgMatch[1];

    if (!rawSrc || rawSrc.startsWith('data:image/svg') || rawSrc.includes('1x1') || rawSrc.includes('spacer')) {
      continue;
    }

    const altMatch = fullTag.match(/alt=["']([^"']*)["']/i);
    const alt = (altMatch ? altMatch[1] : '').trim() || 'Image';
    const resolvedUrl = resolveAbsoluteUrl(rawSrc, baseUrl);

    if (!seenUrls.has(resolvedUrl)) {
      seenUrls.add(resolvedUrl);
      images.push({ alt, url: resolvedUrl });
    }
  }

  // 2. Video and iframe player extraction (<video src>, <source src>, <iframe src>)
  const videoRegex = /<(?:video|source|iframe)\s+[^>]*?src=["']([^"']+)["'][^>]*>/gi;
  let videoMatch: RegExpExecArray | null;
  while ((videoMatch = videoRegex.exec(html)) !== null) {
    const fullTag = videoMatch[0];
    const rawSrc = videoMatch[1];
    if (!rawSrc) continue;

    const isVideoIframe = fullTag.toLowerCase().includes('youtube.com') ||
      fullTag.toLowerCase().includes('vimeo.com') ||
      fullTag.toLowerCase().includes('player') ||
      fullTag.toLowerCase().includes('video') ||
      rawSrc.endsWith('.mp4') ||
      rawSrc.endsWith('.webm');

    if (!isVideoIframe && fullTag.toLowerCase().startsWith('<iframe')) {
      continue;
    }

    const titleMatch = fullTag.match(/title=["']([^"']*)["']/i);
    const title = (titleMatch ? titleMatch[1] : '').trim() || 'Video / Media Player';
    const resolvedUrl = resolveAbsoluteUrl(rawSrc, baseUrl);

    if (!seenUrls.has(resolvedUrl)) {
      seenUrls.add(resolvedUrl);
      videos.push({ title, url: resolvedUrl });
    }
  }

  return { images, videos };
}

/**
 * Cleans HTML content for reader view extraction.
 */
export function cleanHtmlForReader(html: string): string {
  let clean = html;

  // Remove scripts, styles, noscript, svg, forms
  clean = clean.replace(/<script[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  clean = clean.replace(/<svg[\s\S]*?<\/svg>/gi, '');
  clean = clean.replace(/<form[\s\S]*?<\/form>/gi, '');

  // Remove navigation bars, headers, footers, asides
  clean = clean.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  clean = clean.replace(/<header[\s\S]*?<\/header>/gi, '');
  clean = clean.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  clean = clean.replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Remove known cookie / privacy banners
  clean = clean.replace(/<div[^>]*?(?:cookie|consent|privacy-banner|ad-container|advertisement)[^>]*>[\s\S]*?<\/div>/gi, '');

  // Prioritize substantial <article> or <main> elements
  const articleMatch = clean.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch && articleMatch[0].length > 300) {
    return articleMatch[0];
  }
  const mainMatch = clean.match(/<main[\s\S]*?<\/main>/i);
  if (mainMatch && mainMatch[0].length > 300) {
    return mainMatch[0];
  }

  return clean;
}

/**
 * Converts HTML to structured Markdown with media preservation.
 */
export function htmlToMarkdown(html: string, baseUrl: string = ''): string {
  const media = baseUrl ? extractMedia(html, baseUrl) : { images: [], videos: [] };
  const cleanedHtml = cleanHtmlForReader(html);

  const nhm = new NodeHtmlMarkdown({
    useInlineLinks: true,
  });

  let markdown = nhm.translate(cleanedHtml).trim();

  if (baseUrl) {
    markdown = markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, href) => {
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('#')) {
        return match;
      }
      return `[${text}](${resolveAbsoluteUrl(href, baseUrl)})`;
    });
  }

  const mediaSections: string[] = [];
  if (media.images.length > 0) {
    const imgList = media.images.slice(0, 10).map((img) => `- ![${img.alt}](${img.url})`).join('\n');
    mediaSections.push(`#### 🖼️ Detected Images (Vision LLM):\n${imgList}`);
  }
  if (media.videos.length > 0) {
    const vidList = media.videos.slice(0, 5).map((vid) => `- [${vid.title}](${vid.url})`).join('\n');
    mediaSections.push(`#### 🎥 Detected Videos / Media:\n${vidList}`);
  }

  if (mediaSections.length > 0) {
    markdown += `\n\n---\n### 📎 Page Media & Resources\n${mediaSections.join('\n\n')}`;
  }

  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  return markdown.trim();
}

export const browseUrlTool: Tool = {
  name: 'browse_url',
  riskLevel: 'SAFE',
  execute: async (args: { url: string }) => {
    let targetUrl = args.url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const FETCH_TIMEOUT_MS = 30_000;
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
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
        throw new Error(`Unsupported content type for text parsing: ${contentType}`);
      }

      const text = await response.text();

      let markdown = '';
      if (contentType.includes('text/html')) {
        markdown = htmlToMarkdown(text, targetUrl);
      } else if (contentType.includes('application/json')) {
        try {
          markdown = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          markdown = text;
        }
      } else {
        markdown = text;
      }

      if (!markdown) {
        return '[The visited page contains no useful text content]';
      }

      return capForContext(markdown, undefined, {
        label: `page '${targetUrl}'`,
        recoveryHint: `browse_url cannot be paginated: try searching with web_search or visiting a more specific subpage URL.`
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Timeout: page '${targetUrl}' did not respond within ${FETCH_TIMEOUT_MS / 1000} seconds.`);
      }
      throw new Error(`Failed to read page '${targetUrl}': ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
};
