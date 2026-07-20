import { createDefaultRegistry } from '../src/tools/index';
import * as fs from 'fs';
import * as path from 'path';

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
  console.log("=== Testing Multi-Agent Discussion Call ===");
  
  const names = ["lola", "salvo", "pippo"];
  const participants = [];
  
  // Rileva personaggi
  for (const n of names) {
    const char = loadCharacter(n === "lola" ? "sensual_diva" : n);
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
