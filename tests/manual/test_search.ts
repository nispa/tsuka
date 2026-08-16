import { createDefaultRegistry } from '../src/tools/index';
import { PermissionManager } from '../src/safety/permissions';

async function run() {
  console.log("=== Testing Web Search Tool ===");
  const registry = await createDefaultRegistry();
  const pm = new PermissionManager(); // web_search è SAFE, auto-approvato

  const query = "Node.js 22 release date";
  console.log(`Ricerca web per: "${query}"...`);
  
  const result = await registry.executeTool('web_search', { query }, pm);
  console.log("\nRisultati della ricerca:");
  console.log(result.output);
}

run().catch(console.error);
