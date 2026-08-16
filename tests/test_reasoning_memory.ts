/**
 * Test della persistenza del reasoning (T9.12): un ragionamento lungo prodotto
 * dal modello — sia su un turno concluso con successo sia su uno interrotto da
 * un errore (timeout, JSON malformato) — va salvato su file invece di sparire,
 * con un puntatore corto nella memoria condivisa (kind 'run') che lo referenzia.
 *
 * Esecuzione: npx tsx tests/test_reasoning_memory.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

async function main() {
  console.log('=== Test persistenza reasoning (T9.12) ===\n');

  // Isola TSUKA_HOME PRIMA di qualunque import dinamico che calcoli percorsi al
  // load del modulo (stesso pattern di test_workspace_jail.ts/test_parallel_workspace.ts).
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-reasoning-home-'));
  process.env.TSUKA_HOME = tmpHome;
  process.env.TSUKA_MEMORY_FILE = path.join(tmpHome, 'memory', 'memory.json');

  const { Agent } = await import('../src/core/agent');
  const { ToolRegistry } = await import('../src/tools/registry');
  const { PermissionManager } = await import('../src/safety/permissions');
  const { MemoryStore } = await import('../src/core/memory');
  const { MockLLMProvider } = await import('./mocks/mockProvider');

  const thinkingDir = path.join(tmpHome, 'memory', 'thinking');
  const longReasoning = 'Ragiono passo passo su come strutturare il modulo. '.repeat(20); // >300 caratteri
  const shortReasoning = 'Penso brevemente.'; // sotto la soglia di persistenza

  // R1: turno concluso con successo e reasoning lungo → file + puntatore in memoria
  {
    const provider = new MockLLMProvider([
      { content: 'Fatto.', reasoningText: longReasoning }
    ]);
    const agent = new Agent(provider, new ToolRegistry(), new PermissionManager(), 'system', undefined, 20, 20000, 'Geordi');
    await agent.run('Scrivi il modulo core/levels.js');

    const files = fs.existsSync(thinkingDir) ? fs.readdirSync(thinkingDir) : [];
    check('R1a', files.length === 1, `un file di reasoning creato (${files.length})`);
    if (files.length === 1) {
      const content = fs.readFileSync(path.join(thinkingDir, files[0]), 'utf-8');
      check('R1b', content === longReasoning.trim(), 'il file contiene il reasoning completo, non troncato');
      check('R1c', files[0].includes('Geordi') && !files[0].includes('interrotto'), `nome file etichettato con l'agente, non marcato "interrotto" (${files[0]})`);
    }

    const store = MemoryStore.getInstance();
    const recent = store.getRecent(5);
    const pointer = recent.find((f) => f.content.includes('memory/thinking/'));
    check('R1d', !!pointer, 'un puntatore al file è stato salvato in memoria (kind run)');
    check('R1e', pointer?.kind === 'run', `puntatore salvato con kind 'run' (ricevuto: ${pointer?.kind})`);
    check('R1f', (pointer?.content.length ?? 0) <= 500, `il puntatore rispetta il tetto di 500 caratteri (${pointer?.content.length})`);
  }

  // R2: reasoning troppo corto → nessun file, nessun puntatore (non vale la pena)
  {
    fs.rmSync(thinkingDir, { recursive: true, force: true });
    MemoryStore.getInstance().clear();

    const provider = new MockLLMProvider([
      { content: 'Fatto.', reasoningText: shortReasoning }
    ]);
    const agent = new Agent(provider, new ToolRegistry(), new PermissionManager(), 'system', undefined, 20, 20000, 'Una');
    await agent.run('Task banale');

    const files = fs.existsSync(thinkingDir) ? fs.readdirSync(thinkingDir) : [];
    check('R2a', files.length === 0, 'reasoning troppo corto: nessun file creato');
    check('R2b', MemoryStore.getInstance().count() === 0, 'reasoning troppo corto: nessun puntatore in memoria');
  }

  // R3: turno INTERROTTO da un errore con reasoning parziale → salvato comunque,
  // etichettato come interrotto, e l'errore continua a propagarsi normalmente
  {
    fs.rmSync(thinkingDir, { recursive: true, force: true });
    MemoryStore.getInstance().clear();

    const provider = new MockLLMProvider([
      { error: { message: '[Timeout generazione] simulato', partialReasoning: longReasoning } }
    ]);
    const agent = new Agent(provider, new ToolRegistry(), new PermissionManager(), 'system', undefined, 20, 20000, 'Worf');

    let threw = false;
    try {
      await agent.run('Task che si interrompe');
    } catch (e: any) {
      threw = true;
      check('R3a', e.message.includes('Errore nel ciclo agentico') || e.message.includes('Error in agentic loop'), `l'errore continua a propagarsi al chiamante (ricevuto: ${e.message})`);
    }
    check('R3b', threw, "un turno interrotto lancia comunque l'errore (nessun inghiottimento silenzioso)");

    const files = fs.existsSync(thinkingDir) ? fs.readdirSync(thinkingDir) : [];
    check('R3c', files.length === 1, `il reasoning parziale è stato salvato nonostante l'errore (${files.length} file)`);
    if (files.length === 1) {
      check('R3d', files[0].includes('interrotto') || files[0].includes('interrupted'), `il file è etichettato come interrotto (${files[0]})`);
      const content = fs.readFileSync(path.join(thinkingDir, files[0]), 'utf-8');
      check('R3e', content === longReasoning.trim(), 'il contenuto salvato è il reasoning parziale completo');
    }
  }

  delete process.env.TSUKA_HOME;
  delete process.env.TSUKA_MEMORY_FILE;
  fs.rmSync(tmpHome, { recursive: true, force: true });

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  if (failed > 0) process.exit(1);
}

main();
