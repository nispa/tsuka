/**
 * Test unitari per il motore di benchmark a file (benchmarks/*.json):
 * loader, hash del set, DSL dei check, esecuzione multi-step con catena tool.
 * Esecuzione: npx tsx tests/test_benchmark_dsl.ts
 */
import {
  loadBenchmarkTests, getBenchmarkTestsHash, checkPasses, deepGet, runBenchTest, BenchTest
} from '../src/core/benchmarkTests';

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

async function main() {
  console.log('=== Test motore benchmark a file ===\n');

  // --- Loader: enumera i test del set reale e copre le 3 categorie ---
  const tests = loadBenchmarkTests();
  check('BD.1a', tests.length >= 5, `benchmarks/ contiene ${tests.length} test (≥5)`);
  for (const cat of ['instruction', 'json', 'toolCalling'] as const) {
    check(`BD.1b-${cat}`, tests.some((t) => t.category === cat), `categoria '${cat}' coperta dal set`);
  }
  const hash = getBenchmarkTestsHash();
  check('BD.1c', /^[0-9a-f]{8}$/.test(hash), `hash del set valido (${hash})`);

  // --- DSL dei check testuali ---
  check('BD.2a', checkPasses({ type: 'word_count', value: 8 }, 'Il gatto salta sopra il vecchio muro blu'), 'word_count esatto');
  check('BD.2b', !checkPasses({ type: 'word_count', value: 8 }, 'Il gatto salta sul muro blu'), 'word_count sbagliato → falso');
  check('BD.2c', checkPasses({ type: 'last_word', value: 'blu' }, 'Il muro è blu.'), 'last_word ignora la punteggiatura finale');
  check('BD.2d', checkPasses({ type: 'line_count', value: 3 }, 'verde\n\nblu\ngiallo\n'), 'line_count ignora le righe vuote');
  check('BD.2e', !checkPasses({ type: 'not_contains', value: 'rosso' }, 'Rosso di sera'), 'not_contains è case-insensitive');

  // --- DSL dei check JSON ---
  const jsonText = 'ecco: {"economici":[{"nome":"matita","prezzo":1}],"spesa_totale":56}';
  check('BD.3a', checkPasses({ type: 'json_valid' }, jsonText), 'json_valid estrae il blocco {...} dal testo');
  check('BD.3b', checkPasses({ type: 'json_path_equals', path: 'economici[0].nome', value: 'matita' }, jsonText), 'json_path_equals con indice array');
  check('BD.3c', checkPasses({ type: 'json_path_equals', path: 'spesa_totale', value: 56 }, jsonText), 'json_path_equals numerico');
  check('BD.3d', !checkPasses({ type: 'json_path_equals', path: 'spesa_totale', value: 55 }, jsonText), 'valore numerico sbagliato → falso');
  check('BD.3e', deepGet({ a: { b: [10, 20] } }, 'a.b[1]') === 20, 'deepGet naviga oggetti e array');

  // --- DSL dei check tool ---
  const tc = [{ id: 'x', type: 'function', function: { name: 'get_orders', arguments: '{"user_id":"USR-7431"}' } }];
  check('BD.4a', checkPasses({ type: 'tool_called', value: 'get_orders' }, '', tc), 'tool_called sul nome');
  check('BD.4b', checkPasses({ type: 'tool_arg_equals', arg: 'user_id', value: 'USR-7431' }, '', tc), 'tool_arg_equals');
  check('BD.4c', !checkPasses({ type: 'tool_arg_equals', arg: 'user_id', value: 'USR-2209' }, '', tc), 'id distrattore → falso');
  check('BD.4d', checkPasses({ type: 'tool_not_called' }, 'testo', undefined), 'tool_not_called senza chiamate');

  // --- Esecuzione multi-step con provider finto: catena completa ---
  const chainTest: BenchTest = {
    name: 'catena_finta',
    category: 'toolCalling',
    tools: [{ type: 'function', function: { name: 'find_user', parameters: {} } }],
    steps: [
      {
        prompt: 'trova maria',
        checks: [{ type: 'tool_called', value: 'find_user', weight: 2 }]
      },
      {
        toolResult: '{"user_id":"USR-7431"}',
        checks: [
          { type: 'tool_called', value: 'get_orders', weight: 2 },
          { type: 'tool_arg_equals', arg: 'user_id', value: 'USR-7431', weight: 3 }
        ]
      }
    ]
  };

  let calls = 0;
  const goodProvider: any = {
    chatWithTools: async (messages: any[]) => {
      calls++;
      if (calls === 1) {
        return { content: '', toolCalls: [{ id: '1', type: 'function', function: { name: 'find_user', arguments: '{"name":"Maria Rossi"}' } }], stats: { tokensPerSecond: 9.9, durationMs: 1, tokenCount: 1 } };
      }
      // Verifica che il toolResult del passo precedente sia arrivato nei messaggi
      const gotToolMsg = messages.some((m) => m.role === 'tool' && String(m.content).includes('USR-7431'));
      return { content: '', toolCalls: gotToolMsg ? [{ id: '2', type: 'function', function: { name: 'get_orders', arguments: '{"user_id":"USR-7431"}' } }] : [] };
    }
  };
  const good = await runBenchTest(goodProvider, chainTest);
  check('BD.5a', good.score === 1, `catena perfetta → punteggio 1 (ottenuto ${good.score})`);
  check('BD.5b', good.tokensPerSecond === 9.9, 'tok/s presi dal primo passo');

  // Provider che sceglie l'id distrattore: perde solo il check dell'argomento (3/7)
  calls = 0;
  const distractedProvider: any = {
    chatWithTools: async () => {
      calls++;
      if (calls === 1) {
        return { content: '', toolCalls: [{ id: '1', type: 'function', function: { name: 'find_user', arguments: '{"name":"Maria Rossi"}' } }] };
      }
      return { content: '', toolCalls: [{ id: '2', type: 'function', function: { name: 'get_orders', arguments: '{"user_id":"USR-2209"}' } }] };
    }
  };
  const distracted = await runBenchTest(distractedProvider, chainTest);
  check('BD.5c', Math.abs(distracted.score - 4 / 7) < 0.001, `id distrattore → 4/7 (ottenuto ${distracted.score.toFixed(3)})`);

  // Provider che non chiama alcun tool: catena rotta, i check successivi valgono 0
  const noToolProvider: any = {
    chatWithTools: async () => ({ content: 'non uso tool' })
  };
  const broken = await runBenchTest(noToolProvider, chainTest);
  check('BD.5d', broken.score === 0, 'nessuna tool call → catena rotta, punteggio 0');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
