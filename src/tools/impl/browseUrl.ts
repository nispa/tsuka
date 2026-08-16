import { Tool } from '../registry';
import { capForContext } from '../../core/contextBudget';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * Risolve un URL relativo o assoluto rispetto a un URL di base.
 */
export function resolveAbsoluteUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute, baseUrl).href;
  } catch {
    return relativeOrAbsolute;
  }
}

/**
 * Estrae immagini e media rilevanti dall'HTML (supporto Vision LLM / multimodale).
 */
export function extractMedia(html: string, baseUrl: string): { images: { alt: string; url: string }[]; videos: { title: string; url: string }[] } {
  const images: { alt: string; url: string }[] = [];
  const videos: { title: string; url: string }[] = [];
  const seenUrls = new Set<string>();

  // 1. Estrazione immagini <img ...>
  const imgRegex = /<img\s+[^>]*?src=["']([^"']+)["'][^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const fullTag = imgMatch[0];
    const rawSrc = imgMatch[1];

    // Ignora inline pixel di tracking o data-uri 1x1
    if (!rawSrc || rawSrc.startsWith('data:image/svg') || rawSrc.includes('1x1') || rawSrc.includes('spacer')) {
      continue;
    }

    const altMatch = fullTag.match(/alt=["']([^"']*)["']/i);
    const alt = (altMatch ? altMatch[1] : '').trim() || 'Immagine';
    const resolvedUrl = resolveAbsoluteUrl(rawSrc, baseUrl);

    if (!seenUrls.has(resolvedUrl)) {
      seenUrls.add(resolvedUrl);
      images.push({ alt, url: resolvedUrl });
    }
  }

  // 2. Estrazione video e iframe player (<video src>, <source src>, <iframe src>)
  const videoRegex = /<(?:video|source|iframe)\s+[^>]*?src=["']([^"']+)["'][^>]*>/gi;
  let videoMatch: RegExpExecArray | null;
  while ((videoMatch = videoRegex.exec(html)) !== null) {
    const fullTag = videoMatch[0];
    const rawSrc = videoMatch[1];
    if (!rawSrc) continue;

    // Filtra iframe non-video (es. ad/tracking)
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
 * Pulisce il codice HTML scartando componenti non rilevanti (Reader View).
 */
export function cleanHtmlForReader(html: string): string {
  let clean = html;

  // Rimuove script, stili, noscript, svg, form
  clean = clean.replace(/<script[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  clean = clean.replace(/<svg[\s\S]*?<\/svg>/gi, '');
  clean = clean.replace(/<form[\s\S]*?<\/form>/gi, '');

  // Rimuove barre di navigazione, header, footer, aside
  clean = clean.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  clean = clean.replace(/<header[\s\S]*?<\/header>/gi, '');
  clean = clean.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  clean = clean.replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Rimuove blocchi cookie / privacy / banner noti
  clean = clean.replace(/<div[^>]*?(?:cookie|consent|privacy-banner|ad-container|advertisement)[^>]*>[\s\S]*?<\/div>/gi, '');

  // Se è presente un tag <article> o <main> consistente (> 300 char), preferiscilo
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
 * Converte HTML in Markdown strutturato con supporto a tabelle GFM, media e URL assoluti.
 */
export function htmlToMarkdown(html: string, baseUrl: string = ''): string {
  // 1. Estrazione media per agenti Vision
  const media = baseUrl ? extractMedia(html, baseUrl) : { images: [], videos: [] };

  // 2. Pulizia semantica Reader View
  const cleanedHtml = cleanHtmlForReader(html);

  // 3. Conversione HTML-to-Markdown strutturata con NodeHtmlMarkdown
  const nhm = new NodeHtmlMarkdown({
    useInlineLinks: true,
  });

  let markdown = nhm.translate(cleanedHtml).trim();

  // Risolve i link relativi nel markdown risultante se baseUrl è fornita
  if (baseUrl) {
    markdown = markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, href) => {
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('#')) {
        return match;
      }
      return `[${text}](${resolveAbsoluteUrl(href, baseUrl)})`;
    });
  }

  // 4. Sezione Media per modelli Vision (se sono presenti media rilevanti)
  const mediaSections: string[] = [];
  if (media.images.length > 0) {
    const imgList = media.images.slice(0, 10).map((img) => `- ![${img.alt}](${img.url})`).join('\n');
    mediaSections.push(`#### 🖼️ Immagini rilevate (Vision LLM):\n${imgList}`);
  }
  if (media.videos.length > 0) {
    const vidList = media.videos.slice(0, 5).map((vid) => `- [${vid.title}](${vid.url})`).join('\n');
    mediaSections.push(`#### 🎥 Video / Media rilevati:\n${vidList}`);
  }

  if (mediaSections.length > 0) {
    markdown += `\n\n---\n### 📎 Media & Risorse della Pagina\n${mediaSections.join('\n\n')}`;
  }

  // Compatta righe vuote multiple
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

    // Timeout di navigazione: evita che un sito lento/irraggiungibile blocchi l'agente all'infinito
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
        throw new Error(`Errore HTTP: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
        throw new Error(`Tipo di contenuto non supportato per la lettura testuale: ${contentType}`);
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
        return '[La pagina visitata non contiene testo utile]';
      }

      // T8.8: il tetto in token sostituisce il taglio ad-hoc precedente
      return capForContext(markdown, undefined, {
        label: `la pagina '${targetUrl}'`,
        recoveryHint: `Non è possibile paginare browse_url: prova a cercare la sezione che serve con web_search, ` +
          `o visita un URL più specifico della stessa pagina se disponibile (es. un'ancora o una sotto-pagina).`
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`Timeout: la pagina '${targetUrl}' non ha risposto entro ${FETCH_TIMEOUT_MS / 1000} secondi.`);
      }
      throw new Error(`Impossibile leggere la pagina '${targetUrl}': ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
};
