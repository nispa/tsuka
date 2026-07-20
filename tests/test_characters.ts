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
  console.log("=== Testing Character Preset System ===");
  const registry = await createDefaultRegistry();
  
  const charsDir = path.resolve(process.cwd(), 'characters');
  const files = fs.readdirSync(charsDir);
  const characters = files.filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));
  
  for (const cName of characters) {
    const char = loadCharacter(cName);
    const role = loadRole(char.role);
    const trait = loadTrait(char.trait);
    
    console.log(`\nPersonaggio Preset: ${char.displayName}`);
    console.log(`- Nome Primario LLM:  ${char.aiName}`);
    console.log(`- Descrizione:        ${char.description}`);
    console.log(`- Ruolo Collegato:    ${role.displayName} [Tool: ${role.allowedTools.length}]`);
    console.log(`- Tratto Collegato:   ${trait.displayName}`);
  }
}

run().catch(console.error);
