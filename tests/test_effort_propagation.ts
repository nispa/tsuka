/**
 * Test dedicati a T8.12 — Propagare l'effort a getModelProfile (TASKS.md, FASE 3).
 * Coda aperta di T8.10: prima di questa modifica `getModelTier` e i suoi chiamanti
 * (registry.ts, shared.ts) non propagavano MAI l'effort di reasoning risolto da
 * `resolveReasoningEffort` — il lookup cercava sempre la chiave "modello@xhigh" e
 * ricadeva sull'euristica del nome, a prescindere da come il modello girava davvero.
 * Copre l'Accettazione del task:
 *  - getModelTier(modello, effort) legge il profilo alla chiave giusta, non sempre @xhigh;
 *  - un modello profilato a un livello e girato a QUEL livello riceve il tier misurato;
 *  - girato a un livello mai profilato, ricade sull'euristica (non su un altro profilo);
 *  - senza effort noto, il default resta 'xhigh' (comportamento pre-T8.12 invariato);
 *  - registry.listForLLM propaga l'effort fino al filtro dei tool per tier;
 *  - Agent.run() propaga l'effort risolto (costruzione o override di run()) fino al
 *    tool set REALMENTE offerto all'LLM (end-to-end, via MockLLMProvider.callLog);
 *  - loadSystemPrompt (shared.ts) propaga lo stesso effort, così il testo del prompt
 *    non promette tool che poi Agent.run() non rende eseguibili (e viceversa);
 *  - notifyIfUnprofiled (shared.ts) verifica la presenza del profilo alla chiave giusta.
 *
 * Esecuzione isolata: node --import tsx tests/test_effort_propagation.ts
 * (imposta TSUKA_MEMORY_FILE a un file temporaneo prima di lanciarlo da solo, per
 * non toccare la memoria reale dell'utente — stesso pattern di test_reasoning_effort.ts).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../src/core/agent';
import { MockLLMProvider } from './mocks/mockProvider';
import { ToolRegistry, getModelTier } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import {
  getModelProfile, profileKey, BENCHMARK_VERSION, ModelProfile
} from '../src/core/modelProfile';
import { getBenchmarkTestsHash } from '../src/core/benchmarkTests';
import { loadSystemPrompt, notifyIfUnprofiled, RoleConfig, TraitConfig } from '../src/cli/shared';
import { setEffortPin, setAskMode, confirmEffortDivergence, resetEffortControlForTest } from '../src/core/effortControl';

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

/** Fabbrica di un profilo finto v4 completo, stesso schema di test_fingerprinting.ts. */
function fakeProfile(model: string, effort: ModelProfile['reasoningEffort'], tier: ModelProfile['tier'], overrides: Partial<ModelProfile> = {}): ModelProfile {
  const scoresByTier: Record<ModelProfile['tier'], ModelProfile['scores']> = {
    small: { instruction: 0.4, json: 0.3, toolCalling: 0.2 },
    medium: { instruction: 0.75, json: 0.7, toolCalling: 0.65 },
    large: { instruction: 1, json: 1, toolCalling: 1 }
  };
  return {
    model,
    provider: 'test',
    tier,
    scores: scoresByTier[tier],
    tokensPerSecond: 30,
    testedAt: new Date().toISOString(),
    benchmarkVersion: BENCHMARK_VERSION,
    testsHash: getBenchmarkTestsHash(),
    reasoningEffort: effort,
    avgCompletionTokens: 150,
    ...overrides
  };
}

const fakeTrait: TraitConfig = { name: 't', displayName: 'T', description: 't', prompt: 'stile neutro' };

