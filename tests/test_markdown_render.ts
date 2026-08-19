/**
 * Test per il renderer markdown del terminale (src/cli/markdown.ts):
 * decodifica delle entità HTML (bug "po&#39;") e conversione hljs → ANSI.
 * Esecuzione: npx tsx tests/test_markdown_render.ts
 */
import chalk from 'chalk';
import { renderMarkdownToLines } from '../src/cli/markdown';

// Senza TTY chalk disabilita i colori: forzali per poter verificare l'ANSI (MD4)
if (chalk.level === 0) chalk.level = 1;

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

/** Renderizza e restituisce il testo piano (senza codici ANSI). */
function renderPlain(md: string): string {
  return renderMarkdownToLines(md, 90)
    .join('\n')
    .replace(/\x1b\[[0-9;]*m/g, '');
}

function main() {
  console.log('=== Test renderer markdown ===\n');

  // MD1: apostrofi e caratteri speciali nei paragrafi (bug "po&#39;")
  let out = renderPlain("Un po' di testo con l'apostrofo, \"virgolette\" & simboli.");
  check('MD1', out.includes("po' di testo") && out.includes("l'apostrofo"), `apostrofi decodificati: ${JSON.stringify(out.trim())}`);

  // MD2: nessuna entità HTML residua in paragrafi, elenchi e citazioni
  out = renderPlain("- elenco con po' e un'altra & ancora\n\n> citazione con l'apostrofo\n\n# Titolo con l'apostrofo");
  const residue = /&#\d+;|&#x[0-9a-f]+;|&amp;|&quot;|&lt;|&gt;|&apos;/i.test(out);
  check('MD2', !residue && out.includes('&') && out.includes("un'altra"), residue ? `entità residue in: ${JSON.stringify(out)}` : 'nessuna entità residua');

  // MD3: blocco codice senza tag <span> di hljs e con entità decodificate
  out = renderPlain("```js\nconst s = 'ciao';\nif (s.length < 9 && s !== \"no\") { console.log(s); }\n```");
  const hasSpans = /<span|<\/span>/.test(out);
  check('MD3a', !hasSpans, hasSpans ? `tag span residui: ${JSON.stringify(out)}` : 'nessun tag span nel codice');
  check('MD3b', out.includes('< 9 &&') && out.includes("'ciao'"), `operatori e apici decodificati nel codice`);

  // MD4: il codice evidenziato contiene colori ANSI (highlighting attivo)
  const colored = renderMarkdownToLines("```js\nconst x = 1;\n```", 90).join('\n');
  check('MD4', /\x1b\[\d+m/.test(colored), 'output del codice colorato con ANSI');

  // MD5: code fence senza linguaggio non crasha (bug lang.length su undefined)
  try {
    out = renderPlain('```\ntesto senza linguaggio\n```');
    check('MD5', out.includes('testo senza linguaggio'), 'fence senza linguaggio renderizzato');
  } catch (e: any) {
    check('MD5', false, `crash su fence senza linguaggio: ${e.message}`);
  }

  // T14.16: la formattazione inline (bold/italic/inline code/link) non era resa affatto —
  // htmlToText scartava ogni tag invece di convertirlo in stile ANSI, e i link perdevano l'URL.
  const inlineColored = renderMarkdownToLines('This is **bold**, *italic*, and `code`, plus a [link](https://example.com).', 90).join('\n');
  check('MD6a', /\x1b\[1m/.test(inlineColored), 'grassetto reso con ANSI bold');
  check('MD6b', /\x1b\[3m/.test(inlineColored), 'corsivo reso con ANSI italic');
  out = renderPlain('This is **bold**, *italic*, and `code`, plus a [link](https://example.com).');
  check('MD6c', out.includes('bold') && out.includes('italic') && out.includes('`code`'), `testo inline preservato: ${JSON.stringify(out.trim())}`);
  check('MD6d', out.includes('https://example.com'), `l'URL del link non deve andare perso: ${JSON.stringify(out.trim())}`);

  // T14.16: le tabelle non avevano un case dedicato — cadevano nel default, che stampava
  // ogni cella su una riga separata invece di allinearle in colonne.
  out = renderPlain('| Name | Score |\n| --- | ---: |\n| Alice | 90 |\n| Bob | 85 |');
  const tableLines = out.split('\n').filter((l) => l.trim());
  check('MD7a', tableLines.some((l) => l.includes('Name') && l.includes('Score')), `intestazione su una riga: ${JSON.stringify(tableLines)}`);
  check('MD7b', tableLines.some((l) => /Alice.*90/.test(l)), `riga dati su una riga sola: ${JSON.stringify(tableLines)}`);
  check('MD7c', tableLines.some((l) => /^─+┼─+$/.test(l.trim())), 'riga separatrice header/corpo presente');

  // T14.16: le liste ordinate perdevano la numerazione, sempre renderizzate con "•".
  out = renderPlain('5. Fifth\n6. Sixth');
  check('MD8', out.includes('5. Fifth') && out.includes('6. Sixth'), `numerazione (anche non da 1) preservata: ${JSON.stringify(out.trim())}`);

  // T14.16: le checklist (- [ ] / - [x]) perdevano del tutto il checkbox.
  out = renderPlain('- [ ] todo\n- [x] done');
  check('MD9', out.includes('☐ todo') && out.includes('☑ done'), `checkbox resi: ${JSON.stringify(out.trim())}`);

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
