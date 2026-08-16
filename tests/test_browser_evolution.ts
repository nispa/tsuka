/**
 * Suite di test per l'evoluzione del tool browse_url (T12.1):
 * - Conversione tabelle GFM
 * - Reader View (scarto nav, footer, script, cookie banner)
 * - Estrazione immagini e media per Vision LLM
 * - Risoluzione link e URL assoluti
 * Esecuzione: npx tsx tests/test_browser_evolution.ts
 */
import { htmlToMarkdown, extractMedia, cleanHtmlForReader, resolveAbsoluteUrl } from '../src/tools/impl/browseUrl';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

async function run() {
  console.log('=== Test Evoluzione browse_url (HTML-to-Markdown & Media) ===\n');

  // 1. Risoluzione URL Assoluti
  const abs1 = resolveAbsoluteUrl('/images/logo.png', 'https://example.com/docs/intro');
  check('BROWSE.1', abs1 === 'https://example.com/images/logo.png', 'Risoluzione URL relativo a root');

  const abs2 = resolveAbsoluteUrl('sub/page.html', 'https://example.com/docs/');
  check('BROWSE.2', abs2 === 'https://example.com/docs/sub/page.html', 'Risoluzione URL relativo a directory');

  // 2. Estrazione Media (Immagini & Video per Vision)
  const sampleHtml = `
    <html>
      <body>
        <nav><a href="/home">Home</a></nav>
        <div class="cookie-consent">Accetta i cookie</div>
        <article>
          <h1>Articolo Principale</h1>
          <p>Testo con immagine <img src="/assets/diagram.png" alt="Architettura" /></p>
          <img src="data:image/svg+xml;base64,123" alt="1x1 spacer" />
          <iframe src="https://www.youtube.com/embed/xyz123" title="Tutorial Video"></iframe>
          <video src="/videos/demo.mp4"><source src="/videos/demo.mp4" type="video/mp4"></video>
        </article>
        <footer>Copyright 2026</footer>
      </body>
    </html>
  `;

  const media = extractMedia(sampleHtml, 'https://example.com');
  check('BROWSE.3', media.images.length === 1 && media.images[0].url === 'https://example.com/assets/diagram.png' && media.images[0].alt === 'Architettura', 'Estrazione immagine con URL assoluto ed esclusione spacer data-uri');
  check('BROWSE.4', media.videos.some((v) => v.url.includes('youtube.com/embed/xyz123')), 'Estrazione video iframe');

  // 3. Reader View: pulizia nav, footer, script, banner
  const cleaned = cleanHtmlForReader(sampleHtml);
  check('BROWSE.5', !cleaned.includes('Home') && !cleaned.includes('Copyright 2026') && !cleaned.includes('cookie-consent'), 'Reader View scarta nav, footer e cookie consent');

  // 4. Conversione Tabelle GFM
  const tableHtml = `
    <table>
      <thead>
        <tr><th>Modello</th><th>Tier</th><th>Tok/s</th></tr>
      </thead>
      <tbody>
        <tr><td>Qwen 2.5 7B</td><td>Small</td><td>45.2</td></tr>
        <tr><td>Llama 3.3 70B</td><td>Large</td><td>18.7</td></tr>
      </tbody>
    </table>
  `;
  const tableMd = htmlToMarkdown(tableHtml, 'https://example.com');
  check('BROWSE.6', tableMd.includes('Modello') && tableMd.includes('Qwen 2.5 7B') && tableMd.includes('---') && tableMd.includes('|'), 'Tabelle HTML convertite in tabelle Markdown GFM strutturate');

  // 5. Conversione Code Block e Link Relativi
  const codeAndLinkHtml = `
    <div>
      <p>Consulta la <a href="/docs/guide">Guida Completa</a> per maggiori dettagli.</p>
      <pre><code>function hello() {\n  return "world";\n}</code></pre>
    </div>
  `;
  const codeMd = htmlToMarkdown(codeAndLinkHtml, 'https://example.com');
  check('BROWSE.7', codeMd.includes('[Guida Completa](https://example.com/docs/guide)'), 'Link relativi convertiti in link assoluti cliccabili');
  check('BROWSE.8', codeMd.includes('```') && codeMd.includes('function hello()'), 'Code block preservati con recinzioni markdown');

  // 6. Sezione Media Integrata nel Markdown
  const fullMd = htmlToMarkdown(sampleHtml, 'https://example.com');
  check('BROWSE.9', (fullMd.includes('### 📎 Media & Risorse della Pagina') || fullMd.includes('### 📎 Page Media & Resources') || fullMd.includes('### 📎 Media & Page Resources')) && fullMd.includes('![Architettura](https://example.com/assets/diagram.png)'), 'Sezione Media allegata in calce per agenti multimodali/Vision');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
