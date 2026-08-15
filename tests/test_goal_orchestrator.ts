/**
 * Test deterministici per /goal (T1.2, PLANNING-QUALITA.md).
 * handleGoal(ctx, goal) non è interattivo (a differenza di handleTeam, che chiede
 * il compito via prompts()): può essere chiamato direttamente nei test con un
 * MockLLMProvider iniettato tramite CommandCtx.
 *
 * ctx.listAvailableCharacters() legge i personaggi REALI del progetto
 * (characters/*.json, 18 file): non serve fingerli, sono asset statici. Per questo
 * gli step del piano scriptato usano nomi di personaggi reali (falco, piccione).
 *
 * Esecuzione: npx tsx tests/test_goal_orchestrator.ts
 */
import { handleGoal } from '../src/cli/commands/goal';
import { ContextTracker } from '../src/core/contextTracker';
import { MockLLMProvider } from './mocks/mockProvider';
import { buildMockCtx } from './mocks/mockCtx';

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
  console.log('=== Test /goal Orchestrator (con MockLLMProvider) ===\n');

  // T1: felice — piano sequenziale con un solo agente, eseguito e con stats raccolte
  {
    ContextTracker.getInstance().clear();
    const provider = new MockLLMProvider([
      { content: 'AGENTE: @falco — Controlla il sistema\nFINE' },   // piano dell'orchestrator
      { content: 'Controllo completato.\nSTATO: COMPLETATO' }        // turno di falco
    ]);
    const ctx = buildMockCtx(provider);

    await handleGoal(ctx, 'Fai un controllo di sicurezza di base');

    check('G1a', provider.remaining === 0, 'piano eseguito: entrambe le chiamate scriptate (piano + turno di falco) sono state consumate');

    const entries = ContextTracker.getInstance().getAll();
    check(
      'G1b',
      entries.some((e) => e.agentName === 'Falco'),
      'stats raccolte: ContextTracker registra il turno di Falco (tokenCount/promptTokens)'
    );

    const finalMsgs = ctx.agent.current.getMessages();
    const lastAssistant = finalMsgs[finalMsgs.length - 1];
    check(
      'G1c',
      lastAssistant.role === 'assistant' && typeof lastAssistant.content === 'string' && /completato/i.test(lastAssistant.content),
      `riepilogo finale riflette il completamento (contenuto: "${lastAssistant.content}")`
    );
  }

  // T2: rottura/robustezza — blocco PARALLELO: entrambi gli step vengono eseguiti (non solo il primo)
  {
    ContextTracker.getInstance().clear();
    const provider = new MockLLMProvider([
      { content: 'PARALLELO:\nAGENTE: @falco — Task A\nAGENTE: @piccione — Task B\nFINE PARALLELO\nFINE' }, // piano
      { content: 'Task A fatto.\nSTATO: COMPLETATO' },  // turno parallelo di falco (script[0] del gruppo)
      { content: 'Task B fatto.\nSTATO: COMPLETATO' }   // turno parallelo di piccione (script[1] del gruppo)
    ]);
    // NOTA: l'ordine di consumo dello script nel blocco Promise.all è deterministico
    // SOLO perché MockLLMProvider.chatWithTools non ha alcun `await` interno: ogni
    // step sincrono di Promise.all(steps.map(async ...)) arriva al proprio punto di
    // sospensione (la vera chiamata al provider) nell'ordine dell'array, prima che il
    // prossimo step inizi. Con un provider che avesse un await reale prima di
    // rispondere, l'ordine non sarebbe garantito: qui si verifica "tutti gli step
    // eseguiti", non un ordine specifico.
    const ctx = buildMockCtx(provider);

    await handleGoal(ctx, 'Fai un audit in parallelo');

    check('G2a', provider.remaining === 0, 'tutti e 3 gli step scriptati (piano + 2 step paralleli) sono stati consumati');

    const entries = ContextTracker.getInstance().getAll();
    const hasF = entries.some((e) => e.agentName === 'Falco');
    const hasP = entries.some((e) => e.agentName === 'Piccione');
    check(
      'G2b',
      hasF && hasP,
      `entrambi gli step del blocco PARALLELO sono stati eseguiti, non solo il primo (Falco:${hasF}, Piccione:${hasP})`
    );
  }

  // T3: Rilavorazione guidata dall'Overseer — l'overseer riscontra problemi al primo giro e innesca la rilavorazione
  {
    ContextTracker.getInstance().clear();
    const provider = new MockLLMProvider([
      { content: 'AGENTE: @dev — Implementa il modulo auth\nAGENTE: @overseer — Revisiona il codice\nFINE' }, // piano
      { content: 'Codice iniziale scritto.\nSTATO: DA_CONTINUARE' },                                              // turno 1: dev
      { content: 'Riscontrati problemi di sicurezza. REVISION: Mancano i test.\nSTATO: DA_CONTINUARE' },          // turno 1: overseer -> innesca rilavorazione!
      { content: 'Aggiunti i test richiesti.\nSTATO: COMPLETATO' },                                             // turno 2: dev (rilavorazione)
      { content: 'Tutto perfetto ora.\nSTATO: COMPLETATO' }                                                      // turno 2: overseer (post-rilavorazione)
    ]);
    const ctx = buildMockCtx(provider);

    await handleGoal(ctx, 'Crea modulo auth con revisione');

    check('G3a', provider.remaining === 0, 'tutti i 5 step scriptati (incluso il ciclo di rilavorazione e la ri-revisione Overseer) sono stati consumati');

    const finalMsgs = ctx.agent.current.getMessages();
    const lastAssistant = finalMsgs[finalMsgs.length - 1];
    check(
      'G3b',
      lastAssistant.role === 'assistant' && typeof lastAssistant.content === 'string' && /completato/i.test(lastAssistant.content),
      'il goal con rilavorazione si conclude con successo'
    );
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
