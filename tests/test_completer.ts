/**
 * Test unitari per l'autocompletamento Tab dei comandi slash.
 * Esecuzione: npx tsx tests/test_completer.ts
 */
import { setCompletionSource, completeLine } from '../src/cli/input';

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

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main() {
  console.log('=== Test autocompletamento comandi ===\n');

  // Prima della registrazione della sorgente: nessun completamento
  const [preHits] = completeLine('/c');
  check('AC.0', preHits.length === 0, 'senza sorgente registrata non completa nulla');

  setCompletionSource({
    commands: ['/agent', '/benchmark', '/call', '/clear', '/exit', '/help', '/memory', '/models', '/provider', '/runs', '/tools'],
    argumentsFor: (cmd) => {
      if (cmd === '/models') return ['llama3:8b', 'qwen2:7b', 'HauhauCS/Qwen3.5-9B'];
      if (cmd === '/provider') return ['ollama', 'openrouter', 'unsloth'];
      if (cmd === '/memory') return ['clear'];
      return [];
    },
  });

  // Completamento nome comando
  let [hits, sub] = completeLine('/c');
  check('AC.1a', sameArray(hits, ['/call', '/clear']) && sub === '/c',
    'prefisso /c → due candidati, sostituzione dell\'intera riga');
  [hits, sub] = completeLine('/mo');
  check('AC.1b', sameArray(hits, ['/models']) && sub === '/mo', 'prefisso univoco /mo → /models');
  [hits] = completeLine('/xyz');
  check('AC.1c', hits.length === 0, 'comando inesistente → nessun candidato');

  // Completamento argomenti
  [hits, sub] = completeLine('/models ');
  check('AC.2a', hits.length === 3 && sub === '', '/models con argomento vuoto → tutti i modelli');
  [hits, sub] = completeLine('/models qw');
  check('AC.2b', sameArray(hits, ['qwen2:7b']) && sub === 'qw', '/models qw → filtro sul prefisso, sostituzione della sola parola');
  [hits] = completeLine('/models hau');
  check('AC.2c', sameArray(hits, ['HauhauCS/Qwen3.5-9B']), 'match case-insensitive sull\'argomento');
  [hits] = completeLine('/provider un');
  check('AC.2d', sameArray(hits, ['unsloth']), '/provider un → unsloth');
  [hits] = completeLine('/memory c');
  check('AC.2e', sameArray(hits, ['clear']), '/memory c → clear');
  [hits] = completeLine('/help x');
  check('AC.2f', hits.length === 0, 'comando senza argumentsFor → nessun candidato');

  // Testo normale (non slash): mai completato
  [hits, sub] = completeLine('ciao come va');
  check('AC.3', hits.length === 0 && sub === 'ciao come va', 'testo libero → nessun completamento');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
