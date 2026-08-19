/**
 * Test per T8.13 — Override di effort in spawn_agent (TASKS.md — FASE 3).
 *
 * Copre l'Accettazione del task:
 *  - uno spawn_agent con reasoningEffort: 'none' fa arrivare 'none' al provider
 *    del sub-agente, verificato sia sul ChatOptions ricevuto da chatWithTools
 *    (flusso reale Agent → ToolRegistry → tool, stesso stile di
 *    tests/test_spawn_agent_context.ts) sia — con rigore ulteriore — sul payload
 *    reale inviato all'SDK OpenAI (reasoning_effort, stesso approccio di
 *    tests/test_reasoning_effort.ts, sezione "LLMProvider reale");
 *  - omesso, la cascata ricade su personaggio/ruolo "come prima": spawnAgent.ts
 *    non passa (e non ha mai passato) un reasoningEffort di costruzione
 *    all'Agent del sub-agente, quindi senza override il sub-agente non riceve
 *    ChatOptions.reasoningEffort — comportamento invariato rispetto a prima
 *    del task (Fuori scope: non tocca resolveReasoningEffort né la cascata);
 *  - un valore fuori enum viene rifiutato con un errore che elenca i valori
 *    ammessi;
 *  - lo schema JSON dichiara l'enum a 4 livelli e la descrizione indica quando
 *    abbassare l'effort (compiti meccanici).
 *
 * Isolamento: TSUKA_HOME e TSUKA_MEMORY_FILE puntano a cartelle temporanee
 * (nessuna scrittura nel repo reale, incluso runs/ scritto da spawnAgent.ts).
 * Moduli che dipendono da CONFIG_PATH importati dinamicamente DOPO le env var
 * (stesso schema di test_spawn_agent_context.ts).
 *
 * Esecuzione isolata: node --import tsx tests/test_spawn_agent_reasoning_effort.ts
 */
