import { createDefaultRegistry } from '../src/tools/index';
import * as fs from 'fs';
import * as path from 'path';

function loadCharacter(charName: string) {
  const charPath = path.resolve(process.cwd(), `characters/${charName}.json`);
  const raw = fs.readFileSync(charPath, 'utf-8');
  return JSON.parse(raw);
}

/** Personaggi installati, letti live dal catalogo: nessun nome scritto nel test. */
function listCharacters(): any[] {
  const dir = path.resolve(process.cwd(), 'characters');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

/** Nome del personaggio che esercita un mestiere (ruolo attivo o skill sbloccata). */
function agentWithRole(role: string): string {
  const found = listCharacters().find(
    (c) => c.role === role || (Array.isArray(c.roles) && c.roles.includes(role))
  );
  if (!found) throw new Error(`Nessun personaggio copre il ruolo '${role}'`);
  return found.name;
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
  console.log("=== Testing Multi-Agent Discussion Call ===");
  
  // Dibattito fra tre MESTIERI diversi: chi li interpreta lo decide il catalogo.
  const names = ['entertainer', 'researcher', 'security_auditor'].map(agentWithRole);
  const participants = [];
  
  // Rileva personaggi
  for (const n of names) {
    const char = loadCharacter(n);
    participants.push(char);
  }
  
  console.log(`\nDibattito tra: ${participants.map(p => p.aiName).join(', ')}`);
  
  const topic = "Dovremmo configurare un server locale lasciando la porta 22 aperta all'esterno?";
  console.log(`Tema: "${topic}"\n`);
  
  // Simuliamo il primo round per ogni partecipante
  for (const p of participants) {
    const role = loadRole(p.role);
    const trait = loadTrait(p.trait);
    
    console.log(`[Turno di: ${p.aiName}]`);
    console.log(`- Attitudine: ${trait.displayName}`);
    console.log(`- Ruolo:      ${role.displayName}`);
    
    let sysPrompt = `Sei ${p.aiName}. ` + role.systemPrompt + `\nStile: ` + trait.prompt;
    sysPrompt += `\n[CONTESTO]: Stai partecipando ad una chiamata di gruppo sul tema "${topic}".`;
    
    console.log(`- Prompt generato (estratto):\n  "${sysPrompt.split('\n')[0]}"\n  "${sysPrompt.split('\n')[1]}"`);
    console.log(`--------------------------------------------------`);
  }
}

run().catch(console.error);
