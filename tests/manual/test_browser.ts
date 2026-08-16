import { createDefaultRegistry } from '../src/tools/index';
import { PermissionManager } from '../src/safety/permissions';

async function run() {
  console.log("=== Testing Browser Tool ===");
  const registry = await createDefaultRegistry();
  const pm = new PermissionManager(); // browse_url è SAFE, quindi auto-approvato

  const url = "https://nodejs.org/en/about";
  console.log(`Visito l'URL: "${url}"...`);
  
  const result = await registry.executeTool('browse_url', { url }, pm);
  console.log("\nTesto Markdown estratto:");
  console.log(result.output);
}

run().catch(console.error);
