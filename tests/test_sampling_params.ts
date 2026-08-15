import { resolveSamplingParams, LLMProvider } from '../src/core/provider';
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

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test sampling params:', err);
  process.exit(1);
});
