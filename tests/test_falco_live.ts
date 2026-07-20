/**
 * Validazione live: Falco deve usare browse_url per controllare un sito.
 * Esecuzione: npx tsx tests/test_falco_live.ts  (richiede Ollama attivo)
 */
import { LLMProvider } from '../src/core/provider';
import { createDefaultRegistry } from '../src/tools/index';
import { PermissionManager } from '../src/safety/permissions';
import { Agent } from '../src/core/agent';
import { loadCharacter, loadRole, loadTrait, loadSystemPrompt } from '../src/cli/shared';

async function main() {
  console.log('=== Test live: Falco controlla un sito web ===\n');

  const provider = new LLMProvider('http://localhost:11434/v1', 'ollama', 'satgeze/qwenpaw-9b-heretic-1m:latest');
  const registry = await createDefaultRegistry();
  const permissionManager = new PermissionManager();

  const char = loadCharacter('falco')!;
  const role = loadRole(char.role);
  const trait = loadTrait(char.trait);
  const sysPrompt = loadSystemPrompt(role, trait, provider.getCurrentModel(), registry, char);

  const agent = new Agent(provider, registry, permissionManager, sysPrompt, role.allowedTools, 40);

  console.log(`Personaggio: ${char.displayName} | Ruolo: ${role.name}`);
  console.log(`Tool concessi: ${role.allowedTools.join(', ')}\n`);

  let browseUrlCalled = false;
  const originalExecute = registry.executeTool.bind(registry);
  (registry as any).executeTool = async (name: string, args: any, pm: any) => {
    if (name === 'browse_url') browseUrlCalled = true;
    console.log(`   → tool chiamato: ${name}(${JSON.stringify(args).slice(0, 80)})`);
    return originalExecute(name, args, pm);
  };

  const answer = await agent.run(
    'Controlla il sito https://example.com e dimmi cosa contiene.',
    () => {},
    () => {}
  );

  console.log('\n--- Esito ---');
  console.log('browse_url usato:', browseUrlCalled ? 'SÌ ✔' : 'NO ✘');
  console.log('Risposta (prime 200 char):', answer.slice(0, 200));

  process.exit(browseUrlCalled ? 0 : 1);
}

main().catch((err) => {
  console.error('Errore:', err.message);
  process.exit(1);
});
