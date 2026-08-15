/**
 * Test unitari per il loop di completamento del /team.
 * Esecuzione: npx tsx tests/test_team_loop.ts
 */
import * as fs from 'fs';
import * as path from 'path';
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
    { role: 'assistant', content: 'Ho finito tutto.\nSTATO: COMPLETATO' }
  ]), 'marker COMPLETATO rilevato in messaggio assistant');

  check('TM.1b', !hasCompletionMarker([
    { role: 'assistant', content: 'Ho fatto una parte.\nSTATO: DA_CONTINUARE' }
  ]), 'DA_CONTINUARE non è completamento');

  check('TM.1c', !hasCompletionMarker([
    { role: 'tool', content: 'output che contiene STATO: COMPLETATO per caso' },
    { role: 'assistant', content: null, tool_calls: [{}] }
  ]), 'marker in messaggi tool/content null ignorati');

  check('TM.1d', hasCompletionMarker([
    { role: 'assistant', content: 'stato: completato' }
  ]), 'marker case-insensitive');

  check('TM.1e', !hasCompletionMarker([
    { role: 'assistant', content: 'Non scriverò STATO: COMPLETATO finché non ho verificato i file.' }
  ]), 'citazione a metà frase non è una dichiarazione (marker richiesto a inizio riga)');

  check('TM.1f', hasCompletionMarker([
    { role: 'assistant', content: 'Verificato con i tool.\n  STATO: COMPLETATO' }
  ]), 'marker a inizio riga con indentazione rilevato');

  // --- getTeamMaxRounds ---
  const configPath = path.resolve(process.cwd(), 'tsuka.config.json');
  const backup = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null;
  try {
    new ConfigManager(); // assicura esistenza
    const cfgDefault = new ConfigManager();
    check('TM.2a', cfgDefault.getTeamMaxRounds() === 3, `default 3 (ottenuto ${cfgDefault.getTeamMaxRounds()})`);

    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cfg.teamMaxRounds = 5;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
    check('TM.2b', new ConfigManager().getTeamMaxRounds() === 5, 'valore custom da config rispettato');
  } finally {
    if (backup !== null) fs.writeFileSync(configPath, backup, 'utf-8');
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
    { role: 'user', content: 'Bene. VOTO: APPROVO' },
    { role: 'user', content: 'OK. VOTO: APPROVO' },
  ]), 'tutti approvano → true');

  check('TM.4b', !hasUnanimousApproval([
    { role: 'user', content: 'Bene. VOTO: APPROVO' },
    { role: 'user', content: 'No. VOTO: MODIFICARE' },
  ]), 'un modificare → false');

  check('TM.4c', !hasUnanimousApproval([
    { role: 'assistant', content: 'VOTO: APPROVO' },
  ]), 'solo assistant ignorato (deve essere user)');

  check('TM.4d', hasUnanimousApproval([
    { role: 'user', content: 'Lavoro fatto. VOTO: APPROVO\nAltro testo' },
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
