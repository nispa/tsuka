import { createDefaultRegistry } from '../src/tools/index';
import * as fs from 'fs';
import * as path from 'path';

function loadTeam(teamName: string) {
  const teamPath = path.resolve(process.cwd(), `teams/${teamName}.json`);
  const raw = fs.readFileSync(teamPath, 'utf-8');
  return JSON.parse(raw);
}

function loadCharacter(charName: string) {
  const charPath = path.resolve(process.cwd(), `characters/${charName}.json`);
  const raw = fs.readFileSync(charPath, 'utf-8');
  return JSON.parse(raw);
}

function loadRole(roleName: string) {
  const rolePath = path.resolve(process.cwd(), `roles/${roleName}.json`);
  const raw = fs.readFileSync(rolePath, 'utf-8');
  return JSON.parse(raw);
}

function loadTrait(traitName: string) {
  const traitPath = path.resolve(process.cwd(), `traits/${traitName}.json`);
  const raw = fs.readFileSync(traitPath, 'utf-8');
  return JSON.parse(raw);
}

async function run() {
  console.log("=== Testing Collaborative Team Workflow ===");
  const registry = await createDefaultRegistry();
  
  // Primo team installato: il file è dati dell'utente, il test non ne fissa il nome.
  const teamName = fs.readdirSync(path.resolve(process.cwd(), 'teams'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.basename(f, '.json'))[0];
  const team = loadTeam(teamName);
  console.log(`\nTeam caricato: ${team.displayName}`);
  console.log(`- Descrizione: ${team.description}`);
  console.log(`- Membri ordinati: ${team.members.join(', ')}`);
  
  const task = "Esegui un controllo delle porte attive ed evidenzia potenziali falle.";
  console.log(`Compito assegnato: "${task}"`);
  
  // Simuliamo il passaggio di messaggi condiviso
  const teamMessages = [
    { role: 'system', content: '' },
    { role: 'user', content: `COMPITO: "${task}"` }
  ];
  
  for (const mName of team.members) {
    const char = loadCharacter(mName);
    const role = loadRole(char.role);
    const trait = loadTrait(char.trait);
    
    console.log(`\n>> Turno di: ${char.displayName}`);
    console.log(`- Tool abilitati nel registro per questo turno: ${role.allowedTools.join(', ')}`);
    
    // Simula l'unione dei messaggi precedenti
    const historyLengthBefore = teamMessages.length;
    console.log(`- Storico ereditato (numero messaggi): ${historyLengthBefore - 1}`);
    
    // Simula risposta finale del turno
    const responseMock = `${char.aiName}: "Ho eseguito il mio compito ed elaborato i dettagli per il prossimo turno."`;
    teamMessages.push({ role: 'user', content: responseMock });
  }
  
  console.log(`\nTrascrizione finale nello storico condiviso:`);
  console.log(JSON.stringify(teamMessages, null, 2));
}

run().catch(console.error);
