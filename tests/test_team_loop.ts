/**
 * Test unitari per il loop di completamento del /team.
 * Esecuzione: npx tsx tests/test_team_loop.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { hasCompletionMarker, hasUnanimousApproval } from '../src/cli/commands/team';
import { ConfigManager } from '../src/core/config';
import { Agent } from '../src/core/agent';
import { ToolRegistry } from '../src/tools/registry';
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

async function main() {
  console.log('=== Test loop completamento /team ===\n');

  // --- hasCompletionMarker ---
  check('TM.1a', hasCompletionMarker([
    { role: 'user', content: 'lavora' },
    { role: 'assistant', content: 'Ho finito tutto.\nSTATUS: COMPLETED' }
  ]), 'marker COMPLETED rilevato in messaggio assistant');

  check('TM.1b', !hasCompletionMarker([
    { role: 'assistant', content: 'Ho fatto una parte.\nSTATUS: CONTINUE' }
  ]), 'CONTINUE non è completamento');

  check('TM.1c', !hasCompletionMarker([
    { role: 'tool', content: 'output che contiene STATUS: COMPLETED per caso' },
    { role: 'assistant', content: null, tool_calls: [{}] }
  ]), 'marker in messaggi tool/content null ignorati');

  check('TM.1d', hasCompletionMarker([
    { role: 'assistant', content: 'status: completed' }
  ]), 'marker case-insensitive');

  check('TM.1e', !hasCompletionMarker([
    { role: 'assistant', content: 'Non scriverò STATUS: COMPLETED finché non ho verificato i file.' }
  ]), 'citazione a metà frase non è una dichiarazione (marker richiesto a inizio riga)');

  check('TM.1f', hasCompletionMarker([
    { role: 'assistant', content: 'Verificato con i tool.\n  STATUS: COMPLETED' }
  ]), 'marker a inizio riga con indentazione rilevato');

  // Verify defaults independently of the maintainer's active configuration.
  const previousHome = process.env.TSUKA_HOME;
  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-team-config-'));
  process.env.TSUKA_HOME = testHome;
  const configPath = path.join(testHome, 'tsuka.config.json');
  fs.copyFileSync(path.resolve('providers.json'), path.join(testHome, 'providers.json'));
  try {
    const cfgDefault = new ConfigManager();
    check('TM.2a', cfgDefault.getTeamMaxRounds() === 3, `default is 3 (received ${cfgDefault.getTeamMaxRounds()})`);
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cfg.teamMaxRounds = 5;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
    check('TM.2b', new ConfigManager().getTeamMaxRounds() === 5, 'custom configured value is respected');
  } finally {
    if (previousHome === undefined) delete process.env.TSUKA_HOME;
    else process.env.TSUKA_HOME = previousHome;
    fs.rmSync(testHome, { recursive: true, force: true });
  }

  // --- Robustezza estrazione messaggi post-turno (bug slice dopo pruning) ---
  const registry = new ToolRegistry();
  const fakeProvider: any = { getCurrentModel: () => 'test-9b' };
  const agent = new Agent(fakeProvider, registry, new PermissionManager(), 'system', undefined, 6);
  const msgs = agent.getMessages();
  for (let i = 0; i < 20; i++) {
    msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg ${i}` } as any);
  }
  const lastSeeded = msgs[msgs.length - 1];
  agent.pruneHistory();
  const afterPrune = agent.getMessages();
  check('TM.3a', afterPrune.indexOf(lastSeeded) === afterPrune.length - 1,
    'ultimo messaggio seminato sempre rintracciabile dopo pruning (indexOf)');
  check('TM.3b', afterPrune.slice(afterPrune.indexOf(lastSeeded) + 1).length === 0,
    'slice post-seme vuota prima del run (invariante corretta)');

  // --- hasUnanimousApproval ---
  check('TM.4a', hasUnanimousApproval([
    { role: 'user', content: 'Bene. VOTE: APPROVE' },
    { role: 'user', content: 'OK. VOTE: APPROVE' },
  ]), 'tutti approvano → true');

  check('TM.4b', !hasUnanimousApproval([
    { role: 'user', content: 'Bene. VOTE: APPROVE' },
    { role: 'user', content: 'No. VOTE: REVISE' },
  ]), 'un modificare → false');

  check('TM.4c', !hasUnanimousApproval([
    { role: 'assistant', content: 'VOTE: APPROVE' },
  ]), 'solo assistant ignorato (deve essere user)');

  check('TM.4d', hasUnanimousApproval([
    { role: 'user', content: 'Lavoro fatto. VOTE: APPROVE\nAltro testo' },
    { role: 'user', content: 'voto: approvo' },
  ]), 'case-insensitive');

  check('TM.4e', !hasUnanimousApproval([
    { role: 'user', content: 'nessun voto qui' },
    { role: 'user', content: 'neanche qui' },
  ]), 'nessun voto → false');

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
