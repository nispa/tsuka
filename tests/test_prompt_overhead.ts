/**
 * Test dedicati a T8.9 — Ridurre il costo fisso del prompt (TASKS.md, FASE 3).
 * Copre l'Accettazione del task:
 *  1. Su un modello profilato con function calling nativo affidabile
 *     (hasNativeFunctionCalling, registry.ts, soglia scores.toolCalling>=0.9),
 *     `loadSystemPrompt` (shared.ts) NON scrive più la sezione "Available tools":
 *     i tool viaggiano solo nell'array `tools` della richiesta API, mai due volte.
 *  2. Il comportamento dei tool resta invariato: registry.listForLLM continua a
 *     restituire lo STESSO set di tool sia che il testo venga scritto sia che
 *     venga omesso — l'omissione riguarda solo il prompt testuale, non l'array
 *     `tools` inviato all'API né l'esecuzione dei tool lato Agent.
 *  3. La nota d'uso su save_memory/recall_memory (shared.ts) non è un elenco di
 *     tool: resta presente anche quando l'elenco testuale viene omesso (Fuori
 *     scope esplicito del task).
 *  4. Gli schemi dei tool entrano nella stima di contesto usata da pruneHistory
 *     e da compressHistory (agent.ts): a parità di cronologia e di budget, un
 *     Agent con tool "pesanti" registrati pota la history prima/di più di uno
 *     senza tool, e compressHistory scatta prima quando i soli messaggi non
 *     avrebbero superato la soglia ma messaggi+tool sì.
 *  5. calibrateCharsPerToken converge correttamente includendo i caratteri dei
 *     tool: la stima di contesto (estimateTotalContextTokens) si avvicina al
 *     promptTokens reale restituito dall'API, non lo sottostima sistematicamente.
 *  6. Nessun tool registrato → comportamento identico a prima (0 caratteri di
 *     overhead, nessuna regressione per gli Agent senza tool).
 *
 * Isolamento: models_profile.json viene letto/scritto (backup + restore in
 * finally), stesso schema di test_reasoning_effort.ts/test_effort_propagation.ts.
 * Esecuzione isolata: node --import tsx tests/test_prompt_overhead.ts
 * (imposta TSUKA_MEMORY_FILE a un file temporaneo prima di lanciarlo da solo,
 * per non toccare la memoria reale dell'utente — vedi run_tests.ts per il pattern:
 * compressHistory scrive un fatto '[Storia compressa]' in MemoryStore).
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../src/core/agent';
import { MockLLMProvider } from './mocks/mockProvider';
import { ToolRegistry, getModelTier, hasNativeFunctionCalling } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { getModelProfile, profileKey, BENCHMARK_VERSION, ModelProfile } from '../src/core/modelProfile';
import { getBenchmarkTestsHash } from '../src/core/benchmarkTests';
import { loadSystemPrompt, RoleConfig, TraitConfig } from '../src/cli/shared';

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

/** Fabbrica di un profilo finto v4 completo (stesso schema delle altre suite T8.x). */
function fakeProfile(model: string, effort: ModelProfile['reasoningEffort'], toolCalling: number, tier: ModelProfile['tier']): ModelProfile {
  return {
    model,
    provider: 'test',
    tier,
    scores: { instruction: 0.9, json: 0.9, toolCalling },
    tokensPerSecond: 30,
    testedAt: new Date().toISOString(),
    benchmarkVersion: BENCHMARK_VERSION,
    testsHash: getBenchmarkTestsHash(),
    reasoningEffort: effort,
    avgCompletionTokens: 150
  };
}

const fakeTrait: TraitConfig = { name: 't', displayName: 'T', description: 't', prompt: 'stile neutro' };

