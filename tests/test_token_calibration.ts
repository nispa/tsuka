/**
 * Test per la calibrazione dinamica della stima token (T5.1, PLANNING-QUALITA.md).
 * Agent.estimateTokens/estimateMessagesTokens usavano un rapporto fisso di
 * 3,5 caratteri/token (tarato sull'inglese). Ora il rapporto parte da quel seed
 * ma si aggiorna con una media mobile verso il rapporto realmente osservato
 * (chars inviati / usage.prompt_tokens reale dell'API) dopo ogni risposta.
 * Esecuzione: npx tsx tests/test_token_calibration.ts
 */
import './isolateMemory';
import { Agent } from '../src/core/agent';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { MockLLMProvider } from './mocks/mockProvider';

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
  console.log('=== Test Calibrazione Stima Token ===\n');

  // --- C1: senza osservazioni, il rapporto di default è il seed storico 3,5 ---
  {
    const agent = new Agent(new MockLLMProvider([]), new ToolRegistry(), new PermissionManager(), 'sys');
    check('C1', agent.getCharsPerTokenRatio() === 3.5, 'ratio di default 3,5 prima di qualunque osservazione');
  }

  // --- C2: senza osservazioni, la stima corrisponde esattamente alla vecchia formula fissa (compatibilità) ---
  {
    const agent = new Agent(new MockLLMProvider([]), new ToolRegistry(), new PermissionManager(), 'sys');
    const msgs = [{ content: 'a'.repeat(35) }];
    check(
      'C2',
      agent.estimateMessagesTokens(msgs) === Math.ceil(35 / 3.5),
      'stima invariata rispetto alla vecchia formula quando non ci sono osservazioni'
    );
  }

  // --- C3: promptTokens assente/zero non genera un'osservazione spuria ---
  {
    const provider = new MockLLMProvider([{ content: 'ok', stats: { promptTokens: 0 } }]);
    const agent = new Agent(provider, new ToolRegistry(), new PermissionManager(), 'sys');
    await agent.run('ciao');
    check('C3', agent.getCharsPerTokenRatio() === 3.5, 'promptTokens 0/assente lascia il rapporto invariato');
  }

  // --- C4/C5: convergenza verso un rapporto osservato costantemente diverso dal seed ---
  {
    const SYSTEM = 'sys';
    const USER_MSG = 'ping';
    const ASSIST_MSG = 'pong';
    const TARGET_RATIO = 5.0; // rapporto "vero" simulato, diverso dal seed 3.5
    const rounds = 20;

    const script: Array<{ content: string; stats: { promptTokens: number } }> = [];
    let histChars = SYSTEM.length;
    for (let i = 0; i < rounds; i++) {
      histChars += USER_MSG.length; // Agent.run() pusha lo user message prima di chiamare il provider
      script.push({ content: ASSIST_MSG, stats: { promptTokens: histChars / TARGET_RATIO } });
      histChars += ASSIST_MSG.length; // l'assistant viene pushato dopo: conta per il round successivo
    }

    const provider = new MockLLMProvider(script);
    const agent = new Agent(provider, new ToolRegistry(), new PermissionManager(), SYSTEM);

    for (let i = 0; i < rounds; i++) {
      await agent.run(USER_MSG);
    }

    const finalRatio = agent.getCharsPerTokenRatio();
    check(
      'C4',
      Math.abs(finalRatio - TARGET_RATIO) < 0.1,
      `dopo ${rounds} osservazioni costanti il rapporto converge verso quello osservato (atteso ~${TARGET_RATIO}, ottenuto ${finalRatio.toFixed(4)})`
    );
    check('C5', finalRatio > 3.5, 'il rapporto si è mosso nella direzione corretta rispetto al seed iniziale (3.5 → ~5.0)');
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
