/** Deterministic coverage for the pluggable, catalog-driven web_search capability (T23.13). */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

async function rejects(action: () => Promise<unknown>, expected: string): Promise<boolean> {
  try {
    await action();
    return false;
  } catch (error: unknown) {
    return error instanceof Error && error.message.includes(expected);
  }
}

async function main(): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-web-search-home-'));
  const previousHome = process.env.TSUKA_HOME;
  const previousGoogleKey = process.env.GOOGLE_SEARCH_API_KEY;
  const previousGoogleCx = process.env.GOOGLE_SEARCH_CX;
  const previousTavilyKey = process.env.TAVILY_API_KEY;
  process.env.TSUKA_HOME = home;
  fs.copyFileSync(path.join(process.cwd(), 'providers.json'), path.join(home, 'providers.json'));
  fs.copyFileSync(path.join(process.cwd(), 'web_search_providers.json'), path.join(home, 'web_search_providers.json'));
  fs.writeFileSync(path.join(home, 'tsuka.config.json'), JSON.stringify({
    activeProvider: 'ollama',
    webSearch: { backend: 'fixture', provider: 'ignored' },
    activeRole: 'developer', activeTrait: 'professional', activeCharacter: 'custom'
  }));

  try {
    const { loadWebSearchCatalog, listWebSearchProviderOptions } = await import('../src/core/webSearchCatalog');
    const { HttpWebSearchBackend } = await import('../src/tools/webSearch/httpBackend');
    const { createWebSearchBackend, listWebSearchBackends, registerWebSearchBackend } = await import('../src/tools/webSearch/registry');
    const { adaptMcpWebSearchBackend } = await import('../src/tools/webSearch/mcpAdapter');
    const { webSearchTool } = await import('../src/tools/impl/webSearch');
    const catalog = loadWebSearchCatalog();
    const options = listWebSearchProviderOptions(catalog);

    check('WS.1', options.map((option) => option.id).join(',') === 'duckduckgo,google,tavily', 'the versioned catalog exposes all built-in HTTP providers as data');
    check('WS.2', catalog.google.query?.key?.source === 'env' && catalog.tavily.body?.api_key?.source === 'env', 'credentials in the catalog are environment references, never values');

    process.env.GOOGLE_SEARCH_API_KEY = 'google-secret-must-not-leak';
    process.env.GOOGLE_SEARCH_CX = 'search-engine-id';
    let googleRequest = '';
    const google = new HttpWebSearchBackend('google', catalog, async (input) => {
      googleRequest = input.toString();
      return new Response(JSON.stringify({ items: [{ title: 'Google\nTitle', link: 'https://example.com/google', snippet: 'One\ntwo' }] }), { status: 200 });
    });
    const googleResults = await google.search('safe query');
    check('WS.3', googleRequest.includes('q=safe+query') && googleResults[0]?.title === 'Google Title' && googleResults[0]?.snippet === 'One two', 'Google request and JSON mapping are catalog-driven and normalized');
    check('WS.4', !JSON.stringify(googleResults).includes('google-secret-must-not-leak'), 'credential values never appear in normalized results');
    let reflectedError = '';
    try {
      await new HttpWebSearchBackend('google', catalog, async () => { throw new Error('request failed: google-secret-must-not-leak'); }).search('query');
    } catch (error: unknown) {
      reflectedError = error instanceof Error ? error.message : '';
    }
    check('WS.4a', reflectedError.includes('[REDACTED]') && !reflectedError.includes('google-secret-must-not-leak'), 'transport failures redact any reflected environment credential');

    process.env.TAVILY_API_KEY = 'tavily-secret-must-not-leak';
    let tavilyBody = '';
    const tavily = new HttpWebSearchBackend('tavily', catalog, async (_input, init) => {
      tavilyBody = String(init?.body);
      return new Response(JSON.stringify({ results: [{ title: 'Tavily', url: 'https://example.com/tavily', content: 'Result' }] }), { status: 200 });
    });
    const tavilyResults = await tavily.search('catalog request');
    check('WS.5', tavilyBody.includes('"max_results":5') && tavilyResults.length === 1, 'Tavily POST body uses catalog sources and shared result bounds');

    delete process.env.GOOGLE_SEARCH_API_KEY;
    const missingKey = await rejects(() => new HttpWebSearchBackend('google', catalog, async () => new Response()).search('query'), 'GOOGLE_SEARCH_API_KEY');
    check('WS.6', missingKey, 'missing environment references fail with the variable name but no credential value');

    const duckduckgo = new HttpWebSearchBackend('duckduckgo', catalog, async () => new Response('<div class="web-result"><a class="result__a" href="https://example.com/ddg">DDG</a><span class="result__snippet">Bounded\ntext</span></div>', { status: 200 }));
    const duckduckgoResults = await duckduckgo.search('fixture');
    check('WS.7', duckduckgoResults[0]?.title === 'DDG' && duckduckgoResults[0]?.snippet === 'Bounded text', 'DuckDuckGo remains a registered DOM adapter behind the HTTP catalog');

    const badCatalogPath = path.join(home, 'invalid-web-search-catalog.json');
    fs.writeFileSync(badCatalogPath, JSON.stringify({ version: 1, providers: { bad: { transport: 'json', endpoint: 'http://localhost/', method: 'GET', response: {} } } }));
    const invalidCatalog = (() => { try { loadWebSearchCatalog(badCatalogPath); return false; } catch { return true; } })();
    check('WS.8', invalidCatalog, 'invalid catalog mappings and non-HTTPS endpoints are rejected deterministically');

    const credentialCatalogPath = path.join(home, 'credential-web-search-catalog.json');
    fs.writeFileSync(credentialCatalogPath, JSON.stringify({ version: 1, providers: {
      badheader: { displayName: 'Bad', hint: '', transport: 'json', endpoint: 'https://example.com/search', method: 'GET', headers: { Authorization: { source: 'literal', value: 'Bearer real-token' } }, response: { itemsPath: 'items', titlePath: 'title', urlPath: 'url', snippetPath: 'snippet' } }
    } }));
    const literalCredentialRejected = (() => { try { loadWebSearchCatalog(credentialCatalogPath); return false; } catch { return true; } })();
    check('WS.8a', literalCredentialRejected, 'sensitive catalog headers must be environment references, not literal credentials');

    const bodyCredentialCatalogPath = path.join(home, 'body-credential-web-search-catalog.json');
    fs.writeFileSync(bodyCredentialCatalogPath, JSON.stringify({ version: 1, providers: {
      badbody: { displayName: 'Bad', hint: '', transport: 'json', endpoint: 'https://example.com/search', method: 'POST', body: { api_key: { source: 'literal', value: 'real-token' } }, response: { itemsPath: 'items', titlePath: 'title', urlPath: 'url', snippetPath: 'snippet' } }
    } }));
    const literalBodyCredentialRejected = (() => { try { loadWebSearchCatalog(bodyCredentialCatalogPath); return false; } catch { return true; } })();
    check('WS.8b', literalBodyCredentialRejected, 'sensitive query and body fields must reference environment variables');

    const privateCatalog = {
      local: { ...catalog.duckduckgo, endpoint: 'https://localhost/search' }
    };
    const privateRejected = await rejects(() => new HttpWebSearchBackend('local', privateCatalog).search('query'), 'non-public address');
    check('WS.9', privateRejected, 'HTTP providers retain the safeFetch SSRF boundary');

    registerWebSearchBackend('fixture', () => ({ id: 'fixture', search: async () => [{ title: 'Fake\nbackend', url: 'https://example.com/fake', snippet: 'normalized\nvalue' }] }));
    const fake = createWebSearchBackend('fixture', { provider: 'ignored' });
    const toolOutput = await webSearchTool.execute({ query: 'registry selection' });
    check('WS.10', fake.id === 'fixture' && toolOutput.includes('Title: Fake backend') && listWebSearchBackends().includes('fixture'), 'config-selected registry backend keeps one public web_search tool');

    const mcp = adaptMcpWebSearchBackend('mcp-fixture', { searchWeb: async () => [{ title: 'MCP\nTitle', url: 'https://example.com/mcp', snippet: 'MCP\nSnippet' }] });
    const mcpResults = await mcp.search('query');
    check('WS.11', mcpResults[0]?.title === 'MCP Title' && mcpResults[0]?.snippet === 'MCP Snippet', 'external MCP adapter contract returns only normalized result fields');

    assert.ok(!toolOutput.includes('tavily-secret-must-not-leak'));
  } finally {
    if (previousHome === undefined) delete process.env.TSUKA_HOME; else process.env.TSUKA_HOME = previousHome;
    if (previousGoogleKey === undefined) delete process.env.GOOGLE_SEARCH_API_KEY; else process.env.GOOGLE_SEARCH_API_KEY = previousGoogleKey;
    if (previousGoogleCx === undefined) delete process.env.GOOGLE_SEARCH_CX; else process.env.GOOGLE_SEARCH_CX = previousGoogleCx;
    if (previousTavilyKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previousTavilyKey;
    fs.rmSync(home, { recursive: true, force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
