/**
 * Test per ThinkTagParser e stripThinkBlocks (src/core/thinkParser.ts).
 * Esecuzione: npx tsx tests/test_think_parser.ts
 */
import { ThinkTagParser, stripThinkBlocks, StreamChannel } from '../src/core/thinkParser';

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

/** Alimenta il parser con i chunk dati e raccoglie i due canali. */
function run(chunks: string[]): { content: string; reasoning: string } {
  let content = '';
  let reasoning = '';
  const parser = new ThinkTagParser((text: string, channel: StreamChannel) => {
    if (channel === 'content') content += text;
    else reasoning += text;
  });
  for (const c of chunks) parser.push(c);
  parser.flush();
  return { content, reasoning };
}

/** Spezza una stringa in chunk di dimensione fissa. */
function split(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function main() {
  console.log('=== Test ThinkTagParser ===\n');

  // TP1: stream senza tag → tutto content, nessun reasoning
  let r = run(['Ciao, come ', 'posso aiutarti?']);
  check('TP1', r.content === 'Ciao, come posso aiutarti?' && r.reasoning === '', 'stream senza tag passa inalterato');

  // TP2: blocco think intero in un chunk
  r = run(['<think>ragiono</think>Risposta finale']);
  check('TP2', r.content === 'Risposta finale' && r.reasoning === 'ragiono', 'blocco think in un solo chunk separato');

  // TP3: tag spezzati a chunk di 1 carattere (caso limite definitivo)
  r = run(split('<think>il mio piano</think>\n\nEcco la risposta', 1));
  check('TP3', r.content === 'Ecco la risposta' && r.reasoning === 'il mio piano', `chunk da 1 char: content=${JSON.stringify(r.content)}`);

  // TP4: whitespace dopo </think> rimosso dal primo content
  r = run(['<think>x</think>', '\n\n  Risposta']);
  check('TP4', r.content === 'Risposta', 'whitespace dopo </think> rimosso');

  // TP5: <think> mai chiuso → tutto reasoning, content vuoto
  r = run(['<think>sto ancora pensando e non chiudo il tag']);
  check('TP5', r.content === '' && r.reasoning === 'sto ancora pensando e non chiudo il tag', 'think non chiuso resta reasoning');

  // TP6: '<' letterale non seguito da tag viene emesso (flush del residuo)
  r = run(['a < b e anche a <t']);
  check('TP6', r.content === 'a < b e anche a <t', `'<' letterale preservato: ${JSON.stringify(r.content)}`);

  // TP7: tag spezzato esattamente al confine tra due chunk
  r = run(['prima <thi', 'nk>segreto</thi', 'nk>dopo']);
  check('TP7', r.content === 'prima dopo' && r.reasoning === 'segreto', 'tag spezzati al confine dei chunk');

  // TP8: più blocchi think nello stesso stream
  r = run(['<think>a</think>uno <think>b</think>due']);
  check('TP8', r.content === 'uno due' && r.reasoning === 'ab', 'blocchi think multipli');

  console.log('\n=== Test stripThinkBlocks ===\n');

  check('TS1', stripThinkBlocks('<think>x</think>Risposta') === 'Risposta', 'blocco chiuso rimosso');
  check('TS2', stripThinkBlocks('Risposta senza tag') === 'Risposta senza tag', 'testo senza tag inalterato');
  check('TS3', stripThinkBlocks('<think>mai chiuso...') === '', 'think aperto e mai chiuso scartato');
  check('TS4', stripThinkBlocks('perso il tag di apertura</think>Risposta') === 'Risposta', '</think> orfano gestito');
  check('TS5', stripThinkBlocks('<think>a</think>uno<think>b</think> due') === 'uno due', 'blocchi multipli rimossi');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
