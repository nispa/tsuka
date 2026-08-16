import assert from 'node:assert/strict';
import { calculateReasoningBudget } from '../src/core/contextBudget';
import { MockLLMProvider } from './mocks/mockProvider';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { Agent } from '../src/core/agent';

export async function runReasoningBudgetTests(): Promise<void> {
  // Test 1: Spazio abbondante (> 55% libero) -> nessun throttling
  {
    const budget = calculateReasoningBudget(5000, 32768, 'xhigh');
    assert.equal(budget.effectiveEffort, 'xhigh');
    assert.equal(budget.concisionRequired, false);
    assert.ok(budget.maxReasoningTokens >= 4000);
    assert.ok(budget.freeContextPercent > 55);
  }

  // Test 2: Spazio medio (30% - 55% libero) -> xhigh ridotto a medium, concisione richiesta
  {
    const budget = calculateReasoningBudget(18000, 32768, 'xhigh');
    assert.equal(budget.effectiveEffort, 'medium');
    assert.equal(budget.concisionRequired, true);
    assert.ok(budget.freeContextPercent >= 30 && budget.freeContextPercent <= 55);
  }

  // Test 3: Spazio critico (< 30% libero) -> throttling a low / none
  {
    const budget = calculateReasoningBudget(28000, 32768, 'xhigh');
    assert.equal(budget.effectiveEffort, 'low');
    assert.equal(budget.concisionRequired, true);
  }

  // Test 4: Spazio quasi esaurito (< 15% libero) -> throttling forzato a none
  {
    const budget = calculateReasoningBudget(30000, 32768, 'xhigh');
    assert.equal(budget.effectiveEffort, 'none');
    assert.equal(budget.concisionRequired, true);
  }

  // Test 5: CoT Recovery in Agent.run() — retry dopo think senza tool usa effort 'none'
  {
    const mock = new MockLLMProvider([
      // Round 1: Solo pensiero, nessun tool_call, testo non accettabile
      {
        content: 'Sto solo pensando...',
        toolCalls: [],
        reasoningText: 'Analisi preliminare completata in 500 token.'
      },
      // Round 2: Tool call emessa
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ path: 'out.txt', content: 'hello' })
            }
          }
        ]
      },
      // Round 3: Chiusura
      {
        content: 'STATO: COMPLETATO\nFile scritto.',
        toolCalls: []
      }
    ]);

    const registry = new ToolRegistry();
    const pm = new PermissionManager();
    // AcceptTextOnlyIf richiede marker di stato o tool
    const acceptTextOnlyIf = (text: string) => text.includes('STATO: COMPLETATO');
    const agent = new Agent(mock as any, registry, pm, 'system prompt', ['write_file'], 500, 32768, 'test-agent', 'xhigh', acceptTextOnlyIf);

    await agent.run('crea out.txt');

    // Verifichiamo che la seconda chiamata sia passata a effort 'none' (CoT recovery)
    assert.equal(mock.callLog.length, 3);
    const round2Options = mock.callLog[1].options;
    assert.equal(round2Options?.reasoningEffort, 'none', 'Il round di recovery dopo il think deve usare effort none');
  }
}

if (process.argv[1]?.endsWith('test_reasoning_budget.ts')) {
  runReasoningBudgetTests().then(() => {
    console.log('5 passati');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