import './isolateMemory';
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
  console.log('=== Test spawn_agent: override di reasoningEffort (T8.13) ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-spawn-effort-home-'));
  const tmpMemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-spawn-effort-mem-'));
  process.env.TSUKA_HOME = tmpHome;
  process.env.TSUKA_MEMORY_FILE = path.join(tmpMemDir, 'memory.json');
  fs.writeFileSync(
    path.join(tmpHome, 'tsuka.config.json'),
    JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer',
      activeTrait: 'professional',
      activeCharacter: 'custom',
      workspaceRoot: tmpHome
    }, null, 2)
  );

  const { Agent } = await import('../src/core/agent');
  const { ToolRegistry } = await import('../src/tools/registry');
  const { PermissionManager } = await import('../src/safety/permissions');
  const { spawnAgentTool } = await import('../src/tools/impl/spawnAgent');
  const { LLMProvider } = await import('../src/core/provider');
  const { MockLLMProvider, mockToolCall } = await import('./mocks/mockProvider');

  function buildRegistry() {
    const registry = new ToolRegistry();
    registry.register(spawnAgentTool);
    return registry;
  }

  // ============================================================
  // SE.1 — override esplicito ('none') arriva al ChatOptions del sub-agente,
  // attraverso il flusso reale Agent → ToolRegistry → tool.
  // ============================================================
  {
    const registry = buildRegistry();
    const provider = new MockLLMProvider([
      // Round 1 padre: spawna un figlio con reasoningEffort: 'none'
      { toolCalls: [mockToolCall('spawn_agent', { task: 'Riformatta questo blocco JSON.', roleName: 'developer', reasoningEffort: 'none' })] },
      // Round 1 figlio: risposta finale diretta
      { content: 'Fatto.' },
      // Round 2 padre: chiude
      { content: 'Ricevuto dal sub-agente.' }
    ], { model: 'mock-70b-large' });

    const permissionManager = new PermissionManager();
    const parentAgent = new Agent(
      provider, registry, permissionManager,
      'Sei un agente di test (padre).',
      ['spawn_agent'],
      40, 65536,
      'padre-effort'
    );

    const finalAnswer = await parentAgent.run('Spawna un figlio con effort basso su un compito meccanico.');

    check('SE.1a', provider.remaining === 0, `copione interamente consumato (3 round attesi, rimasti: ${provider.remaining})`);
    check('SE.1b', finalAnswer.includes('Ricevuto'), `il workflow si completa normalmente (risposta: "${finalAnswer}")`);
    check(
      'SE.1c',
      provider.callLog[1]?.options?.reasoningEffort === 'none',
      `la chiamata LLM del sub-agente riceve reasoningEffort='none' dal padre (ricevuto: ${JSON.stringify(provider.callLog[1]?.options)})`
    );
  }

  // ============================================================
  // SE.2 — reasoningEffort OMESSO: la cascata ricade su personaggio/ruolo "come
  // prima" — spawnAgent.ts non ha mai passato un effort di costruzione
  // all'Agent del sub-agente, quindi senza override non c'è ChatOptions forzata
  // (comportamento invariato: Fuori scope non tocca resolveReasoningEffort).
  // ============================================================
  {
    const registry = buildRegistry();
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('spawn_agent', { task: 'Compito normale senza override di effort.', roleName: 'developer' })] },
      { content: 'Fatto senza override.' },
      { content: 'Ok, ricevuto.' }
    ], { model: 'mock-70b-large' });

    const permissionManager = new PermissionManager();
    const parentAgent = new Agent(
      provider, registry, permissionManager,
      'Sei un agente di test (padre, senza override).',
      ['spawn_agent'],
      40, 65536,
      'padre-effort-default'
    );

    const finalAnswer = await parentAgent.run('Spawna un figlio senza specificare reasoningEffort.');

    check('SE.2a', provider.remaining === 0, `copione interamente consumato (3 round attesi, rimasti: ${provider.remaining})`);
    check('SE.2b', finalAnswer.includes('Ok'), `il workflow si completa normalmente (risposta: "${finalAnswer}")`);
    check(
      'SE.2c',
      provider.callLog[1]?.options?.reasoningEffort === undefined,
      `omesso l'override, il sub-agente NON riceve un reasoningEffort forzato (cascata invariata rispetto a prima del task) (ricevuto: ${JSON.stringify(provider.callLog[1]?.options)})`
    );
  }

  // ============================================================
  // SE.3 — i 4 livelli dell'enum viaggiano tutti correttamente, uno per uno.
  // ============================================================
  {
    const levels = ['none', 'low', 'medium', 'xhigh'];
    for (const level of levels) {
      const registry = buildRegistry();
      const provider = new MockLLMProvider([
        { toolCalls: [mockToolCall('spawn_agent', { task: `Compito con effort ${level}.`, roleName: 'developer', reasoningEffort: level })] },
        { content: `Fatto a livello ${level}.` },
        { content: 'Chiusura.' }
      ], { model: 'mock-70b-large' });

      const permissionManager = new PermissionManager();
      const parentAgent = new Agent(
        provider, registry, permissionManager,
        'Sei un agente di test (padre, spazzata livelli).',
        ['spawn_agent'],
        40, 65536,
        `padre-${level}`
      );

      await parentAgent.run(`Spawna un figlio a livello ${level}.`);
      check(
        `SE.3-${level}`,
        provider.callLog[1]?.options?.reasoningEffort === level,
        `livello '${level}' propagato correttamente al sub-agente (ricevuto: ${JSON.stringify(provider.callLog[1]?.options)})`
      );
    }
  }

  // ============================================================
  // SE.4 — valore fuori enum: errore prescrittivo, elenca i valori ammessi.
  // ============================================================
  {
    let errMsg = '';
    try {
      await spawnAgentTool.execute({ task: 'Compito qualsiasi.', reasoningEffort: 'ultra' } as any);
    } catch (e: any) {
      errMsg = e.message;
    }
    check('SE.4a', errMsg.length > 0, `un reasoningEffort fuori enum lancia un errore (${JSON.stringify(errMsg)})`);
    check('SE.4b', /ultra/.test(errMsg), `l'errore riporta il valore ricevuto (${errMsg})`);
    check(
      'SE.4c',
      /none/.test(errMsg) && /low/.test(errMsg) && /medium/.test(errMsg) && /xhigh/.test(errMsg),
      `l'errore elenca tutti e 4 i valori ammessi (${errMsg})`
    );

    // Valore valido ma con maiuscole/spazi: normalizzato, non un secondo errore
    // di validazione (deve fallire più avanti, per mancanza di provider).
    let errMsg2 = '';
    try {
      await spawnAgentTool.execute({ task: 'Compito qualsiasi.', reasoningEffort: '  NONE  ' } as any);
    } catch (e: any) {
      errMsg2 = e.message;
    }
    check('SE.4d', errMsg2 === 'Provider non disponibile nel contesto.' || errMsg2 === 'Provider not available in execution context.', `un valore valido con spazi/maiuscole viene normalizzato, non rifiutato (${errMsg2})`);
  }

  // ============================================================
  // SE.5 — LLMProvider reale: reasoning_effort arriva nel payload SDK, non solo
  // nel ChatOptions del mock (verifica di rigore ulteriore, stesso approccio di
  // test_reasoning_effort.ts RE.6).
  // ============================================================
  {
    const registry = new ToolRegistry();
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'modello-finto');
    const capturedParams: any[] = [];
    (provider as any).client.chat.completions.create = async (params: any) => {
      capturedParams.push(params);
      return {
        choices: [{ message: { content: 'Fatto.', tool_calls: undefined } }],
        usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 }
      };
    };
    const permissionManager = new PermissionManager();
    const context = { provider, registry, permissionManager } as any;

    const result = await spawnAgentTool.execute(
      { task: 'Estrai i campi da questo testo.', roleName: 'developer', reasoningEffort: 'low' },
      context
    );

    check('SE.5a', typeof result === 'string' && (result.includes('SUB-AGENTE') || result.includes('SUB-AGENT')), `spawn_agent completa e ritorna un resoconto (${JSON.stringify(String(result).slice(0, 120))})`);
    check(
      'SE.5b',
      capturedParams[0]?.reasoning_effort === 'low',
      `il payload REALE inviato all'SDK OpenAI per la chiamata del sub-agente contiene reasoning_effort='low' (ricevuto: ${capturedParams[0]?.reasoning_effort})`
    );
  }

  // ============================================================
  // SE.6 — schema JSON: enum a 4 livelli e descrizione con guida "quando abbassarlo".
  // ============================================================
  {
    const schemaRaw = fs.readFileSync(path.join(__dirname, '..', 'tools_schemas', 'spawn_agent.json'), 'utf-8');
    const schema = JSON.parse(schemaRaw);
    const prop = schema.parameters.properties.reasoningEffort;
    check('SE.6a', !!prop, "lo schema JSON dichiara la proprietà 'reasoningEffort'");
    check(
      'SE.6b',
      Array.isArray(prop?.enum) && ['none', 'low', 'medium', 'xhigh'].every((v) => prop.enum.includes(v)) && prop.enum.length === 4,
      `l'enum copre esattamente i 4 livelli (ricevuto: ${JSON.stringify(prop?.enum)})`
    );
    const desc: string = prop?.description || '';
    check('SE.6c', /mechanical/i.test(desc), `la descrizione indica il caso d'uso (compiti meccanici) per abbassare l'effort (${desc})`);
    check('SE.6d', /none|low/i.test(desc), `la descrizione indica esplicitamente verso quali livelli abbassare (${desc})`);
    check('SE.6e', !schema.parameters.required.includes('reasoningEffort'), "reasoningEffort resta opzionale (non in 'required')");
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);

  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpMemDir, { recursive: true, force: true }); } catch {}
  delete process.env.TSUKA_HOME;
  delete process.env.TSUKA_MEMORY_FILE;

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
