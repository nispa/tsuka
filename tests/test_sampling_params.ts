import {
  resolveSamplingParams,
  resolveFamilySamplingParams,
  __setSamplingProfileLookupForTest,
  LLMProvider
} from '../src/core/provider';
import { loadCharacter, loadRole, resolveCreativity } from '../src/cli/shared';
import { characterWithRole } from './fixtures/roster';


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
  console.log('=== Test Parametri di Campionamento e Creatività (T8.17) ===\n');

  // Test 1: Risoluzione preset 'precise'
  {
    const res = resolveSamplingParams({ creativity: 'precise' });
    check('SP1a', res.temperature === 0.2, "preset 'precise' imposta temperature: 0.2");
    check('SP1b', res.top_p === 0.8, "preset 'precise' imposta top_p: 0.8");
  }

  // Test 2: Risoluzione preset 'creative'
  {
    const res = resolveSamplingParams({ creativity: 'creative' });
    check('SP2a', res.temperature === 0.95, "preset 'creative' imposta temperature: 0.95");
    check('SP2b', res.top_p === 0.95, "preset 'creative' imposta top_p: 0.95");
    check('SP2c', res.presence_penalty === 0.3, "preset 'creative' imposta presence_penalty: 0.3");
  }

  // Test 3: Risoluzione preset 'balanced'
  {
    const res = resolveSamplingParams({ creativity: 'balanced' });
    check('SP3a', res.temperature === 0.7, "preset 'balanced' imposta temperature: 0.7");
    check('SP3b', res.top_p === 0.9, "preset 'balanced' imposta top_p: 0.9");
  }

  // Test 4: Override diretto di parametri numerici sopra un preset
  {
    const res = resolveSamplingParams({ creativity: 'precise', temperature: 0.05 });
    check('SP4', res.temperature === 0.05 && res.top_p === 0.8, 'override diretto del parametro numerico vince sul preset');
  }

  // Test 5: Risoluzione della creatività nei ruoli e personaggi
  {
    const devChar = characterWithRole('developer');
    const devRole = loadRole('developer');
    const copyRole = loadRole('copywriter');
    const creativeChar = characterWithRole('game_designer');

    check('SP5a', devRole?.creativity === 'precise', "ruolo 'developer' dotato di creatività 'precise'");
    check('SP5b', copyRole?.creativity === 'creative', "ruolo 'copywriter' dotato di creatività 'creative'");
    check('SP5c', resolveCreativity(devChar, devRole) === 'precise', `chi copre 'developer' (@${devChar.name}) lavora con creatività 'precise'`);
    check('SP5d', resolveCreativity(creativeChar, loadRole('game_designer')) === 'creative', `chi copre 'game_designer' (@${creativeChar.name}) lavora con creatività 'creative'`);

    const resolvedDev = resolveCreativity(devChar, devRole);
    check('SP5e', resolvedDev === 'precise', `resolveCreativity per @${devChar.name} restituisce 'precise'`);
  }

  // Test 6: Inoltro dei parametri di campionamento a LLMProvider
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    const capturedParams: any[] = [];
    (provider as any).client.chat.completions.create = async (params: any) => {
      capturedParams.push(params);
      return {
        choices: [{ message: { content: 'ok' } }],
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 }
      };
    };

    await provider.chatWithTools(
      [{ role: 'user', content: 'ciao' }],
      undefined,
      undefined,
      undefined,
      { creativity: 'creative' }
    );

    check('SP6a', capturedParams[0]?.temperature === 0.95, "LLMProvider inoltra temperature: 0.95 per creativity='creative'");
    check('SP6b', capturedParams[0]?.presence_penalty === 0.3, "LLMProvider inoltra presence_penalty: 0.3 per creativity='creative'");
  }

  const QWEN38 = 'unsloth/Qwen3.8-27B-GGUF';

  // Test 7: Profilo di famiglia Qwen3.8 in modalità thinking (nessun effort = ragiona)
  {
    const res = resolveSamplingParams(undefined, QWEN38);
    check('SP7a', res.temperature === 1.0, 'Qwen3.8 thinking imposta temperature: 1.0');
    check('SP7b', res.top_p === 0.95, 'Qwen3.8 thinking imposta top_p: 0.95');
    check('SP7c', res.top_k === 20, 'Qwen3.8 thinking imposta top_k: 20');
    check('SP7d', res.min_p === 0, 'Qwen3.8 thinking imposta min_p: 0.0');
    check('SP7e', res.presence_penalty === 0, 'Qwen3.8 thinking imposta presence_penalty: 0.0');
    check(
      'SP7f',
      res.repetition_penalty === 1.0 && res.repeat_penalty === 1.0,
      'repetition_penalty viaggia anche come repeat_penalty (alias llama.cpp)'
    );
  }

  // Test 8: Profilo di famiglia Qwen3.8 in modalità instruct (effort 'none')
  {
    const res = resolveSamplingParams({ reasoningEffort: 'none' }, QWEN38);
    check('SP8a', res.temperature === 0.7, "Qwen3.8 con effort 'none' imposta temperature: 0.7");
    check('SP8b', res.top_p === 0.8, "Qwen3.8 con effort 'none' imposta top_p: 0.80");
    check('SP8c', res.presence_penalty === 1.5, "Qwen3.8 con effort 'none' imposta presence_penalty: 1.5");
    check('SP8d', res.top_k === 20, "Qwen3.8 con effort 'none' imposta top_k: 20");
  }

  // Test 9: Un modello fuori tabella non riceve parametri impliciti
  {
    const res = resolveSamplingParams(undefined, 'qwen2.5-coder:7b');
    check('SP9', Object.keys(res).length === 0, 'modello senza profilo: nessun parametro di campionamento inviato');
  }

  // Test 10: Precedenza preset/valori espliciti sui default di famiglia
  {
    const res = resolveSamplingParams({ creativity: 'precise', temperature: 0.05 }, QWEN38);
    check('SP10a', res.temperature === 0.05, 'il valore esplicito vince sul default di famiglia');
    check('SP10b', res.top_p === 0.8, 'il preset creatività vince sul default di famiglia');
    check('SP10c', res.top_k === 20, 'i parametri non coperti dal preset restano quelli di famiglia');
  }

  // Test 11: Profilo letto dal file di configurazione JSON sopra la tabella interna
  {
    __setSamplingProfileLookupForTest((model, mode) =>
      model.toLowerCase().includes('qwen3.8') && mode === 'thinking' ? { temperature: 0.55 } : undefined
    );
    const res = resolveFamilySamplingParams(QWEN38);
    check('SP11a', res.temperature === 0.55, 'samplingProfiles del config sovrascrive la tabella interna');
    check('SP11b', res.top_p === 0.95, 'i parametri non ridefiniti nel config restano quelli della tabella');

    __setSamplingProfileLookupForTest((model) =>
      model === 'modello-esotico' ? { temperature: 0.33, top_k: 42 } : undefined
    );
    const custom = resolveSamplingParams(undefined, 'modello-esotico');
    check(
      'SP11c',
      custom.temperature === 0.33 && custom.top_k === 42,
      'il config assegna parametri anche a un modello assente dalla tabella'
    );
    __setSamplingProfileLookupForTest(undefined);
  }

  // Test 12: Inoltro dei parametri estesi nella richiesta HTTP
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', QWEN38);
    const capturedParams: any[] = [];
    (provider as any).client.chat.completions.create = async (params: any) => {
      capturedParams.push(params);
      return {
        choices: [{ message: { content: 'ok' } }],
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 }
      };
    };

    await provider.chatWithTools([{ role: 'user', content: 'ciao' }]);

    check('SP12a', capturedParams[0]?.temperature === 1.0, 'LLMProvider inoltra temperature: 1.0 per Qwen3.8');
    check('SP12b', capturedParams[0]?.top_k === 20, 'LLMProvider inoltra top_k: 20 nel body della richiesta');
    check('SP12c', capturedParams[0]?.min_p === 0, 'LLMProvider inoltra min_p: 0.0 nel body della richiesta');
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test sampling params:', err);
  process.exit(1);
});
