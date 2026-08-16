import { LLMProvider } from '../src/core/provider';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
  console.log("=== Test di connessione Ollama ===");
  const provider = new LLMProvider(
    process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
    process.env.LLM_API_KEY || 'ollama',
    process.env.LLM_MODEL || 'satgeze/qwenpaw-9b-heretic-1m:latest'
  );

  console.log("1. Caricamento della lista dei modelli...");
  const models = await provider.listModels();
  console.log("Modelli trovati:", models);

  if (models.length === 0) {
    console.log("Attenzione: nessun modello installato.");
    return;
  }

  const modelToTest = provider.getCurrentModel();
  console.log(`2. Invio di una richiesta di test al modello '${modelToTest}'...`);
  
  const response = await provider.chat([
    { role: 'user', content: 'Rispondi in tre parole: ti senti pronto?' }
  ]);
  console.log("Risposta del modello:", response);
}

test().catch(console.error);
