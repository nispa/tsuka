import { Tool } from '../registry';
import { capForContext } from '../../core/contextBudget';
import { safeFetch } from '../../core/network';
import { createHotPathConfigCache } from '../../core/config/hotPathCache';
import { TOOLS_DEFAULTS } from '../../core/constants';
import { formatWebSearchResults, normalizeWebSearchResult, parseDuckDuckGoResults } from './webSearchParsing';

const configCache = createHotPathConfigCache();

async function searchDuckDuckGo(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const response = await safeFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
      }
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo HTTP error: ${response.status}`);
    }

    return formatWebSearchResults(parseDuckDuckGoResults(await response.text()));
  } catch (error: any) {
    throw new Error(`Error during DuckDuckGo search: ${error.message}`);
  }
}

async function searchGoogle(query: string): Promise<string> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) {
    throw new Error('GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX not configured in .env.');
  }

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;
    const response = await safeFetch(url);
    if (!response.ok) {
      throw new Error(`Google Custom Search API error: ${response.status}`);
    }

    const data = await response.json() as { items?: Array<{ title: string; link: string; snippet: string }> };
    if (data.items && Array.isArray(data.items)) {
      return formatWebSearchResults(data.items.map((item) =>
        normalizeWebSearchResult(item.title, item.link, item.snippet)
      ));
    }
    
    return 'Google Search returned an empty or unsupported response format.';
  } catch (error: any) {
    throw new Error(`Error during Google search: ${error.message}`);
  }
}

async function searchTavily(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY not found in .env. Configure the key or change search engine.');
  }

  try {
    const response = await safeFetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: 'basic',
        max_results: TOOLS_DEFAULTS.webSearchMaxResults
      })
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status}`);
    }

    const data = await response.json() as { results?: Array<{ title: string; url: string; content: string }> };
    if (data.results && Array.isArray(data.results)) {
      return formatWebSearchResults(data.results.map((result) =>
        normalizeWebSearchResult(result.title, result.url, result.content)
      ));
    }
    
    return 'Tavily returned an unsupported response format.';
  } catch (error: any) {
    throw new Error(`Error during Tavily search: ${error.message}`);
  }
}

export const webSearchTool: Tool = {
  name: 'web_search',
  riskLevel: 'SAFE',
  execute: async (args: { query: string }) => {
    const provider = getConfiguredWebSearchProvider();

    let result: string;
    if (provider === 'tavily') {
      result = await searchTavily(args.query);
    } else if (provider === 'google') {
      result = await searchGoogle(args.query);
    } else {
      result = await searchDuckDuckGo(args.query);
    }

    return capForContext(result, undefined, {
      label: `search results for "${args.query}"`,
      recoveryHint: `Narrow your web_search query, or use browse_url on the most promising result URL.`
    });
  }
};

/** Resolves the configured provider through the local hot-path snapshot. */
export function getConfiguredWebSearchProvider() {
  return configCache.get().getWebSearchProvider();
}

/** Exposes cache counters so regression tests can prove search calls do not reload config. */
export function getWebSearchConfigCacheMetrics() {
  return configCache.getMetrics();
}
