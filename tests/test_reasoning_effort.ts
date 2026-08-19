/**
 * Test per il controllo del reasoning_effort (T8.10, TASKS.md — FASE 3).
 * Copre l'Accettazione del task:
 *  - cascata a 4 livelli (override chiamante → personaggio → ruolo → default config);
 *  - il valore risolto arriva davvero fino al provider (Agent → chatWithTools →
 *    payload dell'SDK OpenAI, senza mock intermedi);
 *  - /benchmark spazza i 4 livelli e salva un profilo per livello, chiave "modello@effort";
 *  - getModelProfile isola i livelli fra loro (non riusa un profilo scritto a un
 *    altro effort per lo stesso modello) — il difetto descritto in TASKS.md;
 *  - avgCompletionTokens è presente e distingue i livelli;
 *  - i role/character reali (roles/*.json, characters/*.json) portano il campo
 *    dove ha senso (architect alto, translator basso, ecc.).
 *
 * Esecuzione isolata: node --import tsx tests/test_reasoning_effort.ts
 * (imposta TSUKA_MEMORY_FILE a un file temporaneo prima di lanciarlo da solo,
 * per non toccare la memoria reale dell'utente — vedi run_tests.ts per il pattern).
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import { Agent, resolveReasoningEffort } from '../src/core/agent';
import { LLMProvider, ILLMProvider, ChatOptions, ChatResponse } from '../src/core/provider';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import {
  runBenchmark, getModelProfile, profileKey, BENCHMARK_VERSION, REASONING_EFFORT_LEVELS
} from '../src/core/modelProfile';
import { loadRole, loadCharacter, loadSystemPrompt } from '../src/cli/shared';
import { listAvailableCharacters } from '../src/cli/shared';
import { getBenchmarkTestsHash } from '../src/core/benchmarkTests';

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
  console.log('=== Test reasoning_effort (T8.10) ===\n');

  // ── Cascata di risoluzione: override chiamante → personaggio → ruolo → default config ──
  {
    check('RE.1a',
      resolveReasoningEffort('none', { reasoningEffort: 'xhigh' }, { reasoningEffort: 'medium' }, 'low') === 'none',
      "l'override del chiamante vince su tutti gli altri livelli");
    check('RE.1b',
      resolveReasoningEffort(undefined, { reasoningEffort: 'xhigh' }, { reasoningEffort: 'medium' }, 'low') === 'xhigh',
      'senza override, vince il personaggio sul ruolo e sul default');
    check('RE.1c',
      resolveReasoningEffort(undefined, null, { reasoningEffort: 'medium' }, 'low') === 'medium',
      'senza override né personaggio, vince il ruolo sul default');
    check('RE.1d',
      resolveReasoningEffort(undefined, null, null, 'low') === 'low',
      'senza nessuno dei tre livelli sopra, vince il default di configurazione');
    check('RE.1e',
      resolveReasoningEffort(undefined, null, null, undefined) === undefined,
      "nessun livello specificato in nessun posto → undefined (nessun default silenzioso, decide il modello)");
    check('RE.1f',
      resolveReasoningEffort(undefined, { reasoningEffort: undefined }, { reasoningEffort: 'medium' }, 'low') === 'medium',
      "personaggio che non specifica il campo → si passa al ruolo, non a un default implicito");
  }

  // ── L'Agent porta lo sforzo risolto fino al provider (via MockLLMProvider) ──
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'ok' }]);
    const permissionManager = new PermissionManager();
    const agent = new Agent(provider, registry, permissionManager, 'Sei un test.', undefined, 40, 65536, 'tester', 'medium');

    check('RE.2a', agent.getReasoningEffort() === 'medium', "l'agente espone l'effort risolto in costruzione");

    await agent.run('ciao');
    check('RE.2b',
      provider.callLog[0]?.options?.reasoningEffort === 'medium',
      `chatWithTools riceve reasoningEffort='medium' dal costruttore (ricevuto: ${JSON.stringify(provider.callLog[0]?.options)})`);
  }

  // ── Override del chiamante per SINGOLA run() vince sul valore di costruzione (T8.10:
  //    predisposizione per spawn_agent, che sa che un sotto-compito è meccanico) ──
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'ok' }]);
    const permissionManager = new PermissionManager();
    const agent = new Agent(provider, registry, permissionManager, 'Sei un test.', undefined, 40, 65536, 'tester', 'xhigh');

    await agent.run('ciao', undefined, undefined, undefined, undefined, 'low');
    check('RE.3a',
      provider.callLog[0]?.options?.reasoningEffort === 'low',
      `l'override passato a run() ('low') vince sull'effort di costruzione ('xhigh') (ricevuto: ${JSON.stringify(provider.callLog[0]?.options)})`);
  }

  // ── Agent senza nessun effort risolto: nessuna ChatOptions forzata (comportamento
  //    invariato per chi non ha mai configurato reasoningEffort da nessuna parte) ──
  {
    const registry = new ToolRegistry();
    const provider = new MockLLMProvider([{ content: 'ok' }]);
    const permissionManager = new PermissionManager();
    const agent = new Agent(provider, registry, permissionManager, 'Sei un test.');
    await agent.run('ciao');
    check('RE.4a',
      provider.callLog[0]?.options === undefined,
      'senza effort risolto, chatWithTools riceve options=undefined (nessun default silenzioso)');
  }

  // ── Il ciclo tool multi-round mantiene lo stesso effort ad ogni round ──
  {
    const registry = new ToolRegistry();
    registry.register({ name: 'noop', riskLevel: 'SAFE', execute: async () => 'fatto' });
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('noop', {})] },
      { content: 'finito' }
    ]);
    const permissionManager = new PermissionManager();
    const agent = new Agent(provider, registry, permissionManager, 'Sei un test.', undefined, 40, 65536, 'tester', 'low');
    await agent.run('esegui noop');
    check('RE.5a',
      provider.callLog.length === 2 &&
        provider.callLog[0].options?.reasoningEffort === 'low' &&
        provider.callLog[1].options?.reasoningEffort === 'low',
      "l'effort resta 'low' su entrambi i round del ciclo ReAct");
  }

  // ── LLMProvider reale: reasoning_effort arriva davvero nel payload dell'SDK OpenAI
  //    (nessun mock intermedio: si intercetta solo la create() del client OpenAI) ──
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    const capturedParams: any[] = [];
    (provider as any).client.chat.completions.create = async (params: any) => {
      capturedParams.push(params);
      return {
        choices: [{ message: { content: 'ok', tool_calls: undefined } }],
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 }
      };
    };

    await provider.chatWithTools([{ role: 'user', content: 'ciao' }], undefined, undefined, undefined, { reasoningEffort: 'xhigh' });
    check('RE.6a',
      capturedParams[0]?.reasoning_effort === 'xhigh',
      `il payload inviato all'SDK contiene reasoning_effort='xhigh' (ricevuto: ${capturedParams[0]?.reasoning_effort})`);

    await provider.chatWithTools([{ role: 'user', content: 'ciao' }]);
    check('RE.6b',
      !('reasoning_effort' in (capturedParams[1] ?? {})),
      "senza ChatOptions il payload NON contiene reasoning_effort (nessun default forzato dal provider)");

    // Livello 'none': stringa non vuota → deve viaggiare comunque (non va confuso con "assente")
    await provider.chatWithTools([{ role: 'user', content: 'ciao' }], undefined, undefined, undefined, { reasoningEffort: 'none' });
    check('RE.6c',
      capturedParams[2]?.reasoning_effort === 'none',
      "il livello 'none' viaggia esplicitamente (non è trattato come 'nessuna opzione')");
  }

  // ── Role/character reali: il campo è presente dove ha senso (spot-check, non esaustivo) ──
  {
    const architect = loadRole('architect') as any;
    const translator = loadRole('translator') as any;
    const entertainer = loadRole('entertainer') as any;
    check('RE.7a', architect.reasoningEffort === 'xhigh', "role 'architect' → effort alto (xhigh), pianificazione profonda");
    check('RE.7b', translator.reasoningEffort === 'low', "role 'translator' → effort basso, esempio esplicito del task");
    check('RE.7c', entertainer.reasoningEffort === 'none', "role 'entertainer' → nessun ragionamento richiesto");

    // Cascata personaggio → ruolo, verificata su chi il catalogo installato mette
    // a disposizione: un personaggio con override esplicito e uno senza.
    const catalog = listAvailableCharacters() as any[];
    const withOverride = catalog.find((c) => !!c.reasoningEffort);
    const withoutOverride = catalog.find((c) => !c.reasoningEffort);
    check('RE.7d', !!withOverride,
      `almeno un personaggio porta un override esplicito di effort (@${withOverride?.name}: '${withOverride?.reasoningEffort}')`);
    if (withOverride) {
      check('RE.7e',
        resolveReasoningEffort(undefined, withOverride, architect, undefined) === withOverride.reasoningEffort,
        `l'override del personaggio (@${withOverride.name}) vince sul ruolo ('${architect.reasoningEffort}')`);
    }
    if (withoutOverride) {
      const inheritedRole = loadRole(withoutOverride.role) as any;
      check('RE.7f',
        resolveReasoningEffort(undefined, withoutOverride, inheritedRole, undefined) === inheritedRole.reasoningEffort,
        `senza override (@${withoutOverride.name}) si eredita l'effort del ruolo '${withoutOverride.role}'`);
    }
  }

  // ── /benchmark spazza i 4 livelli e produce un profilo per livello, isolati fra loro ──
  const profilePath = path.resolve(process.cwd(), 'models_profile.json');
  const backup = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : null;
  try {
    // Provider finto che registra il ChatOptions ricevuto ad ogni chiamata, per
    // provare che il benchmark fa girare l'INTERO set di test a ciascuno dei 4
    // livelli (non solo etichetta 4 volte la stessa unica misura).
    class EffortAwareFakeProvider implements ILLMProvider {
      calls: { options?: ChatOptions }[] = [];
      private model = 'fake-benchmark-model';
      async chatWithTools(_messages: any[], _tools?: any[], _onChunk?: any, _signal?: AbortSignal, options?: ChatOptions): Promise<ChatResponse> {
        this.calls.push({ options });
        return {
          content: 'risposta di test generica, nessun tool',
          stats: { durationMs: 5, tokenCount: 20, tokensPerSecond: 50, promptTokens: 30, totalTokens: 50 }
        };
      }
      getCurrentModel() { return this.model; }
      setCurrentModel(m: string) { this.model = m; }
      getBaseUrl() { return 'fake://bench'; }
      async listModels() { return [this.model]; }
      reconfigure() {}
    }

    const fakeProvider = new EffortAwareFakeProvider();
    const modelName = 'fake-benchmark-model';
    const { profiles, recommendedEffort } = await runBenchmark(fakeProvider, modelName);

    check('RE.8a', profiles.length === REASONING_EFFORT_LEVELS.length, `un profilo per ciascuno dei ${REASONING_EFFORT_LEVELS.length} livelli (ricevuti: ${profiles.length})`);
    check('RE.8b',
      profiles.every((p, i) => p.reasoningEffort === REASONING_EFFORT_LEVELS[i]),
      `i profili sono nell'ordine di REASONING_EFFORT_LEVELS (${profiles.map((p) => p.reasoningEffort).join(', ')})`);
    check('RE.8c',
      profiles.every((p) => p.benchmarkVersion === BENCHMARK_VERSION && p.benchmarkVersion === 4),
      'ogni profilo è marcato con BENCHMARK_VERSION 4 (T8.10)');
    check('RE.8d',
      profiles.every((p) => typeof p.avgCompletionTokens === 'number'),
      'ogni profilo ha avgCompletionTokens numerico');
    check('RE.8e', !!recommendedEffort && REASONING_EFFORT_LEVELS.includes(recommendedEffort),
      `/benchmark chiude con una raccomandazione valida (ricevuta: '${recommendedEffort}')`);

    // Il set di test reale (benchmarks/*.json) ha più di un passo LLM in totale:
    // se il provider ha ricevuto chiamate, ognuna deve portare l'effort del
    // livello a cui appartiene — prova che lo sweep gira DAVVERO l'intero set
    // a ciascun livello, non lo etichetta soltanto dopo un'unica misura.
    const callsPerLevel = fakeProvider.calls.length / REASONING_EFFORT_LEVELS.length;
    check('RE.8f', Number.isInteger(callsPerLevel) && callsPerLevel > 0,
      `le chiamate al provider si dividono in blocchi uguali per livello (${fakeProvider.calls.length} chiamate totali, ${callsPerLevel} per livello)`);
    let effortMismatch = false;
    for (let i = 0; i < REASONING_EFFORT_LEVELS.length; i++) {
      const block = fakeProvider.calls.slice(i * callsPerLevel, (i + 1) * callsPerLevel);
      if (!block.every((c) => c.options?.reasoningEffort === REASONING_EFFORT_LEVELS[i])) effortMismatch = true;
    }
    check('RE.8g', !effortMismatch, "ogni blocco di chiamate porta il reasoning_effort del proprio livello, nell'ordine giusto");

    // Isolamento via getModelProfile: la chiave "modello@effort" (profileKey) separa
    // i profili — quello di 'low' non deve mai combaciare con quello di 'xhigh'.
    const lowProfile = getModelProfile(modelName, 'low');
    const xhighProfile = getModelProfile(modelName, 'xhigh');
    check('RE.9a', lowProfile !== null && xhighProfile !== null, 'entrambi i profili (low, xhigh) sono rileggibili da disco dopo il benchmark');
    check('RE.9b', lowProfile?.reasoningEffort === 'low' && xhighProfile?.reasoningEffort === 'xhigh',
      "ogni profilo riletto porta il proprio effort, non quello di un altro livello");
    check('RE.9c', getModelProfile(modelName, 'medium') !== null, "il livello 'medium', anch'esso misurato, è a sua volta leggibile");
    // Un modello mai profilato a un dato effort non deve MAI restituire il profilo
    // di un modello diverso o di un altro effort: la prova diretta del difetto
    // descritto in TASKS.md ("un profilo misurato a xhigh viene applicato anche
    // quando si gira a low").
    check('RE.9d', getModelProfile('__modello_mai_visto__', 'low') === null,
      'un modello mai profilato a quel livello → null, non un profilo di un altro modello/livello');

    // La chiave su disco è letteralmente "modello@effort" (contratto esplicito del task)
    const raw = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    check('RE.9e',
      profileKey(modelName, 'low') in raw.profiles && profileKey(modelName, 'xhigh') in raw.profiles,
      `models_profile.json usa chiavi "modello@effort" (es. '${profileKey(modelName, 'low')}')`);
  } finally {
    if (backup !== null) {
      fs.writeFileSync(profilePath, backup, 'utf-8');
    } else if (fs.existsSync(profilePath)) {
      fs.unlinkSync(profilePath);
    }
  }

  // ── T8.12 (coda di T8.10): l'effort risolto arriva fino al TIER dei tool, non solo
  //    al payload del provider. Prima di T8.12, getModelTier/registry.listForLLM non
  //    ricevevano mai l'effort: il lookup cercava sempre "modello@xhigh" e ricadeva
  //    sull'euristica del nome, anche dopo un /benchmark completo sui 4 livelli. ──
  {
    const profilePath = path.resolve(process.cwd(), 'models_profile.json');
    const backup = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : null;
    try {
      // Nome finto senza cifre+'b': l'euristica di getModelTier ricade su 'small'
      // se nessun profilo viene trovato alla chiave richiesta.
      const fakeModel = '__probe_t812_tier__';
      fs.writeFileSync(profilePath, JSON.stringify({
        profiles: {
          [profileKey(fakeModel, 'medium')]: {
            model: fakeModel,
            provider: 'test',
            tier: 'medium',
            scores: { instruction: 0.7, json: 0.6, toolCalling: 0.65 },
            tokensPerSecond: 20,
            testedAt: new Date().toISOString(),
            benchmarkVersion: BENCHMARK_VERSION,
            testsHash: getBenchmarkTestsHash(),
            reasoningEffort: 'medium',
            avgCompletionTokens: 200
          }
        }
      }, null, 2), 'utf-8');

      // execute_command ha requiredTier 'medium' (tools_schemas/execute_command.json):
      // visibile solo da tier medium in su. Registrato con un execute finto: il test
      // ispeziona solo l'elenco tool offerto all'LLM (registry.listForLLM via Agent),
      // non lo esegue mai (lo script del mock risponde solo con 'content', mai un tool_call).
      const registry = new ToolRegistry();
      registry.register({ name: 'execute_command', riskLevel: 'RESTRICTED', execute: async () => 'ok' });

      // Girato allo STESSO effort del profilo misurato ('medium') → tier misurato
      // (medium): execute_command diventa visibile.
      const providerMedium = new MockLLMProvider([{ content: 'ok' }], { model: fakeModel });
      const agentMedium = new Agent(providerMedium, registry, new PermissionManager(), 'Sei un test.', undefined, 40, 65536, 'tester', 'medium');
      await agentMedium.run('ciao');
      const toolsMedium = (providerMedium.callLog[0]?.tools ?? []).map((t: any) => t.function.name);
      check('RE.10a', toolsMedium.includes('execute_command'),
        `girato a 'medium' (profilato a 'medium') → tier misurato, execute_command visibile (tool ricevuti: ${toolsMedium.join(', ') || 'nessuno'})`);

      // Girato a un effort MAI profilato per questo modello ('xhigh') → nessun profilo
      // a quella chiave → ricade sull'euristica del nome ('small', nessuna cifra+'b'):
      // execute_command (medium) resta nascosto. Il difetto esatto descritto in
      // TASKS.md T8.12: prima di questa modifica il lookup cercava sempre '@xhigh' a
      // prescindere dall'effort reale, quindi questo caso e RE.10a avrebbero dato lo
      // STESSO risultato (entrambi euristica) invece di isolarsi come qui.
      const providerXhigh = new MockLLMProvider([{ content: 'ok' }], { model: fakeModel });
      const agentXhigh = new Agent(providerXhigh, registry, new PermissionManager(), 'Sei un test.', undefined, 40, 65536, 'tester', 'xhigh');
      await agentXhigh.run('ciao');
      const toolsXhigh = (providerXhigh.callLog[0]?.tools ?? []).map((t: any) => t.function.name);
      check('RE.10b', !toolsXhigh.includes('execute_command'),
        `girato a 'xhigh' (mai profilato per questo modello) → fallback euristica ('small'), execute_command resta nascosto (tool ricevuti: ${toolsXhigh.join(', ') || 'nessuno'})`);

      // loadSystemPrompt (shared.ts) propaga lo stesso effort a registry.listForLLM:
      // il testo del prompt deve elencare lo STESSO set di tool che Agent.run() poi
      // rende davvero eseguibile, non un sottoinsieme più prudente calcolato a parte.
      // Role finto minimale (non uno dei roles/*.json reali): l'unica cosa che conta
      // qui è che allowedTools includa execute_command, il tool-sonda della prova sopra.
      const fakeRole = { name: 'probe', displayName: 'Probe', description: 'test', systemPrompt: 'Sei un test.', allowedTools: ['execute_command'] };
      const fakeTrait = { name: 't', displayName: 't', description: 't', prompt: 'stile neutro' };
      const promptMedium = loadSystemPrompt(fakeRole, fakeTrait, fakeModel, registry, null, undefined, 'medium');
      const promptXhigh = loadSystemPrompt(fakeRole, fakeTrait, fakeModel, registry, null, undefined, 'xhigh');
      check('RE.10c', promptMedium.includes('execute_command') && !promptXhigh.includes('execute_command'),
        "loadSystemPrompt propaga l'effort a registry.listForLLM: il testo del prompt riflette lo stesso tier usato da Agent.run()");
    } finally {
      if (backup !== null) {
        fs.writeFileSync(profilePath, backup, 'utf-8');
      } else if (fs.existsSync(profilePath)) {
        fs.unlinkSync(profilePath);
      }
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
