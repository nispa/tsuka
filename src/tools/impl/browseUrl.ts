import { Tool } from '../registry';
import { capForContext } from '../../core/contextBudget';

function htmlToMarkdown(html: string): string {
  let clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  clean = clean.replace(/<svg[\s\S]*?<\/svg>/gi, '');
  clean = clean.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  clean = clean.replace(/<header[\s\S]*?<\/header>/gi, '');
  clean = clean.replace(/<footer[\s\S]*?<\/footer>/gi, '');

  clean = clean.replace(/<pre[\s\S]*?><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  clean = clean.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  clean = clean.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  clean = clean.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  clean = clean.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  clean = clean.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n#### $1\n');

  clean = clean.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  clean = clean.replace(/<br\s*\/?>/gi, '\n');

  clean = clean.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');

  clean = clean.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  clean = clean.replace(/<[^>]*>/g, '');

  clean = clean.replace(/&amp;/g, '&');
  clean = clean.replace(/&lt;/g, '<');
  clean = clean.replace(/&gt;/g, '>');
  clean = clean.replace(/&quot;/g, '"');
  clean = clean.replace(/&#39;/g, "'");
  clean = clean.replace(/&nbsp;/g, ' ');

  clean = clean.replace(/\n\s*\n\s*\n+/g, '\n\n');

  return clean.trim();
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
        markdown = htmlToMarkdown(text);
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

      // T8.8: il tetto in token sostituisce il taglio ad-hoc precedente (era in caratteri,
      // senza indicazione di come recuperare il resto).
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
