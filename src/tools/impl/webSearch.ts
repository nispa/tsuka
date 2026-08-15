import { Tool } from '../registry';
import { ConfigManager, CONFIG_PATH } from '../../core/config';
import { capForContext } from '../../core/contextBudget';
import * as fs from 'fs';

// dotenv caricato dal punto di ingresso (cli/index.ts)

// Istanza condivisa del ConfigManager, ricaricata solo se il file su disco cambia
// (evita di istanziare — e riscrivere — la configurazione a ogni ricerca web)
let cachedConfigManager: ConfigManager | null = null;
let cachedConfigMtime = -1;

function getSharedConfigManager(): ConfigManager {
  let mtime = -1;
  try {
    mtime = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {}
  if (!cachedConfigManager || mtime !== cachedConfigMtime) {
    cachedConfigManager = new ConfigManager();
    cachedConfigMtime = mtime;
  }
  return cachedConfigManager;
}

async function searchDuckDuckGo(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Errore HTTP di DuckDuckGo: ${response.status}`);
    }

    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    const matches = html.matchAll(/<div class="[^"]*web-result[^"]*">([\s\S]*?)<\/div>/g);
    for (const match of matches) {
      const block = match[1];

      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (titleMatch) {
        let link = titleMatch[1];
        if (link.includes('uddg=')) {
          const urlParam = link.split('uddg=')[1]?.split('&')[0];
          if (urlParam) {
            link = decodeURIComponent(urlParam);
          }
        }
        if (link.startsWith('//')) {
          link = 'https:' + link;
        }

        const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';

        results.push({ title, url: link, snippet });
        if (results.length >= 5) break;
      }
    }

    if (results.length === 0) {
      return 'Nessun risultato utile trovato su DuckDuckGo.';
    }

    return results
      .map((r, i) => `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet}`)
      .join('\n\n');
  } catch (error: any) {
    throw new Error(`Errore durante la ricerca DuckDuckGo: ${error.message}`);
  }
}

async function searchGoogle(query: string): Promise<string> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) {
    throw new Error('Chiave API GOOGLE_SEARCH_API_KEY o ID motore GOOGLE_SEARCH_CX non trovati nel file .env.');
  }

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Errore API Google Custom Search: ${response.status}`);
    }

    const data = await response.json() as { items?: Array<{ title: string; link: string; snippet: string }> };
    if (data.items && Array.isArray(data.items)) {
      if (data.items.length === 0) {
        return 'Nessun risultato trovato su Google.';
      }
      return data.items
        .map((item, i) => `${i + 1}. **[${item.title}](${item.link})**\n   ${item.snippet}`)
        .join('\n\n');
    }
    
    return 'Risposta Google Search in formato vuoto o non supportato.';
  } catch (error: any) {
    throw new Error(`Errore durante la ricerca Google: ${error.message}`);
  }
}

async function searchTavily(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('Chiave API TAVILY_API_KEY non trovata nel file .env. Configura la chiave o cambia motore di ricerca.');
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: 'basic',
        max_results: 5
      })
    });

    if (!response.ok) {
      throw new Error(`Errore API Tavily: ${response.status}`);
    }

    const data = await response.json() as { results?: Array<{ title: string; url: string; content: string }> };
    if (data.results && Array.isArray(data.results)) {
      if (data.results.length === 0) {
        return 'Nessun risultato trovato su Tavily.';
      }
      return data.results
        .map((r, i) => `${i + 1}. **[${r.title}](${r.url})**\n   ${r.content}`)
        .join('\n\n');
    }
    
    return 'Risposta Tavily in formato non supportato.';
  } catch (error: any) {
    throw new Error(`Errore durante la ricerca Tavily: ${error.message}`);
  }
}

export const webSearchTool: Tool = {
  name: 'web_search',
  riskLevel: 'SAFE',
  execute: async (args: { query: string }) => {
    const configManager = getSharedConfigManager();
    const provider = configManager.getWebSearchProvider();

    let result: string;
    if (provider === 'tavily') {
      result = await searchTavily(args.query);
    } else if (provider === 'google') {
      result = await searchGoogle(args.query);
    } else {
      result = await searchDuckDuckGo(args.query);
    }

    // T8.8: normalmente pochi risultati brevi, ma un motore può restituire snippet
    // molto lunghi (es. Tavily con contenuto esteso) — stesso tetto degli altri tool.
    return capForContext(result, undefined, {
      label: `i risultati di ricerca per "${args.query}"`,
      recoveryHint: `Restringi la query di web_search, oppure usa browse_url sull'URL più promettente tra i risultati.`
    });
  }
};
