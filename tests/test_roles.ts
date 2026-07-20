import { createDefaultRegistry } from '../src/tools/index';
import * as fs from 'fs';
import * as path from 'path';

function loadRole(roleName: string) {
  const rolePath = path.resolve(process.cwd(), `roles/${roleName}.json`);
  const raw = fs.readFileSync(rolePath, 'utf-8');
  return JSON.parse(raw);
}

async function run() {
  console.log("=== Testing Persona-based Agent Roles ===");
  const registry = await createDefaultRegistry();
  
  const rolesDir = path.resolve(process.cwd(), 'roles');
  const files = fs.readdirSync(rolesDir);
  const roles = files.filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));
  
  for (const rName of roles) {
    const role = loadRole(rName);
    console.log(`\nRuolo: ${role.displayName}`);
    console.log(`- Descrizione: ${role.description}`);
    console.log(`- Istruzioni Prompt: "${role.systemPrompt}"`);
    
    // Simula modello 9B (SMALL)
    const smallTools = registry.listForLLM("satgeze/qwenpaw-9b-heretic-1m:latest", role.allowedTools);
    console.log(`  └─ Modello SMALL (9B) -> ${smallTools.length} tool: ${smallTools.map(t => t.function.name).join(', ')}`);
    
    // Simula modello 26B (MEDIUM)
    const medTools = registry.listForLLM("gemma4:26b", role.allowedTools);
    console.log(`  └─ Modello MEDIUM (26B) -> ${medTools.length} tool: ${medTools.map(t => t.function.name).join(', ')}`);
  }
}

run().catch(console.error);