async function main() {
  console.log('=== Test propagazione effort → tier tool (T8.12) ===\n');

  const profilePath = path.resolve(process.cwd(), 'models_profile.json');
  const backup = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : null;

  try {
    // Modello con "9b" nel nome: la fallback euristica di getModelTier dà 'small'
    // (regex \d+b, 9 <= 12) — usato per distinguere "misurato" da "indovinato dal nome".
    const model = '__t812_modello_9b__';
    fs.writeFileSync(profilePath, JSON.stringify({
      profiles: {
        [profileKey(model, 'low')]: fakeProfile(model, 'low', 'small'),
        [profileKey(model, 'medium')]: fakeProfile(model, 'medium', 'medium'),
        [profileKey(model, 'xhigh')]: fakeProfile(model, 'xhigh', 'large')
        // 'none' deliberatamente NON profilato: prova il fallback euristico.
      }
    }, null, 2), 'utf-8');

    // ── 1. getModelTier(modello, effort): legge il profilo alla chiave giusta ──
    check('T812.1a', getModelTier(model, 'low') === 'small', "effort='low' → tier misurato a 'low' (small)");
    check('T812.1b', getModelTier(model, 'medium') === 'medium', "effort='medium' → tier misurato a 'medium', NON quello di 'low' o 'xhigh'");
    check('T812.1c', getModelTier(model, 'xhigh') === 'large', "effort='xhigh' → tier misurato a 'xhigh'");
    check('T812.1d', getModelTier(model, 'none') === 'small', "effort='none' mai profilato → fallback euristica del nome ('9b' → small), non un profilo di un altro livello");
    check('T812.1e', getModelTier(model) === 'large', "senza effort esplicito → default prudente 'xhigh' dentro getModelProfile (comportamento pre-T8.12 invariato)");

    // ── 2. registry.listForLLM propaga l'effort al filtro tier ──
    const registry = new ToolRegistry();
    registry.register({ name: 'read_file', riskLevel: 'SAFE', execute: async () => 'ok' }); // requiredTier small
    registry.register({ name: 'execute_command', riskLevel: 'RESTRICTED', execute: async () => 'ok' }); // requiredTier medium

    const namesAt = (effort?: 'none' | 'low' | 'medium' | 'xhigh') =>
      registry.listForLLM(model, undefined, effort).map((t) => t.function.name);

    const atLow = namesAt('low');
    check('T812.2a', atLow.includes('read_file') && !atLow.includes('execute_command'),
      `tier 'small' (misurato a 'low'): solo read_file visibile (ricevuti: ${atLow.join(', ') || 'nessuno'})`);

    const atMedium = namesAt('medium');
    check('T812.2b', atMedium.includes('read_file') && atMedium.includes('execute_command'),
      `tier 'medium' (misurato a 'medium'): entrambi i tool visibili (ricevuti: ${atMedium.join(', ')})`);

    const atXhigh = namesAt('xhigh');
    check('T812.2c', atXhigh.includes('read_file') && atXhigh.includes('execute_command'),
      `tier 'large' (misurato a 'xhigh'): entrambi i tool visibili (ricevuti: ${atXhigh.join(', ')})`);

    const atNone = namesAt('none');
    check('T812.2d', atNone.includes('read_file') && !atNone.includes('execute_command'),
      `effort 'none' mai profilato → fallback euristica 'small': solo read_file visibile (ricevuti: ${atNone.join(', ') || 'nessuno'})`);

    const atDefault = namesAt(undefined);
    check('T812.2e', atDefault.includes('read_file') && atDefault.includes('execute_command'),
      "senza effort esplicito, listForLLM eredita il default prudente 'xhigh' di getModelTier (regressione: comportamento pre-T8.12 su chiamate a 2 argomenti)");

    // ── 3. End-to-end: Agent.run() → registry.listForLLM con l'effort REALMENTE
    //    risolto per l'agente (costruzione), non un valore fisso ──
    {
      const providerLow = new MockLLMProvider([{ content: 'ok' }], { model });
      const agentLow = new Agent(providerLow, registry, new PermissionManager(), 'Sei un test.', ['execute_command'], 40, 65536, 'tester', 'low');
      await agentLow.run('ciao');
      // Doppio filtro (registry.ts): allowedTools=['execute_command'] lo lascerebbe
      // passare, ma il tier 'small' (misurato a 'low') lo esclude comunque — Agent
      // riceve tools.length===0 e passa undefined al provider (vedi agent.ts).
      check('T812.3a', providerLow.callLog[0]?.tools === undefined,
        `allowedTools include execute_command, ma a tier 'small' resta nascosto: nessun tool inviato (ricevuto: ${JSON.stringify(providerLow.callLog[0]?.tools)})`);

      const providerMedium = new MockLLMProvider([{ content: 'ok' }], { model });
      const agentMedium = new Agent(providerMedium, registry, new PermissionManager(), 'Sei un test.', ['execute_command'], 40, 65536, 'tester', 'medium');
      await agentMedium.run('ciao');
      const namesMedium = (providerMedium.callLog[0]?.tools ?? []).map((t: any) => t.function.name);
      check('T812.3b', namesMedium.includes('execute_command'),
        `stesso agente, effort di costruzione 'medium' → tier misurato 'medium': execute_command visibile (ricevuti: ${namesMedium.join(', ') || 'nessuno'})`);
    }

    // ── 4. L'override per singola run() (T8.10, terzo livello della cascata) cambia
    //    il tier del tool set round per round, non solo il payload di reasoning_effort ──
    {
      const provider = new MockLLMProvider([{ content: 'ok' }], { model });
      // Costruito senza reasoningEffort risolto: senza override, listForLLM userebbe
      // il default 'xhigh' (tier large, entrambi i tool visibili).
      const agent = new Agent(provider, registry, new PermissionManager(), 'Sei un test.', undefined, 40, 65536, 'tester', undefined);
      await agent.run('ciao', undefined, undefined, undefined, undefined, 'low');
      const names = (provider.callLog[0]?.tools ?? []).map((t: any) => t.function.name);
      check('T812.4a', names.includes('read_file') && !names.includes('execute_command'),
        `override di run() ('low') vince: tier 'small', execute_command nascosto (ricevuti: ${names.join(', ') || 'nessuno'})`);
    }

    // ── 5. loadSystemPrompt (shared.ts) propaga lo stesso effort: il testo del
    //    prompt non deve promettere un tool set diverso da quello poi eseguibile ──
    {
      const fakeRole: RoleConfig = { name: 'probe', displayName: 'Probe', description: 't', systemPrompt: 'Sei un test.', allowedTools: ['read_file', 'execute_command'] };
      const promptLow = loadSystemPrompt(fakeRole, fakeTrait, model, registry, null, undefined, 'low');
      const promptMedium = loadSystemPrompt(fakeRole, fakeTrait, model, registry, null, undefined, 'medium');
      const promptDefault = loadSystemPrompt(fakeRole, fakeTrait, model, registry, null, undefined); // 7° parametro omesso

      check('T812.5a', promptLow.includes('read_file') && !promptLow.includes('execute_command'),
        "loadSystemPrompt con effort='low': solo read_file elencato nel prompt");
      check('T812.5b', promptMedium.includes('read_file') && promptMedium.includes('execute_command'),
        "loadSystemPrompt con effort='medium': entrambi i tool elencati nel prompt");
      // Aggiornato dopo T8.9: a 'xhigh' questo profilo ha toolCalling >= 0.9, quindi
      // `hasNativeFunctionCalling` è vera e l'elenco testuale dei tool viene omesso —
      // il modello li riceve comunque nell'array `tools` dell'API. L'assenza della
      // sezione è di per sé la prova che il fallback ha risolto a 'xhigh': con 'low' o
      // 'medium' (toolCalling sotto soglia) l'elenco comparirebbe, come dimostrano
      // T812.5a e T812.5b qui sopra.
      check('T812.5c', !promptDefault.includes('Available tools'),
        "loadSystemPrompt senza 7° parametro (chiamanti che non lo passano ancora): fallback 'xhigh' invariato — elenco testuale omesso perché a quel livello il function calling è misurato affidabile (T8.9)");
    }

    // ── 6. notifyIfUnprofiled (shared.ts): verifica la presenza del profilo alla
    //    chiave "modello@effort" giusta, non sempre a '@xhigh' ──
    {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); };
      let warnedAtMedium = false;
      let warnedAtNone = false;
      try {
        notifyIfUnprofiled(model, 'medium'); // profilato a 'medium' → nessun avviso
        warnedAtMedium = logs.some((l) => l.includes('non ancora profilato') || l.includes('not yet profiled') || l.includes('has not been benchmarked'));
        logs.length = 0;

        notifyIfUnprofiled(model, 'none'); // mai profilato a 'none' → avviso
        warnedAtNone = logs.some((l) => l.includes('non ancora profilato') || l.includes('not yet profiled') || l.includes('has not been benchmarked'));
      } finally {
        console.log = originalLog;
      }
      check('T812.6a', !warnedAtMedium, "modello profilato a 'medium' e interrogato a 'medium' → nessun avviso 'non profilato'");
      check('T812.6b', warnedAtNone, "stesso modello, effort 'none' mai profilato → avviso (non riusa il profilo di 'medium')");
    }

    // ── 7. T8.15: Correzione del segnale di divergenza effort con pin attivo ──
    {
      resetEffortControlForTest();
      setEffortPin('low');
      setAskMode(true);

      let confirmCalled = false;
      const res = await confirmEffortDivergence(
        'tester',
        'low',      // effort effettivo del turno (uguale al pin low)
        'medium',   // default dinamico / modello suggerito
        async () => {
          confirmCalled = true;
          return true;
        }
      );

      check('T815.1a', res === 'low', "con pin='low' e turno a 'low', confirmEffortDivergence ritorna 'low'");
      check('T815.1b', !confirmCalled, "con pin='low' e turno a 'low', non chiede alcuna conferma (diverged: false)");
      resetEffortControlForTest();
    }
  } finally {
    if (backup !== null) {
      fs.writeFileSync(profilePath, backup, 'utf-8');
    } else if (fs.existsSync(profilePath)) {
      fs.unlinkSync(profilePath);
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
