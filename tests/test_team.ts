/**
 * Test per il caricamento e la configurazione iniziale dei Team (/team).
 * Esecuzione: npx tsx tests/test_team.ts
 */
import { loadTeam, loadCharacter, loadRole, loadTrait } from '../src/cli/shared';
import * as fs from 'fs';
import * as path from 'path';

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

async function run() {
  console.log('=== Test Caricamento Team (/team) ===\n');

  const teamsDir = path.resolve(process.cwd(), 'teams');
  const teamFiles = fs.readdirSync(teamsDir).filter((f) => f.endsWith('.json'));

  check('TEAM.1', teamFiles.length > 0, 'Almeno un team configurato presente nella cartella teams/');

  for (const f of teamFiles) {
    const teamName = path.basename(f, '.json');
    const team = loadTeam(teamName);
    check(`TEAM.2.${teamName}`, !!team.displayName && Array.isArray(team.members) && team.members.length > 0, `Team '${teamName}' valido con membri configurati`);

    for (const m of team.members) {
      const char = loadCharacter(m);
      check(`TEAM.3.${teamName}.${m}`, !!char && !!char.role && !!char.trait, `Membro '${m}' del team '${teamName}' risolto correttamente`);
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
