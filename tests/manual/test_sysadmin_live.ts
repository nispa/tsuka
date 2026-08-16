/**
 * Validazione live: l'agente con il mestiere 'sysadmin' deve usare browse_url
 * per controllare un sito. Il personaggio è risolto per RUOLO, non per nome:
 * il test resta valido se il roster viene rinominato.
 * Esecuzione: npx tsx tests/test_sysadmin_live.ts  (richiede Ollama attivo)
 */
import { LLMProvider } from '../src/core/provider';
import { createDefaultRegistry } from '../src/tools/index';
import { PermissionManager } from '../src/safety/permissions';
import { Agent } from '../src/core/agent';
import { resolveCharacter, loadRole, loadTrait, loadSystemPrompt } from '../src/cli/shared';

async function main() {
  console.log('=== Test live: il sysadmin controlla un sito web ===\n');

  const provider = new LLMProvider('http://localhost:11434/v1', 'ollama', 'satgeze/qwenpaw-9b-heretic-1m:latest');
  const registry = await createDefaultRegistry();
  const permissionManager = new PermissionManager();

  const char = resolveCharacter('sysadmin');
  if (!char) {
    console.error("Nessun personaggio con il ruolo 'sysadmin' nel catalogo installato.");
    process.exit(1);
  }
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
