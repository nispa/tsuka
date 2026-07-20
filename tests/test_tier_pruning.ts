import { getModelTier } from '../src/tools/registry';
import { createDefaultRegistry } from '../src/tools/index';

async function run() {
  console.log("=== Testing Model-Adaptive Tool Selection ===");
  
  const models = [
    "satgeze/qwenpaw-9b-heretic-1m:latest", // 9B -> 'small'
    "gemma4:26b",                            // 26B -> 'medium'
    "meta-llama/llama-3.3-70b-instruct"      // 70B -> 'large'
  ];

  const registry = await createDefaultRegistry();

  for (const m of models) {
    const tier = getModelTier(m);
    const tools = registry.listForLLM(m);
    console.log(`\nModello: "${m}"`);
    console.log(`- Tier rilevato: ${tier.toUpperCase()}`);
    console.log(`- Numero tool attivati: ${tools.length}`);
    console.log(`- Elenco tool: ${tools.map(t => t.function.name).join(', ')}`);
  }
}

run().catch(console.error);
