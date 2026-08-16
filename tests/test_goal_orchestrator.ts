/**
 * Test deterministici per /goal (T1.2, PLANNING-QUALITA.md).
 * handleGoal(ctx, goal) non è interattivo (a differenza di handleTeam, che chiede
 * il compito via prompts()): può essere chiamato direttamente nei test con un
 * MockLLMProvider iniettato tramite CommandCtx.
 *
 * ctx.listAvailableCharacters() legge i personaggi REALI del progetto
 * (characters/*.json): non serve fingerli, sono asset statici. Gli step del piano
 * scriptato risolvono però gli agenti per MESTIERE (fixtures/roster.ts), non per
 * nome proprio: il roster è dati dell'utente e può essere rinominato, i ruoli no.
 *
 * Esecuzione: npx tsx tests/test_goal_orchestrator.ts
 */
import { handleGoal, parsePlan, formatAgentSignature } from '../src/cli/commands/goal';
import { ContextTracker } from '../src/core/contextTracker';
import { MockLLMProvider } from './mocks/mockProvider';
import { buildMockCtx } from './mocks/mockCtx';
import { listAvailableCharacters } from '../src/cli/shared';
import { distinctAgents, aiNameOf } from './fixtures/roster';

// Agenti del piano scriptato, risolti per ruolo (mai per nome proprio).
const [WORKER, SECOND, DEV, LEAD] = distinctAgents('sysadmin', 'security_auditor', 'developer', 'supervisor');
const WORKER_AI = aiNameOf(WORKER);
const SECOND_AI = aiNameOf(SECOND);

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
      { content: `AGENTE: @${WORKER} — Controlla il sistema\nFINE` },   // piano dell'orchestrator
      { content: 'Controllo completato.\nSTATO: COMPLETATO' }        // turno di il primo agente
    ]);
    const ctx = buildMockCtx(provider);

    await handleGoal(ctx, 'Fai un controllo di sicurezza di base');

    check('G1a', provider.remaining === 0, 'piano eseguito: entrambe le chiamate scriptate (piano + turno di laan) sono state consumate');

    const entries = ContextTracker.getInstance().getAll();
    check(
      'G1b',
      entries.some((e) => e.agentName === WORKER_AI),
      `stats raccolte: ContextTracker registra il turno di ${WORKER_AI} (tokenCount/promptTokens)`
    );

    const finalMsgs = ctx.agent.current.getMessages();
    const lastAssistant = finalMsgs[finalMsgs.length - 1];
    check(
      'G1c',
      lastAssistant.role === 'assistant' && typeof lastAssistant.content === 'string' && (/completato/i.test(lastAssistant.content) || /completed/i.test(lastAssistant.content)),
      `riepilogo finale riflette il completamento (contenuto: "${lastAssistant.content}")`
    );

    check(
      'G1d',
      provider.callLog[0]?.options?.reasoningEffort === 'low' && provider.callLog[0]?.options?.creativity === 'precise',
      `chiamata orchestrator usa reasoningEffort: 'low' e creativity: 'precise'`
    );
  }

  // T2: rottura/robustezza — blocco PARALLELO: entrambi gli step vengono eseguiti (non solo il primo)
  {
    ContextTracker.getInstance().clear();
    const provider = new MockLLMProvider([
      { content: `PARALLELO:\nAGENTE: @${WORKER} — Task A\nAGENTE: @${SECOND} — Task B\nFINE PARALLELO\nFINE` }, // piano
      { content: 'Task A fatto.\nSTATO: COMPLETATO' },  // turno parallelo di il primo agente (script[0] del gruppo)
      { content: 'Task B fatto.\nSTATO: COMPLETATO' }   // turno parallelo di il secondo agente (script[1] del gruppo)
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
    const hasL = entries.some((e) => e.agentName === WORKER_AI);
    const hasT = entries.some((e) => e.agentName === SECOND_AI);
    check(
      'G2b',
      hasL && hasT,
      `entrambi gli step del blocco PARALLELO sono stati eseguiti, non solo il primo (${WORKER_AI}:${hasL}, ${SECOND_AI}:${hasT})`
    );
  }

  // T3: Rilavorazione guidata dal supervisore — riscontra problemi al primo giro e innesca la rilavorazione
  {
    ContextTracker.getInstance().clear();
    const provider = new MockLLMProvider([
      { content: `AGENTE: @${DEV} — Implementa il modulo auth\nAGENTE: @${LEAD} — Revisiona il codice\nFINE` }, // piano
      { content: 'Codice iniziale scritto.\nSTATO: DA_CONTINUARE' },                                              // turno 1: lo sviluppatore
      { content: 'Riscontrati problemi di sicurezza. REVISION: Mancano i test.\nSTATO: DA_CONTINUARE' },          // turno 1: il supervisore -> innesca rilavorazione!
      { content: 'Aggiunti i test richiesti.\nSTATO: COMPLETATO' },                                             // turno 2: lo sviluppatore (rilavorazione)
      { content: 'Tutto perfetto ora.\nSTATO: COMPLETATO' }                                                      // turno 2: il supervisore (post-rilavorazione)
    ]);
    const ctx = buildMockCtx(provider);

    await handleGoal(ctx, 'Crea modulo auth con revisione');

    check('G3a', provider.remaining === 0, 'tutti i 5 step scriptati (incluso il ciclo di rilavorazione e la ri-revisione supervisore) sono stati consumati');

    const finalMsgs = ctx.agent.current.getMessages();
    const lastAssistant = finalMsgs[finalMsgs.length - 1];
    check(
      'G3b',
      lastAssistant.role === 'assistant' && typeof lastAssistant.content === 'string' && (/completato/i.test(lastAssistant.content) || /completed/i.test(lastAssistant.content)),
      'il goal con rilavorazione si conclude con successo'
    );
  }

  // T4: Parsing flessibile — riconosce liste numerate, markdown bold e due punti
  {
    // Personaggi sintetici: qui si verifica il PARSER, non il catalogo installato.
    const mockChars: any[] = [
      { name: 'dev_agent', aiName: 'DevAgent', role: 'developer' },
      { name: 'lead_agent', aiName: 'LeadAgent', role: 'supervisor' }
    ];
    const planMarkdown = `
Ecco il piano per il progetto:
1. **AGENTE:** @dev_agent: Crea il gioco puzznic
2. AGENT: lead_agent -> Verifica il codice
FINE
`;
    const { groups, flatSteps } = parsePlan(planMarkdown, mockChars);
    check('G4a', flatSteps === 2, `parsing flessibile rileva 2 step nonostante il formato markdown e due punti (trovati: ${flatSteps})`);
    check('G4b', groups[0]?.steps[0]?.agentName === 'dev_agent', `step 1 riconosce dev_agent (trovato: ${groups[0]?.steps[0]?.agentName})`);
    check('G4c', groups[1]?.steps[0]?.agentName === 'lead_agent', `step 2 riconosce lead_agent (trovato: ${groups[1]?.steps[0]?.agentName})`);
  }

  // T5: Firme sintetiche compatte per catalogo orchestrator (T9.5)
  {
    // Singolo ruolo
    const sigDev = formatAgentSignature({
      name: 'dev',
      displayName: 'Dev',
      aiName: 'Dev',
      role: 'developer',
      trait: 'professional',
      description: 'Sviluppatore software'
    });
    check('G5a', sigDev.startsWith('- @dev (Dev): role=developer') && sigDev.includes('Tools: ['), `firma sintetizza ruolo e tool di dev`);

    // Multi-skill
    const sigMulti = formatAgentSignature({
      name: 'poly',
      displayName: 'Poly',
      aiName: 'Poly',
      roles: ['developer', 'security_auditor'],
      trait: 'professional',
      description: 'Dev e auditor'
    });
    check('G5b', sigMulti.includes('role=developer,security_auditor') && sigMulti.includes('audit_code'), `firma sintetizza ruoli multipli e unione dei tool`);

    // Signature override esplicito
    const sigExplicit = formatAgentSignature({
      name: 'custom',
      displayName: 'Custom',
      aiName: 'Custom',
      role: 'developer',
      trait: 'professional',
      description: 'Desc',
      signature: 'Specialista AI custom | Tools: [custom_tool]'
    });
    check('G5c', sigExplicit === '- @custom (Custom): Specialista AI custom | Tools: [custom_tool]', `firma rispetta il campo signature esplicito`);

    // Budget token complessivo sul catalogo reale di tutti i personaggi
    const allChars = listAvailableCharacters();
    const fullCatalog = allChars.map(formatAgentSignature).join('\n');
    const estimatedTokens = Math.ceil(fullCatalog.length / 3.5);
    const avgTokPerChar = Math.round(estimatedTokens / allChars.length);
    check('G5d', allChars.length >= 18 && avgTokPerChar <= 60 && estimatedTokens < 1600, `catalogo reale completo di ${allChars.length} agenti consuma ~${estimatedTokens} tok (~${avgTokPerChar} tok/agente, budget medio < 60)`);
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
