/**
 * Test unitari per l'interruzione utente (Esc/Ctrl+X) nel ciclo agentico.
 * Esecuzione: npx tsx tests/test_interrupt.ts
 */
import { Agent } from '../src/core/agent';
import { PermissionManager } from '../src/safety/permissions';

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

function makeAgent(provider: any, registry: any): Agent {
  return new Agent(provider, registry, new PermissionManager(), 'system di test');
}

async function main() {
  console.log('=== Test interruzione generazione ===\n');

  // --- INT.1: segnale già abortito prima del run → uscita immediata, nessuna chiamata LLM ---
  {
    let llmCalls = 0;
    const provider: any = {
      getCurrentModel: () => 'fake',
      chatWithTools: async () => { llmCalls++; return { content: 'mai' }; },
    };
    const registry: any = { listForLLM: () => [], executeTool: async () => ({ success: true, output: 'ok' }) };
    const agent = makeAgent(provider, registry);

    const controller = new AbortController();
    controller.abort();
    const result = await agent.run('ciao', undefined, undefined, () => {}, controller.signal);

    check('INT.1a', llmCalls === 0, 'nessuna chiamata LLM con segnale già abortito');
    check('INT.1b', result === '', 'risposta vuota, nessuna eccezione');
  }

  // --- INT.2: abort durante l'esecuzione del primo tool → il secondo non viene eseguito,
  //            ma ogni tool_call riceve la sua risposta 'tool' (cronologia coerente) ---
  {
    let llmCalls = 0;
    let toolExecutions = 0;
    const controller = new AbortController();

    const provider: any = {
      getCurrentModel: () => 'fake',
      chatWithTools: async () => {
        llmCalls++;
        if (llmCalls === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 'tc-1', type: 'function', function: { name: 'tool_uno', arguments: '{}' } },
              { id: 'tc-2', type: 'function', function: { name: 'tool_due', arguments: '{}' } },
            ],
          };
        }
        return { content: 'seconda chiamata (non deve avvenire)' };
      },
    };
    const registry: any = {
      listForLLM: () => [{ type: 'function', function: { name: 'tool_uno' } }],
      executeTool: async () => {
        toolExecutions++;
        controller.abort(); // simula Esc premuto mentre il primo tool lavora
        return { success: true, output: 'output primo tool' };
      },
    };
    const agent = makeAgent(provider, registry);
    await agent.run('vai', undefined, undefined, () => {}, controller.signal);

    const messages = agent.getMessages();
    const toolMsgs = messages.filter((m) => m.role === 'tool');
    const assistantWithCalls: any = messages.find((m: any) => m.tool_calls);

    check('INT.2a', llmCalls === 1, 'nessuna seconda chiamata LLM dopo l\'abort');
    check('INT.2b', toolExecutions === 1, 'il secondo tool non viene eseguito');
    check('INT.2c', toolMsgs.length === 2, 'entrambi i tool_call hanno la loro risposta tool');
    check('INT.2d',
      assistantWithCalls?.tool_calls.every((tc: any) => toolMsgs.some((tm: any) => tm.tool_call_id === tc.id)),
      'nessun tool_call orfano in cronologia');
    check('INT.2e',
      String(toolMsgs[1].content).includes('interrotta'),
      'il tool saltato ha la risposta sintetica di annullamento');
  }

  // --- INT.3: run normale senza abort → invariato ---
  {
    const provider: any = {
      getCurrentModel: () => 'fake',
      chatWithTools: async () => ({ content: 'risposta normale' }),
    };
    const registry: any = { listForLLM: () => [], executeTool: async () => ({ success: true, output: 'ok' }) };
    const agent = makeAgent(provider, registry);
    const controller = new AbortController();
    const result = await agent.run('ciao', undefined, undefined, () => {}, controller.signal);
    check('INT.3', result === 'risposta normale', 'flusso normale invariato con segnale non abortito');
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
