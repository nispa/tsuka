/**
 * Test per MockLLMProvider (T1.1, PLANNING-QUALITA.md).
 * Verifica il mock stesso e l'accettazione del task: un Agent reale costruito con
 * il mock completa un ciclo ReAct a 2 round (tool call → tool result → risposta
 * finale) in modo deterministico, senza rete né LLM reale.
 * Esecuzione: npx tsx tests/test_mock_provider.ts
 */
import './isolateMemory';
import { Agent } from '../src/core/agent';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';

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
  console.log('=== Test MockLLMProvider ===\n');

  // --- M1: chatWithTools consuma il copione in ordine ---
  {
    const provider = new MockLLMProvider([
      { content: 'primo' },
      { content: 'secondo' }
    ]);
    const r1 = await provider.chatWithTools([{ role: 'user', content: 'ciao' }]);
    const r2 = await provider.chatWithTools([{ role: 'user', content: 'ciao' }]);
    check('M1', r1.content === 'primo' && r2.content === 'secondo', 'risposte consumate nell\'ordine dello script');
  }

  // --- M2: copione esaurito lancia un errore esplicito (non un fallback silenzioso) ---
  {
    const provider = new MockLLMProvider([{ content: 'unica' }]);
    await provider.chatWithTools([{ role: 'user', content: 'x' }]);
    let threw = false;
    try {
      await provider.chatWithTools([{ role: 'user', content: 'x' }]);
    } catch {
      threw = true;
    }
    check('M2', threw, 'seconda chiamata oltre il copione lancia errore esplicito');
  }

  // --- M3: callLog registra i messaggi ricevuti per ispezione post-hoc ---
  {
    const provider = new MockLLMProvider([{ content: 'ok' }]);
    await provider.chatWithTools([{ role: 'system', content: 'sys' }, { role: 'user', content: 'domanda' }]);
    check(
      'M3',
      provider.callLog.length === 1 && provider.callLog[0].messages[1].content === 'domanda',
      'callLog espone i messaggi della chiamata'
    );
  }

  // --- M4: getCurrentModel/setCurrentModel/getBaseUrl/listModels funzionano ---
  {
    const provider = new MockLLMProvider([], { model: 'test-model', baseUrl: 'mock://test' });
    provider.setCurrentModel('altro-modello');
    const models = await provider.listModels();
    check(
      'M4',
      provider.getCurrentModel() === 'altro-modello' &&
        provider.getBaseUrl() === 'mock://test' &&
        models.includes('altro-modello'),
      'metodi di stato del provider coerenti'
    );
  }

  // --- M5 (criterio di accettazione T1.1): Agent reale, ciclo ReAct a 2 round deterministico ---
  {
    const registry = new ToolRegistry();
    let toolExecuted = false;
    registry.register({
      name: 'echo_tool',
      riskLevel: 'SAFE',
      execute: async (args: { text: string }) => {
        toolExecuted = true;
        return `echo: ${args.text}`;
      }
    });

    const provider = new MockLLMProvider([
      // Round 1: il "modello" chiede di usare echo_tool
      { toolCalls: [mockToolCall('echo_tool', { text: 'ping' })] },
      // Round 2: dopo aver visto il risultato del tool, risponde con testo finale
      { content: 'Ho eseguito echo_tool, il risultato era "echo: ping".' }
    ]);

    const permissionManager = new PermissionManager();
    const agent = new Agent(provider, registry, permissionManager, 'Sei un agente di test.');

    const finalAnswer = await agent.run('esegui echo_tool con testo ping');

    check('M5a', toolExecuted, 'il tool richiesto dal mock è stato effettivamente eseguito da Agent');
    check(
      'M5b',
      finalAnswer.includes('echo: ping'),
      `Agent ha completato il ciclo a 2 round e restituito la risposta finale (ricevuto: "${finalAnswer}")`
    );
    check('M5c', provider.callLog.length === 2, `Agent ha effettuato esattamente 2 chiamate al provider (ricevute: ${provider.callLog.length})`);
    check(
      'M5d',
      provider.remaining === 0,
      'il copione è stato consumato interamente: nessun round in più o in meno rispetto all\'atteso'
    );

    // Il messaggio 'tool' nella history deve contenere l'output reale del tool eseguito,
    // non un placeholder: prova che il loop ReAct abbia davvero collegato tool_call ↔ risultato.
    const toolMsg = agent.getMessages().find((m) => m.role === 'tool');
    check(
      'M5e',
      !!toolMsg && typeof toolMsg.content === 'string' && toolMsg.content.includes('echo: ping'),
      'la history contiene il risultato reale del tool, correttamente agganciato al tool_call'
    );
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
