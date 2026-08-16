import { createDefaultRegistry } from '../src/tools/index';
import * as fs from 'fs';
import * as path from 'path';

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
  console.log("=== Testing Role-Trait Orthogonal Matrix ===");
  const registry = await createDefaultRegistry();
  
  const testMatrix = [
    { role: "sysadmin", trait: "devils_advocate" },
    { role: "developer", trait: "grumpy" }
  ];
  
  for (const item of testMatrix) {
    const role = loadRole(item.role);
    const trait = loadTrait(item.trait);
    console.log(`\nUnione: [${role.displayName}] + [${trait.displayName}]`);
    console.log(`- Istruzioni del Ruolo:  "${role.systemPrompt}"`);
    console.log(`- Stile dell'Attitudine: "${trait.prompt}"`);
    
    const tools = registry.listForLLM("gemma4:26b", role.allowedTools);
    console.log(`- Tool abilitati: ${tools.map(t => t.function.name).join(', ')}`);
  }
}

run().catch((err) => {
  console.error('Errore fatale in test_traits:', err);
  process.exit(1);
});
