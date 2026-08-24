import { WorkflowScope } from '../src/core/workflowScope';
import { ToolRegistry } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { requestGoalTool } from '../src/tools/impl/requestGoal';
import { requestTeamTool } from '../src/tools/impl/requestTeam';
import { requestCallTool } from '../src/tools/impl/requestCall';
import type { WorkflowDispatcher } from '../src/core/workflowDispatcher';

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
  console.log('=== Test Escalation Tools & Depth Guard (T13.1) ===\n');

  const pm = new PermissionManager();
  pm.setAllowAllWrite(true);

  const registry = new ToolRegistry();
  registry.register(requestGoalTool);
  registry.register(requestTeamTool);
  registry.register(requestCallTool);

  const dispatched: string[] = [];
  const dispatcher: WorkflowDispatcher = {
    runGoal: async (goal) => { dispatched.push(`goal:${goal}`); },
    runTeam: async (teamName, task) => { dispatched.push(`team:${teamName}:${task}`); },
    runCall: async (participants, topic) => { dispatched.push(`call:${participants.join(',')}:${topic}`); },
  };

  // 1. Verifica default WorkflowScope
  check('ESC.1', WorkflowScope.getDepth() === 0 && !WorkflowScope.isInsideWorkflow(), 'WorkflowScope default: depth 0 e isInsideWorkflow false');

  // 2. Verifica incremento e isolamento con withScope
  await WorkflowScope.withScope('goal', async () => {
    check('ESC.2', WorkflowScope.getDepth() === 1 && WorkflowScope.getCurrentType() === 'goal', 'withScope(goal): depth 1 e type goal');

    await WorkflowScope.withScope('team', async () => {
      check('ESC.3', WorkflowScope.getDepth() === 2 && WorkflowScope.getCurrentType() === 'team', 'withScope annidato: depth 2 e type team');
    });

    check('ESC.4', WorkflowScope.getDepth() === 1 && WorkflowScope.getCurrentType() === 'goal', 'Ritorno al contesto genitore: depth 1');
  });

  check('ESC.5', WorkflowScope.getDepth() === 0 && !WorkflowScope.isInsideWorkflow(), 'Uscita da withScope: depth torna a 0');

  // 3. listForLLM: visibilità condizionale dei tool
  const normalTools = registry.listForLLM('gpt-4o', ['request_goal', 'request_team', 'request_call']);
  check(
    'ESC.6',
    normalTools.some((t: any) => t.function.name === 'request_goal') &&
    normalTools.some((t: any) => t.function.name === 'request_team') &&
    normalTools.some((t: any) => t.function.name === 'request_call'),
    'In chat normale (depth 0), i tool di escalation sono visibili all\'LLM'
  );

  await WorkflowScope.withScope('goal', async () => {
    const insideTools = registry.listForLLM('gpt-4o', ['request_goal', 'request_team', 'request_call']);
    check(
      'ESC.7',
      insideTools.length === 0,
      'Dentro un workflow (depth 1), i tool di escalation vengono nascosti all\'LLM (Depth Guard)'
    );
  });

  // 4. Esecuzione request_goal con blocco anti-ricorsione
  const goalSuccess = await registry.executeTool('request_goal', {
    goal: 'Riscrivi architettura auth',
    reason: 'Task multidisciplinare con audit'
  }, pm, undefined, undefined, dispatcher);
  check('ESC.8', goalSuccess.success && /accepted|completed/i.test(goalSuccess.output), 'Esecuzione request_goal a depth 0 ha successo');

  let goalBlockedInside = false;
  await WorkflowScope.withScope('goal', async () => {
    const blockedRes = await registry.executeTool('request_goal', {
      goal: 'Altro goal annidato',
      reason: 'Test ricorsione'
    }, pm);
    goalBlockedInside = !blockedRes.success && (blockedRes.output.includes('ricorsivo') || blockedRes.output.includes('recursive'));
  });
  check('ESC.9', goalBlockedInside, 'Blocco anti-ricorsione: request_goal rifiutato se già dentro un workflow');

  // 5. Esecuzione request_team con blocco anti-ricorsione
  const teamSuccess = await registry.executeTool('request_team', {
    team_name: 'dev_security',
    task: 'Audit codice sorgente',
    reason: 'Verifica vulnerabilità'
  }, pm, undefined, undefined, dispatcher);
  check('ESC.10', teamSuccess.success && /accepted|completed/i.test(teamSuccess.output), 'Esecuzione request_team a depth 0 ha successo');

  let teamBlockedInside = false;
  await WorkflowScope.withScope('team', async () => {
    const blockedRes = await registry.executeTool('request_team', {
      task: 'Task team annidato',
      reason: 'Test ricorsione'
    }, pm);
    teamBlockedInside = !blockedRes.success && (blockedRes.output.includes('ricorsivo') || blockedRes.output.includes('recursive'));
  });
  check('ESC.11', teamBlockedInside, 'Blocco anti-ricorsione: request_team rifiutato se già dentro un workflow');

  // 6. Esecuzione request_call con blocco anti-ricorsione
  const callSuccess = await registry.executeTool('request_call', {
    participants: ['@geordi', '@spock'],
    topic: 'Valutazione pattern asincrono',
    reason: 'Brainstorming architetturale'
  }, pm, undefined, undefined, dispatcher);
  check('ESC.12', callSuccess.success && /accepted|finished/i.test(callSuccess.output), 'Esecuzione request_call a depth 0 ha successo');

  let callBlockedInside = false;
  await WorkflowScope.withScope('call', async () => {
    const blockedRes = await registry.executeTool('request_call', {
      participants: ['@geordi', '@spock'],
      topic: 'Altro topic',
      reason: 'Test ricorsione'
    }, pm);
    callBlockedInside = !blockedRes.success && (blockedRes.output.toLowerCase().includes('ricorsiv') || blockedRes.output.toLowerCase().includes('recursive'));
  });
  check('ESC.13', callBlockedInside, 'Blocco anti-ricorsione: request_call rifiutato se già dentro un workflow');

  check('ESC.14', dispatched.some((entry) => entry === 'goal:Riscrivi architettura auth'), 'request_goal delegates through WorkflowDispatcher');
  check('ESC.15', dispatched.some((entry) => entry === 'team:dev_security:Audit codice sorgente'), 'request_team delegates through WorkflowDispatcher');
  check('ESC.16', dispatched.some((entry) => entry === 'call:@geordi,@spock:Valutazione pattern asincrono'), 'request_call delegates through WorkflowDispatcher');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
