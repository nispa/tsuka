/**
 * Test per T9.8 — Retry su JSON malformato in una tool call (`src/core/provider.ts`).
 *
 * Contesto: osservato in produzione con un modello locale via llama-server, su un
 * argomento stringa lungo passato a `spawn_agent`: il server rifiuta la richiesta
 * con un 500 ("Failed to parse tool call arguments as JSON: ... invalid string:
 * missing closing quote"). Prima di questo task quell'errore cadeva nel ramo
 * generico "Errore di comunicazione", senza retry: un glitch di campionamento
 * tipicamente non riproducibile bruciava l'intero turno del membro/orchestrator.
 *
 * Copre:
 *  - GM.1: un 500 con messaggio che nomina "tool call" + "json"/"parse" viene
 *    ritentato (stesso conteggio tentativi di "mancata risposta", MAX_RETRIES=3),
 *    e se un tentativo successivo va a buon fine la chiamata ritorna normalmente;
 *  - GM.2: se fallisce per tutti i tentativi, l'errore finale è distinguibile
 *    ("[JSON malformato]"), non il messaggio generico "Errore di comunicazione";
 *  - GM.3: un errore di comunicazione GENERICO (non menziona tool call/json) non
 *    viene ritentato — fallisce subito, comportamento invariato rispetto a prima.
 *
 * Nessuna chiamata di rete reale: si intercetta `client.chat.completions.create`
 * dell'SDK OpenAI (stesso pattern di test_generation_timeout.ts).
 *
 * Esecuzione isolata: node --import tsx tests/test_malformed_toolcall_retry.ts
 */
import { LLMProvider } from '../src/core/provider';

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

const MALFORMED_TOOLCALL_MESSAGE =
  '500 llama-server error: {"error":{"code":500,"message":"Failed to parse tool call arguments as JSON: ' +
  '[json.exception.parse_error.101] parse error at line 1, column 920: syntax error while parsing value - ' +
  'invalid string: missing closing quote"}}';

async function main() {
  console.log('=== Test retry su JSON malformato in una tool call (T9.8) ===\n');

  // ============================================================
  // GM.1 — primo tentativo rifiutato (JSON malformato), secondo va a buon fine
  // ============================================================
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    let callCount = 0;
    (provider as any).client.chat.completions.create = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error(MALFORMED_TOOLCALL_MESSAGE);
      }
      return {
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{ delta: { content: 'ok' } }],
            usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 }
          };
        }
      };
    };

    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'ciao' }],
      undefined,
      () => {},
      undefined,
      undefined
    );

    check('GM.1a', callCount === 2, `un JSON malformato al primo tentativo viene ritentato (chiamate effettuate: ${callCount})`);
    check('GM.1b', res.content === 'ok', `il retry riuscito ritorna la risposta normalmente (ricevuto: "${res.content}")`);
  }

  // ============================================================
  // GM.2 — fallisce per tutti i tentativi: errore distinguibile, non il generico
  // ============================================================
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    let callCount = 0;
    (provider as any).client.chat.completions.create = async () => {
      callCount++;
      throw new Error(MALFORMED_TOOLCALL_MESSAGE);
    };

    let errMsg = '';
    try {
      await provider.chatWithTools([{ role: 'user', content: 'ciao' }], undefined, () => {}, undefined, undefined);
    } catch (e: any) {
      errMsg = e.message;
    }

    check('GM.2a', /(\[JSON malformato\]|\[Malformed JSON\])/.test(errMsg), `l'errore finale è distinguibile da "Errore di comunicazione" generico (${errMsg})`);
    check('GM.2b', callCount === 3, `esaurisce tutti i tentativi previsti (MAX_RETRIES) prima di arrendersi (chiamate: ${callCount})`);
  }

  // ============================================================
  // GM.3 — errore di comunicazione generico: nessun retry, comportamento invariato
  // ============================================================
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    let callCount = 0;
    (provider as any).client.chat.completions.create = async () => {
      callCount++;
      throw new Error('connect ECONNREFUSED 127.0.0.1:8888');
    };

    let errMsg = '';
    try {
      await provider.chatWithTools([{ role: 'user', content: 'ciao' }], undefined, () => {}, undefined, undefined);
    } catch (e: any) {
      errMsg = e.message;
    }

    check('GM.3a', callCount === 1, `un errore di comunicazione generico NON viene ritentato (chiamate: ${callCount})`);
    check('GM.3b', /(Errore di comunicazione|Communication error)/i.test(errMsg) && !/(\[JSON malformato\]|\[Malformed JSON\])/.test(errMsg), `il messaggio resta quello generico invariato (${errMsg})`);
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
