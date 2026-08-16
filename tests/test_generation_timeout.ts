/**
 * Test per T8.11 — Timeout a orologio sull'intera generazione (TASKS.md — FASE 3).
 *
 * Copre l'Accettazione del task:
 *  - una generazione che supera MAX_GENERATION_MS viene interrotta con un errore
 *    che la distingue dal timeout sul primo token (niente "[Mancata risposta]",
 *    e niente retry silenzioso che triplicherebbe l'attesa);
 *  - un modello che risponde normalmente (entro soglia) non è mai toccato dal
 *    nuovo timer;
 *  - entrambi i timer (primo token + generazione) vengono sempre ripuliti, anche
 *    in caso di errore — verificato con process.getActiveResourcesInfo(), non
 *    per inferenza;
 *  - max_tokens viaggia nel payload reale dell'SDK come soffitto generoso, sia
 *    sul percorso streaming sia su quello non-streaming.
 *
 * Determinismo: MAX_GENERATION_MS non è configurabile (di proposito, vedi
 * TASKS.md/AGENTS.md — non va in tsuka.config.json), ma è reso iniettabile SOLO
 * per i test via __setMaxGenerationMsForTest (src/core/provider.ts). Nessuna
 * attesa reale di 5 minuti: le soglie usate qui sono nell'ordine dei 100-300ms.
 * Nessuna chiamata di rete reale: si intercetta `client.chat.completions.create`
 * dell'SDK OpenAI (stesso pattern di tests/test_reasoning_effort.ts, sezione
 * "LLMProvider reale"), quindi non serve TSUKA_MEMORY_FILE (nessuna MemoryStore
 * coinvolta in questo file).
 *
 * Esecuzione isolata: node --import tsx tests/test_generation_timeout.ts
 */
import { LLMProvider, __setMaxGenerationMsForTest, setLlmTimeoutMs } from '../src/core/provider';
import { ConfigManager } from '../src/core/config';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Numero di handle 'Timeout' correntemente pendenti nel processo (Node ≥17.3). */
function pendingTimeouts(): number {
  return process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
}

/** Si risolve solo quando il signal viene abortito: mai da sola (nessun timer interno). */
function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('AbortError: già abortito'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('AbortError: richiesta interrotta')), { once: true });
  });
}