async function main() {
  console.log('=== Test costo fisso del prompt (T8.9) ===\n');

  // ════════════════════════════════════════════════════════════════
  // Gruppo N — hasNativeFunctionCalling (registry.ts), unità isolata
  // ════════════════════════════════════════════════════════════════
  {
    const profilePath = path.resolve(process.cwd(), 'models_profile.json');
    const backup = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : null;

    try {
      const modelHigh = '__t89_native_fc__';
      const modelMid = '__t89_partial_fc__';
      fs.writeFileSync(profilePath, JSON.stringify({
        profiles: {
          [profileKey(modelHigh, 'xhigh')]: fakeProfile(modelHigh, 'xhigh', 0.95, 'large'),
          [profileKey(modelHigh, 'low')]: fakeProfile(modelHigh, 'low', 0.3, 'small'),
          [profileKey(modelMid, 'xhigh')]: fakeProfile(modelMid, 'xhigh', 0.65, 'medium'),
          // boundary esatto: soglia dichiarata >= 0.9 (registry.ts)
          [profileKey(modelMid, 'medium')]: fakeProfile(modelMid, 'medium', 0.9, 'medium')
        }
      }, null, 2), 'utf-8');

      check('N1', hasNativeFunctionCalling('__t89_mai_profilato__') === false,
        'modello mai profilato → nessun segnale di function calling nativo (prudente, come prima di T8.9)');
      check('N2', hasNativeFunctionCalling(modelHigh, 'xhigh') === true,
        'toolCalling 0.95 (>=0.9) a xhigh → function calling nativo rilevato');
      check('N3', hasNativeFunctionCalling(modelHigh, 'low') === false,
        "stesso modello ma a un altro effort profilato basso (toolCalling 0.3) → non rilevato: l'isolamento per livello di T8.12 vale anche qui");
      check('N4', hasNativeFunctionCalling(modelMid, 'xhigh') === false,
        'toolCalling 0.65 (tier medium, sotto soglia 0.9) → non rilevato: un modello mediocre nel tool calling tiene il testo come rete di sicurezza');
      check('N5', hasNativeFunctionCalling(modelMid, 'medium') === true,
        'toolCalling esattamente 0.9 (boundary) → rilevato (soglia inclusiva, >=)');
      check('N6', hasNativeFunctionCalling(modelHigh) === true,
        "senza effort esplicito → default prudente 'xhigh' di getModelProfile, e xhigh è profilato alto per questo modello");
    } finally {
      if (backup !== null) fs.writeFileSync(profilePath, backup, 'utf-8');
      else if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Gruppo P — loadSystemPrompt: elenco testuale condizionale (shared.ts)
  // ════════════════════════════════════════════════════════════════
  {
    const profilePath = path.resolve(process.cwd(), 'models_profile.json');
    const backup = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : null;

    try {
      const nativeModel = '__t89_prompt_native__';
      const dumbModel = '__t89_prompt_dumb__'; // mai profilato
      fs.writeFileSync(profilePath, JSON.stringify({
        profiles: {
          [profileKey(nativeModel, 'xhigh')]: fakeProfile(nativeModel, 'xhigh', 1, 'large')
        }
      }, null, 2), 'utf-8');

      // Tool-sonda dal nome inconfondibile: nessuno schema reale in tools_schemas/
      // con questo nome, quindi loadToolSchema ricade sul fallback (requiredTier
      // 'small', sempre visibile a qualunque tier) — isola il test dal tier del
      // modello, che qui non è ciò che vogliamo verificare.
      const probeToolName = 'probe_t89_marker_tool_xyz';
      const registry = new ToolRegistry();
      registry.register({ name: probeToolName, riskLevel: 'SAFE', execute: async () => 'ok' });
      registry.register({ name: 'save_memory', riskLevel: 'SAFE', execute: async () => 'ok' }); // requiredTier small

      const fakeRole: RoleConfig = {
        name: 'probe', displayName: 'Probe', description: 't',
        systemPrompt: 'Sei un test.', allowedTools: [probeToolName, 'save_memory']
      };

      // P1: modello mai profilato → comportamento INVARIATO rispetto a prima di T8.9
      const promptDumb = loadSystemPrompt(fakeRole, fakeTrait, dumbModel, registry, null);
      check('P1a', promptDumb.includes('Available tools:'), 'modello non profilato: la sezione "Available tools" resta (nessun segnale di function calling nativo)');
      check('P1b', promptDumb.includes(probeToolName), 'modello non profilato: il tool-sonda è elencato per nome nel testo');

      // P2: modello con function calling nativo misurato → sezione OMESSA (Accettazione T8.9)
      const promptNative = loadSystemPrompt(fakeRole, fakeTrait, nativeModel, registry, null, undefined, 'xhigh');
      check('P2a', !promptNative.includes('Available tools:'), 'modello con function calling nativo misurato: la sezione "Available tools" NON compare più nel prompt');
      check('P2b', !promptNative.includes(probeToolName), 'coerentemente, il nome del tool-sonda non compare nel testo (i tool viaggiano solo nell\'array `tools` della richiesta)');

      // P3: la nota save_memory/recall_memory (Fuori scope, non è un elenco di tool) resta in ENTRAMBI i casi
      check('P3a', promptDumb.includes('persistent shared memory') && promptDumb.includes('save_memory'),
        'modello non profilato: nota d\'uso su save_memory/recall_memory presente');
      check('P3b', promptNative.includes('persistent shared memory') && promptNative.includes('save_memory'),
        "modello con function calling nativo: la nota resta anche con l'elenco testuale omesso (non è un elenco di tool, è un'istruzione d'uso — Fuori scope T8.9)");

      // P4: comportamento dei tool invariato — l'array REALMENTE inviato all'API
      // (registry.listForLLM) è identico indipendentemente dal testo del prompt
      const toolsForDumb = registry.listForLLM(dumbModel, fakeRole.allowedTools).map((t) => t.function.name).sort();
      const toolsForNative = registry.listForLLM(nativeModel, fakeRole.allowedTools, 'xhigh').map((t) => t.function.name).sort();
      check('P4', JSON.stringify(toolsForDumb) === JSON.stringify(toolsForNative),
        `l'elenco tool realmente offerto all'API è lo stesso in entrambi i casi (${toolsForDumb.join(', ')}) — l'omissione riguarda solo il testo, mai l'esecuzione`);

      // P5: end-to-end — Agent esegue comunque il tool anche quando il testo è omesso
      // dal prompt (il prompt qui non alimenta nessuna logica di esecuzione: è solo
      // testo passato come primo messaggio 'system'; l'esecuzione dipende sempre e
      // solo dall'array `tools` calcolato da registry.listForLLM in Agent.run()).
      const provider = new MockLLMProvider([
        { toolCalls: [{ id: 'c1', type: 'function', function: { name: probeToolName, arguments: '{}' } }] },
        { content: 'fatto' }
      ], { model: nativeModel });
      const agent = new Agent(provider, registry, new PermissionManager(), promptNative, fakeRole.allowedTools, 40, 65536, 'tester', 'xhigh');
      const answer = await agent.run('esegui il tool sonda');
      check('P5a', answer === 'fatto', 'Agent completa il turno normalmente con il prompt "compresso" (senza elenco testuale)');
      const toolMsg = agent.getMessages().find((m) => m.role === 'tool');
      check('P5b', toolMsg?.content === 'ok', 'il tool-sonda è stato eseguito davvero: comportamento dei tool invariato');
    } finally {
      if (backup !== null) fs.writeFileSync(profilePath, backup, 'utf-8');
      else if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Gruppo B — gli schemi tool entrano nel budget di pruneHistory (agent.ts)
  // ════════════════════════════════════════════════════════════════
  {
    // Modello mai profilato: fallbackSchema dà requiredTier 'small', sempre
    // visibile a prescindere dal tier euristico — isola il test dal profilo.
    const model = '__t89_budget_probe__';
    const bigToolName = 'x'.repeat(1500); // nome enorme → schema enorme (fallbackSchema lo incorpora nella description)

    const bigRegistry = new ToolRegistry();
    bigRegistry.register({ name: bigToolName, riskLevel: 'SAFE', execute: async () => 'ok' });
    const emptyRegistry = new ToolRegistry();

    // Quanti token pesa lo schema del tool "grande", con lo STESSO calcolo che
    // Agent.run() userebbe (registry.listForLLM, stesso modello/allowedTools/effort).
    const toolsForBig = bigRegistry.listForLLM(model, undefined, undefined);
    check('B0', toolsForBig.length === 1, 'precondizione: il tool grande è visibile (fallback tier small)');
    const toolsCharsBig = JSON.stringify(toolsForBig).length;
    const toolsTokensBig = Math.ceil(toolsCharsBig / 3.5); // seed di default, nessuna run precedente ha calibrato
    check('B0b', toolsTokensBig > 50, `lo schema del tool grande pesa una quantità non trascurabile di token stimati (${toolsTokensBig})`);

    // Cronologia identica seminata direttamente (getMessages() ritorna l'array
    // mutabile): isola la prova dalla logica di run(), un solo pruneHistory()
    // esplicito, deterministico.
    function seedJunk(agent: Agent, count: number, charsEach: number) {
      const msgs = agent.getMessages();
      for (let i = 0; i < count; i++) {
        msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'J'.repeat(charsEach) });
      }
    }

    // Baseline: token di system + 10 giunk + il prossimo user message 'q' che
    // run() sta per pushare, stimati col metodo pubblico dell'agente stesso (un
    // agente "usa e getta", nessun calcolo a mano che possa disallinearsi
    // dall'implementazione reale).
    const probe = new Agent(new MockLLMProvider([]), emptyRegistry, new PermissionManager(), 'sys');
    seedJunk(probe, 10, 35);
    probe.getMessages().push({ role: 'user', content: 'q' });
    const baselineTokens = probe.estimateMessagesTokens(probe.getMessages());

    // Budget scelto a metà strada tra "bastano i soli messaggi" e "servono anche
    // i token dei tool": sopra la baseline (l'agente senza tool non deve potare),
    // sotto baseline+toolsTokensBig (l'agente con tool deve potare).
    const maxHistoryTokens = baselineTokens + Math.max(1, Math.floor(toolsTokensBig / 2));

    // pruneHistory da solo NON aggiorna i "toolsChars" (quello è compito di
    // run(), a ogni round): un giro reale di Agent.run() (risponde subito senza
    // tool_calls) dopo aver seminato la cronologia cattura esattamente l'effetto
    // di pruneHistory con i toolsChars del round realmente calcolati da Agent.
    const runnerNoTools = new Agent(new MockLLMProvider([{ content: 'ok' }], { model }), emptyRegistry, new PermissionManager(), 'sys', undefined, 100, maxHistoryTokens);
    const runnerWithTools = new Agent(new MockLLMProvider([{ content: 'ok' }], { model }), bigRegistry, new PermissionManager(), 'sys', undefined, 100, maxHistoryTokens);
    seedJunk(runnerNoTools, 10, 35);
    seedJunk(runnerWithTools, 10, 35);

    await runnerNoTools.run('q');
    await runnerWithTools.run('q');

    const lenNoTools = runnerNoTools.getMessages().length;
    const lenWithTools = runnerWithTools.getMessages().length;

    check('B1', lenWithTools < lenNoTools,
      `a parità di cronologia e budget, l'agente CON tool pesanti registrati pota di più (messaggi rimasti: senza tool=${lenNoTools}, con tool=${lenWithTools}) — pruneHistory conta gli schemi tool nel budget`);
    check('B2', lenNoTools === 13,
      `l'agente senza tool non ha bisogno di potare (messaggi rimasti: ${lenNoTools} = system+10 giunk+1 user+1 assistant, tutti conservati)`);
  }

  // ════════════════════════════════════════════════════════════════
  // Gruppo C — nessun tool registrato: nessuna regressione (T8.9, comportamento
  // identico a prima quando registry non offre nulla, come già verificato in
  // test_token_calibration.ts — qui verifichiamo esplicitamente il nuovo metodo)
  // ════════════════════════════════════════════════════════════════
  {
    const emptyRegistry = new ToolRegistry();
    const agent = new Agent(new MockLLMProvider([]), emptyRegistry, new PermissionManager(), 'sys');
    agent.getMessages().push({ role: 'user', content: 'ciao come stai oggi' });
    check('C1', agent.estimateTotalContextTokens() === agent.estimateMessagesTokens(agent.getMessages()),
      'senza tool registrati (o nessun round ancora eseguito), la stima totale coincide con quella dei soli messaggi: nessuna regressione');
  }

  // ════════════════════════════════════════════════════════════════
  // Gruppo D — calibrateCharsPerToken converge correttamente includendo i tool
  // (altrimenti la calibrazione osservata sarebbe sistematicamente falsata),
  // e la stima totale post-convergenza si avvicina al promptTokens reale
  // (Accettazione T8.9, testualmente).
  // ════════════════════════════════════════════════════════════════
  {
    const model = '__t89_calib_probe__';
    const toolName = 'probe_calib_tool_' + 'q'.repeat(120);
    const registry = new ToolRegistry();
    registry.register({ name: toolName, riskLevel: 'SAFE', execute: async () => 'ok' });

    // Stessa identica logica di selezione che Agent.run() userebbe: calcolata qui
    // per conoscere ESATTAMENTE quanti caratteri di schema saranno inviati a ogni
    // round (costante, perché registry/model/allowedTools/effort non cambiano).
    const tools = registry.listForLLM(model, undefined, undefined);
    const toolsChars = JSON.stringify(tools).length;
    check('D0', toolsChars > 200, `precondizione: lo schema del tool-sonda pesa una quantità non trascurabile di caratteri (${toolsChars})`);

    const SYSTEM = 'sys';
    const USER_MSG = 'ping';
    const ASSIST_MSG = 'pong';
    const TARGET_RATIO = 4.0; // diverso dal seed 3.5, come in test_token_calibration.ts
    const rounds = 20;

    const script: Array<{ content: string; stats: { promptTokens: number } }> = [];
    let histChars = SYSTEM.length;
    for (let i = 0; i < rounds; i++) {
      histChars += USER_MSG.length; // Agent.run() pusha lo user message prima della chiamata
      // Il "vero" promptTokens osservato dall'API conta ANCHE i caratteri dei tool:
      // se calibrateCharsPerToken non li includesse, la convergenza andrebbe
      // verso un rapporto sbagliato (i tool "mancanti" verrebbero scambiati per un
      // charsPerToken più alto di quello reale).
      script.push({ content: ASSIST_MSG, stats: { promptTokens: (histChars + toolsChars) / TARGET_RATIO } });
      histChars += ASSIST_MSG.length;
    }

    const provider = new MockLLMProvider(script, { model });
    const agent = new Agent(provider, registry, new PermissionManager(), SYSTEM);

    for (let i = 0; i < rounds; i++) {
      await agent.run(USER_MSG);
    }

    const finalRatio = agent.getCharsPerTokenRatio();
    check('D1', Math.abs(finalRatio - TARGET_RATIO) < 0.15,
      `con i tool inclusi nella calibrazione, il rapporto converge verso quello osservato (atteso ~${TARGET_RATIO}, ottenuto ${finalRatio.toFixed(4)})`);

    // Accettazione T8.9 (testuale): la stima di contesto si avvicina al promptTokens
    // reale dell'ultima chiamata.
    const lastRealPromptTokens = script[script.length - 1].stats.promptTokens;
    const estimatedTotal = agent.estimateTotalContextTokens();
    const relativeError = Math.abs(estimatedTotal - lastRealPromptTokens) / lastRealPromptTokens;
    check('D2', relativeError < 0.1,
      `estimateTotalContextTokens (${estimatedTotal}) si avvicina al promptTokens reale (${lastRealPromptTokens.toFixed(1)}): errore relativo ${(relativeError * 100).toFixed(1)}%`);
  }

  // ════════════════════════════════════════════════════════════════
  // Gruppo E — compressHistory: la soglia di attivazione ragiona su
  // messaggi+tool, non sui soli messaggi
  // ════════════════════════════════════════════════════════════════
  {
    const model = '__t89_compress_probe__';
    const bigToolName = 'z'.repeat(2000);
    const bigRegistry = new ToolRegistry();
    bigRegistry.register({ name: bigToolName, riskLevel: 'SAFE', execute: async () => 'ok' });
    const emptyRegistry = new ToolRegistry();

    const toolsForBig = bigRegistry.listForLLM(model, undefined, undefined);
    const toolsCharsBig = JSON.stringify(toolsForBig).length;
    const toolsTokensBig = Math.ceil(toolsCharsBig / 3.5);
    check('E0', toolsTokensBig > 300, `precondizione: lo schema del tool enorme pesa una quantità cospicua di token (${toolsTokensBig})`);

    // Cronologia: 8 messaggi "comprimibili" abbastanza grandi da superare da soli
    // il tetto interno di compressHistory (>=3000 token, altrimenti rifiuta di
    // comprimere per non pesare una chiamata LLM su un risparmio trascurabile),
    // più 4 messaggi "recenti" piccoli mantenuti sempre.
    function buildMessages() {
      const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      for (let i = 0; i < 8; i++) {
        msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'C'.repeat(1600) });
      }
      for (let i = 0; i < 4; i++) {
        msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'R'.repeat(50) });
      }
      return msgs;
    }

    const providerNoTools = new MockLLMProvider([], { model });
    const agentNoTools = new Agent(providerNoTools, emptyRegistry, new PermissionManager(), 'sys');
    for (const m of buildMessages()) agentNoTools.getMessages().push(m);

    const msgsOnlyTokens = agentNoTools.estimateMessagesTokens(agentNoTools.getMessages());
    check('E0b', msgsOnlyTokens > 3000, `precondizione: i soli messaggi superano già il tetto interno di compressione (${msgsOnlyTokens})`);

    // Budget scelto perché i SOLI messaggi restino SOTTO la soglia (threshold=0.75)
    // ma messaggi+tool la superino: 0.75*maxHistoryTokens compreso tra i due totali.
    const maxHistoryTokens = Math.ceil((msgsOnlyTokens + toolsTokensBig / 2) / 0.75);
    check('E0c', msgsOnlyTokens < maxHistoryTokens * 0.75,
      `con il budget scelto, i soli messaggi restano sotto la soglia (${msgsOnlyTokens} < ${(maxHistoryTokens * 0.75).toFixed(0)})`);
    check('E0d', msgsOnlyTokens + toolsTokensBig >= maxHistoryTokens * 0.75,
      `ma messaggi+tool la superano (${msgsOnlyTokens + toolsTokensBig} >= ${(maxHistoryTokens * 0.75).toFixed(0)})`);

    // Agente SENZA tool: la soglia non scatta mai (nessuna chiamata LLM di
    // riepilogo prevista nello script: se compressHistory provasse comunque a
    // chiamarla, MockLLMProvider lancerebbe un errore esplicito — prova indiretta
    // ma netta che il gate ha funzionato).
    const agentNoTools2 = new Agent(new MockLLMProvider([]), emptyRegistry, new PermissionManager(), 'sys', undefined, 40, maxHistoryTokens);
    for (const m of buildMessages()) agentNoTools2.getMessages().push(m);
    const resultNoTools = await agentNoTools2.compressHistory(0.75);
    check('E1', resultNoTools.compressedCount === 0,
      "agente senza tool: i soli messaggi non superano la soglia (0.75×budget) → compressHistory non fa nulla (nessuna chiamata LLM richiesta, nessuna nello script)");

    // Agente CON tool pesanti: la soglia scatta grazie al contributo dei tool.
    // compressHistory non passa mai da run(): il round che aggiorna toolsChars è
    // qui simulato esplicitamente con un giro di Agent.run() PRIMA della prova,
    // così toolsChars riflette davvero il registry con il tool pesante (stesso
    // meccanismo del Gruppo B). Il copione porta DUE risposte: una per il round
    // "primer" (run()) e una per la chiamata di riepilogo interna a compressHistory.
    const primerProvider = new MockLLMProvider([
      { content: 'ok' },
      { content: 'Riassunto sintetico del blocco compresso di test.' }
    ], { model });
    const primerAgent = new Agent(primerProvider, bigRegistry, new PermissionManager(), 'sys', undefined, 40, maxHistoryTokens);
    await primerAgent.run('avvia');
    for (const m of buildMessages()) primerAgent.getMessages().push(m);
    const resultWithTools = await primerAgent.compressHistory(0.75);
    check('E2', resultWithTools.compressedCount > 0,
      `agente con tool pesanti: messaggi+tool superano la soglia → compressHistory comprime davvero (${resultWithTools.compressedCount} messaggi compressi, ~${resultWithTools.saved} token risparmiati)`);
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