async function main() {
  console.log('=== Test timeout a orologio sull\'intera generazione (T8.11) ===\n');

  // ============================================================
  // GT.1 — risposta normale entro soglia: mai toccata, max_tokens nel payload,
  // nessun timer residuo dopo il completamento.
  // ============================================================
  {
    __setMaxGenerationMsForTest(300);
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    const capturedParams: any[] = [];
    (provider as any).client.chat.completions.create = async (params: any) => {
      capturedParams.push(params);
      return {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'ciao' } }] };
          await sleep(10);
          yield {
            choices: [{ delta: { content: ' mondo' } }],
            usage: { completion_tokens: 2, prompt_tokens: 1, total_tokens: 3 }
          };
        }
      };
    };

    const before = pendingTimeouts();
    const chunks: string[] = [];
    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'ciao' }],
      undefined,
      (chunk) => { chunks.push(chunk); },
      undefined,
      undefined
    );

    check('GT.1a', res.content === 'ciao mondo', `il contenuto arriva intero, generazione veloce non toccata dal timer (ricevuto: "${res.content}")`);
    check('GT.1b', capturedParams[0]?.max_tokens === 8192, `max_tokens presente nel payload streaming come soffitto generoso (ricevuto: ${capturedParams[0]?.max_tokens})`);

    // Controllo IMMEDIATO (non dopo un'attesa): la risposta è arrivata in ~10ms,
    // ben prima della soglia ridotta (300ms) — se generationTimer non fosse stato
    // ripulito in `finally`, sarebbe ancora un handle pendente proprio adesso
    // (aspettare oltre la soglia non proverebbe nulla: scadrebbe comunque da solo).
    const after = pendingTimeouts();
    check('GT.1c', after <= before, `nessun handle Timeout residuo subito dopo una generazione normale completata rapidamente (prima: ${before}, dopo: ${after})`);
  }

  // ============================================================
  // GT.2 — supera MAX_GENERATION_MS: il modello STA generando (primo token già
  // arrivato), errore distinto da "[Mancata risposta]", nessun retry silenzioso,
  // timer ripuliti.
  // ============================================================
  {
    __setMaxGenerationMsForTest(150);
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    (provider as any).client.chat.completions.create = async (_params: any, opts: any) => {
      const signal: AbortSignal = opts?.signal;
      return {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'inizio' } }] };
          // Non emette più nulla: resta bloccato finché generationTimer non aborta.
          await waitForAbort(signal);
        }
      };
    };

    const before = pendingTimeouts();
    const start = Date.now();
    let threw = false;
    let errMsg = '';
    try {
      await provider.chatWithTools([{ role: 'user', content: 'ciao' }], undefined, () => {});
    } catch (e: any) {
      threw = true;
      errMsg = e.message || '';
    }
    const elapsed = Date.now() - start;

    check('GT.2a', threw, 'una generazione che supera MAX_GENERATION_MS viene interrotta con un errore');
    check('GT.2b', /(timeout generazione|generation timeout)/i.test(errMsg), `l'errore segnala esplicitamente il timeout sull'INTERA generazione (ricevuto: "${errMsg}")`);
    check('GT.2c', !/\[(Mancata risposta|No response)\]/i.test(errMsg), `l'errore NON riusa il prefisso "[Mancata risposta]" (diagnosticherebbe il problema sbagliato: qui il modello stava rispondendo, non taceva) (ricevuto: "${errMsg}")`);
    check('GT.2d', /(stava (rispondendo|producendo)|exceeded generation time limit)/i.test(errMsg), `l'errore dichiara che il modello stava generando, non tacendo (ricevuto: "${errMsg}")`);
    // Niente retry: se il generation-timeout venisse ritentato come il timeout sul
    // primo token, l'attesa totale salirebbe a ~3×150ms. Deve restare vicina a 150ms.
    check('GT.2e', elapsed < 150 * 2, `interrotto subito, senza retry silenziosi che moltiplichino l'attesa (soglia 150ms, trascorsi: ${elapsed}ms)`);

    const after = pendingTimeouts();
    check('GT.2f', after <= before, `nessun handle Timeout residuo subito dopo l'errore di timeout generazione (prima: ${before}, dopo: ${after})`);
  }

  // ============================================================
  // GT.3 — max_tokens generoso anche sul percorso non-streaming.
  // ============================================================
  {
    __setMaxGenerationMsForTest(300);
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    const capturedParams: any[] = [];
    (provider as any).client.chat.completions.create = async (params: any) => {
      capturedParams.push(params);
      return {
        choices: [{ message: { content: 'ok', tool_calls: undefined } }],
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 }
      };
    };

    await provider.chatWithTools([{ role: 'user', content: 'ciao' }]); // nessun onChunk => non-streaming
    check('GT.3a', capturedParams[0]?.max_tokens === 8192, `max_tokens presente anche sul percorso non-streaming (ricevuto: ${capturedParams[0]?.max_tokens})`);
    check('GT.3b', capturedParams[0]?.max_tokens >= 4096, 'soffitto generoso (pensiero + risposta), non un valore stretto da tarare');
  }

  // ============================================================
  // GT.4 — abort esterno dell'utente (Esc) PRIMA che un timeout possa scattare
  // da solo: il controllo più severo sulla pulizia, perché sia firstTokenTimer
  // (120s) sia generationTimer (soglia ridotta, ma qui impostata larga apposta)
  // sono ancora lontanissimi dallo scadere quando arriva l'abort — se `finally`
  // non li ripulisse, resterebbero handle pendenti misurabili SUBITO.
  // ============================================================
  {
    __setMaxGenerationMsForTest(5000); // irrilevante qui: si prova la pulizia sull'abort utente, non un timeout
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    const userAbort = new AbortController();
    (provider as any).client.chat.completions.create = async (_params: any, opts: any) => {
      const signal: AbortSignal = opts?.signal;
      return {
        [Symbol.asyncIterator]: async function* () {
          // Non emette mai nulla: si blocca finché non arriva l'abort (utente o timer).
          await waitForAbort(signal);
        }
      };
    };

    const before = pendingTimeouts();
    const pending = provider.chatWithTools([{ role: 'user', content: 'ciao' }], undefined, () => {}, userAbort.signal);
    await sleep(20);
    userAbort.abort();

    let threw = false;
    try {
      await pending;
    } catch {
      threw = true;
    }
    const after = pendingTimeouts();

    check('GT.4a', threw, "l'abort esterno dell'utente interrompe comunque la generazione");
    check('GT.4b', after <= before, `entrambi i timer sono ripuliti anche sull'abort dell'utente, ben prima che potessero scattare da soli (prima: ${before}, dopo: ${after})`);
  }

  // ============================================================
  // GT.5 — T8.16: Configurazione llmTimeoutMs tramite ConfigManager e setLlmTimeoutMs
  // ============================================================
  {
    const configManager = new ConfigManager();
    const timeoutDefault = configManager.getLlmTimeoutMs();
    check('GT.5a', typeof timeoutDefault === 'number' && timeoutDefault >= 1000, `getLlmTimeoutMs() ritorna un valore numerico in ms valido (valore: ${timeoutDefault}ms)`);

    setLlmTimeoutMs(150);
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    (provider as any).client.chat.completions.create = async (_params: any, opts: any) => {
      const signal: AbortSignal = opts?.signal;
      return {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'inizio' } }] };
          await waitForAbort(signal);
        }
      };
    };

    let threw = false;
    let errMsg = '';
    try {
      await provider.chatWithTools([{ role: 'user', content: 'ciao' }], undefined, () => {});
    } catch (e: any) {
      threw = true;
      errMsg = e.message || '';
    }

    check('GT.5b', threw && /(timeout generazione|generation timeout)/i.test(errMsg), `setLlmTimeoutMs(150) configura correttamente il timeout della generazione (errore: "${errMsg}")`);
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
