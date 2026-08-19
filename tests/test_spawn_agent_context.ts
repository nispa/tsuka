/**
 * Test per T8.1/T8.5/T8.7 (TASKS.md — FASE 3), tutti concentrati su spawn_agent
 * (`src/tools/impl/spawnAgent.ts`):
 *
 * - T8.1 "Dare al sub-agente la lavagna del run": quando esiste un run attivo
 *   (Blackboard.withRun), il sub-agente riceve in più i tool 'read_notes'/
 *   'post_note' e un'istruzione esplicita nel system prompt di leggere le note
 *   prima di iniziare; fuori da un run attivo il comportamento resta identico a
 *   oggi (nessun tool in più, nessun fallimento); i file in roles/ non vengono
 *   toccati dal task.
 * - T8.5 "Il lavoro del sub-agente deve lasciare un artefatto": il resoconto
 *   integrale del sub-agente finisce su un file sotto la app home
 *   (runs/<runId>/<label>.md), il valore ritornato al padre è una sintesi breve
 *   + percorso sotto i 3000 caratteri, e il file resta leggibile con read_file
 *   anche dopo che il messaggio originale è stato rimosso dalla history del
 *   padre (simulando una potatura). Se un run è attivo, il percorso viene anche
 *   postato sulla lavagna (chiude il cerchio con T8.1).
 * - T8.7 "Un briefing che sfora va spezzato, non accorciato": un task oltre
 *   2000 caratteri produce un errore che dichiara la lunghezza effettiva, vieta
 *   esplicitamente l'accorciamento e indica le due uscite legittime (più
 *   chiamate a spawn_agent, oppure write_file + percorso); il limite resta 2000.
 *
 * Copre il flusso reale Agent → ToolRegistry → tool (nessuna chiamata diretta a
 * Blackboard/spawnAgentTool "a mano" per la parte end-to-end), stesso stile di
 * tests/test_blackboard.ts e tests/test_mock_provider.ts.
 *
 * Isolamento: TSUKA_HOME e TSUKA_MEMORY_FILE puntano a cartelle temporanee
 * (nessuna scrittura nel repo reale, incluso runs/ scritto da spawnAgent.ts);
 * "workspaceRoot" nel tsuka.config.json temporaneo coincide con TSUKA_HOME così
 * che read_file (jail sulla workspace root) possa rileggere gli artefatti
 * scritti sotto la app home — stesso schema di test_context_budget.ts. Tutti i
 * moduli che dipendono da CONFIG_PATH sono importati dinamicamente DOPO aver
 * impostato le env var.
 *
 * Esecuzione: node --import tsx tests/test_spawn_agent_context.ts
 * (impostare TSUKA_MEMORY_FILE prima se lanciato fuori da npm test — qui lo fa
 * lo script stesso, quindi nessun passo manuale necessario)
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

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

/** Hash combinato di tutti i file roles/*.json (byte-identità, T8.1 accettazione c). */
function hashRolesDir(): string {
  const rolesDir = path.join(__dirname, '..', 'roles');
  const files = fs.readdirSync(rolesDir).filter((f) => f.endsWith('.json')).sort();
  const hash = crypto.createHash('sha256');
  for (const f of files) {
    hash.update(f);
    hash.update(fs.readFileSync(path.join(rolesDir, f)));
  }
  return hash.digest('hex');
}

async function main() {
  console.log('=== Test spawn_agent: lavagna del run (T8.1), artefatto (T8.5), briefing troppo lungo (T8.7) ===\n');

  const rolesHashBefore = hashRolesDir();

  // ── Isolamento: home e memoria temporanee, workspaceRoot = home temporanea ──
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-spawn-home-'));
  const tmpMemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-spawn-mem-'));
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

  // Import dinamico DOPO aver impostato le env var (CONFIG_PATH è calcolato al load del modulo).
  const { Agent } = await import('../src/core/agent');
  const { ToolRegistry } = await import('../src/tools/registry');
  const { PermissionManager } = await import('../src/safety/permissions');
  const { Blackboard } = await import('../src/core/blackboard');
  const { homePath } = await import('../src/core/apphome');
  const { spawnAgentTool } = await import('../src/tools/impl/spawnAgent');
  const { postNoteTool } = await import('../src/tools/impl/postNote');
  const { readNotesTool } = await import('../src/tools/impl/readNotes');
  const { readFileTool } = await import('../src/tools/impl/readFile');
  const { MockLLMProvider, mockToolCall } = await import('./mocks/mockProvider');

  function buildRegistry() {
    const registry = new ToolRegistry();
    registry.register(spawnAgentTool);
    registry.register(postNoteTool);
    registry.register(readNotesTool);
    registry.register(readFileTool);
    return registry;
  }

  // ============================================================
  // T8.1 (a) + T8.5 (a/b/c) — run attivo: nota del padre, figlio la legge
  // attraverso lo stack reale, artefatto scritto e rileggibile dopo potatura
  // ============================================================
  {
    const registry = buildRegistry();
    // Modello 'large' per tier: evita che il filtro di tier (T2.1/registry.ts)
    // nasconda read_notes/post_note/spawn_agent dai 'tools' inviati e confonda
    // le asserzioni sotto, che devono riflettere SOLO allowedTools.
    const provider = new MockLLMProvider([
      // Round 1 padre: posta una nota sulla lavagna (come farebbe un membro reale)
      { toolCalls: [mockToolCall('post_note', { key: 'decisione-db', value: 'Usa Postgres per il db' })] },
      // Round 2 padre: spawna un figlio
      { toolCalls: [mockToolCall('spawn_agent', { task: 'Leggi la lavagna del run e riassumi in una frase cosa hanno deciso i colleghi.', roleName: 'developer' })] },
      // Round 1 figlio: legge le note
      { toolCalls: [mockToolCall('read_notes', {})] },
      // Round 2 figlio: risposta finale (diventa il resoconto integrale su file)
      { content: 'Ho letto la lavagna: i colleghi hanno deciso di usare Postgres per il database. Compito completato.' },
      // Round 3 padre: chiude
      { content: 'Ricevuto il resoconto dal sub-agente.' }
    ], { model: 'mock-70b-large' });

    const permissionManager = new PermissionManager();
    const parentAgent = new Agent(
      provider, registry, permissionManager,
      'Sei un agente di test (padre).',
      ['spawn_agent', 'post_note'],
      40, 65536,
      'padre-test'
    );

    const runId = Blackboard.newRunId();
    const finalAnswer = await Blackboard.withRun(runId, () => parentAgent.run('Coordina il sub-agente sul database.'));

    check('SA-a-1', provider.remaining === 0, `copione interamente consumato (5 round: post_note + spawn_agent padre, read_notes + risposta figlio, chiusura padre) (rimasti: ${provider.remaining})`);
    check('SA-a-2', finalAnswer.includes('Ricevuto'), `risposta finale del padre ricevuta ("${finalAnswer}")`);

    // --- T8.1: il figlio (round 1, callLog[2]) ha in più read_notes/post_note nei tool offerti ---
    const childFirstCallTools = (provider.callLog[2]?.tools || []).map((t: any) => t.function?.name);
    check('SA-a-3', childFirstCallTools.includes('read_notes'), `il figlio ha 'read_notes' tra i tool offerti pur non essendo nel ruolo 'developer' (tools: ${JSON.stringify(childFirstCallTools)})`);
    check('SA-a-4', childFirstCallTools.includes('post_note'), `il figlio ha 'post_note' tra i tool offerti (tools: ${JSON.stringify(childFirstCallTools)})`);

    // --- T8.1: il system prompt del figlio istruisce a leggere le note prima di iniziare ---
    const childSysPrompt = provider.callLog[2]?.messages?.[0]?.content || '';
    check('SA-a-5', typeof childSysPrompt === 'string' && /(LAVAGNA DEL RUN|RUN BLACKBOARD)/i.test(childSysPrompt) && /read_notes/.test(childSysPrompt), `il system prompt del figlio menziona la lavagna e read_notes (estratto: "${String(childSysPrompt).slice(-300)}")`);

    // --- T8.1: il figlio legge DAVVERO la nota del padre attraverso il tool reale (callLog[3] = round 2 figlio) ---
    const childToolMsg = provider.callLog[3]?.messages.find((m: any) => m.role === 'tool' && m.name === 'read_notes');
    check('SA-a-6', !!childToolMsg, 'la seconda chiamata LLM del figlio include il risultato reale di read_notes nella history');
    check(
      'SA-a-7',
      !!childToolMsg && typeof childToolMsg.content === 'string' && childToolMsg.content.includes('Usa Postgres per il db'),
      `il contenuto della nota postata dal padre compare nel risultato di read_notes letto dal figlio (${JSON.stringify(childToolMsg?.content)})`
    );
    check(
      'SA-a-8',
      !!childToolMsg && typeof childToolMsg.content === 'string' && /padre-test/i.test(childToolMsg.content),
      `l'autore della nota (padre-test) è attribuito correttamente (${JSON.stringify(childToolMsg?.content)})`
    );

    // --- T8.5: il valore ritornato al padre (messaggio 'tool' di spawn_agent) è breve e contiene il percorso ---
    const spawnToolMsg = parentAgent.getMessages().find((m) => m.role === 'tool' && m.name === 'spawn_agent');
    check('SA-b-1', !!spawnToolMsg, 'la history del padre contiene il messaggio tool di spawn_agent');
    const spawnOutput = typeof spawnToolMsg?.content === 'string' ? spawnToolMsg.content : '';
    check('SA-b-2', spawnOutput.length > 0 && spawnOutput.length <= 3000, `il valore ritornato resta sotto i 3000 caratteri (${spawnOutput.length})`);
    const pathMatch = spawnOutput.match(/(?:salvato in|saved in) '([^']+)'/i);
    check('SA-b-3', !!pathMatch, `il valore ritornato contiene il percorso dell'artefatto (${JSON.stringify(spawnOutput.slice(0, 200))})`);

    const relPath = pathMatch ? pathMatch[1] : '';
    const fullReportText = 'Ho letto la lavagna: i colleghi hanno deciso di usare Postgres per il database. Compito completato.';

    // --- T8.5 (a): il file esiste e contiene il resoconto integrale ---
    const absPath = homePath(relPath);
    const fileExists = relPath !== '' && fs.existsSync(absPath);
    check('SA-b-4', fileExists, `il file dell'artefatto esiste sotto la app home (${absPath})`);
    const fileContent = fileExists ? fs.readFileSync(absPath, 'utf-8') : '';
    check('SA-b-5', fileContent === fullReportText, `il file contiene il resoconto integrale del figlio, non troncato (${JSON.stringify(fileContent)})`);

    // --- T8.1/T8.5: chiude il cerchio — il percorso è anche postato sulla lavagna ---
    const artefattoNotes = Blackboard.forRun(runId).read('artefatto-sub-agente');
    check('SA-b-6', artefattoNotes.length === 1 && artefattoNotes[0].value === relPath, `il percorso dell'artefatto è stato postato sulla lavagna del run (${JSON.stringify(artefattoNotes)})`);

    // --- T8.5 (c): il padre rilegge il contenuto con read_file DOPO una potatura
    // che ha rimosso il messaggio originale dalla history ---
    const beforePrune = parentAgent.getMessages().length;
    (parentAgent as any).messages = parentAgent.getMessages().filter((m) => !(m.role === 'tool' && m.name === 'spawn_agent'));
    const afterPrune = parentAgent.getMessages().length;
    check('SA-b-7', afterPrune === beforePrune - 1, 'simulata la potatura: il messaggio originale di spawn_agent è stato rimosso dalla history del padre');
    check('SA-b-8', !parentAgent.getMessages().some((m) => m.role === 'tool' && m.name === 'spawn_agent'), 'il messaggio originale non è più in history (nessun residuo)');

    const rereadResult = await registry.executeTool('read_file', { path: relPath }, permissionManager);
    check('SA-b-9', rereadResult.success, `read_file rilegge l'artefatto con successo dopo la potatura (${rereadResult.output.slice(0, 150)})`);
    check('SA-b-10', rereadResult.output.includes('Postgres per il database'), `il contenuto riletto corrisponde al resoconto integrale (${rereadResult.output.slice(0, 200)})`);

    Blackboard.endRun(runId);
  }

  // ============================================================
  // T8.1 (b) — fuori da un run attivo: nessun tool in più, nessun fallimento
  // ============================================================
  {
    const registry = buildRegistry();
    const provider = new MockLLMProvider([
      { toolCalls: [mockToolCall('spawn_agent', { task: 'Fai un piccolo compito senza run attivo.', roleName: 'developer' })] },
      { content: 'Compito eseguito senza note.' },
      { content: 'Ok, il sub-agente ha finito.' }
    ], { model: 'mock-70b-large' });

    const permissionManager = new PermissionManager();
    const parentAgent = new Agent(
      provider, registry, permissionManager,
      'Sei un agente di test (padre, fuori da un run).',
      ['spawn_agent'],
      40, 65536,
      'padre-solo'
    );

    // NESSUN Blackboard.withRun qui: comportamento fuori da un run attivo.
    let threw = false;
    let finalAnswer = '';
    try {
      finalAnswer = await parentAgent.run('Spawna un sub-agente senza contesto di run.');
    } catch {
      threw = true;
    }

    check('SA-c-1', !threw, 'spawn_agent fuori da un run attivo non fallisce');
    check('SA-c-2', finalAnswer.includes('Ok'), `il workflow si completa normalmente (risposta: "${finalAnswer}")`);
    check('SA-c-3', provider.remaining === 0, 'copione interamente consumato (3 round attesi)');

    const childFirstCallTools = (provider.callLog[1]?.tools || []).map((t: any) => t.function?.name);
    check('SA-c-4', !childFirstCallTools.includes('read_notes'), `fuori da un run il figlio NON ha 'read_notes' tra i tool offerti (tools: ${JSON.stringify(childFirstCallTools)})`);
    check('SA-c-5', !childFirstCallTools.includes('post_note'), `fuori da un run il figlio NON ha 'post_note' tra i tool offerti (tools: ${JSON.stringify(childFirstCallTools)})`);

    const childSysPrompt = provider.callLog[1]?.messages?.[0]?.content || '';
    check('SA-c-6', typeof childSysPrompt === 'string' && !/LAVAGNA DEL RUN/.test(childSysPrompt), 'fuori da un run il system prompt del figlio non menziona la lavagna');
  }

  // ============================================================
  // T8.1 (c) — i file in roles/ restano byte-identici
  // ============================================================
  {
    const rolesHashAfter = hashRolesDir();
    check('SA-d-1', rolesHashAfter === rolesHashBefore, 'i file in roles/ sono byte-identici a prima del task (hash combinato invariato)');
  }

  // ============================================================
  // T8.7 — briefing oltre 2000 caratteri: errore prescrittivo, non un invito ad accorciare
  // ============================================================
  {
    const tooLong = 'x'.repeat(2001);
    let errMsg = '';
    try {
      await spawnAgentTool.execute({ task: tooLong });
    } catch (e: any) {
      errMsg = e.message;
    }
    check('SA-e-1', errMsg.length > 0, `un task di 2001 caratteri lancia un errore (${JSON.stringify(errMsg.slice(0, 200))})`);
    check('SA-e-2', errMsg.includes('2001'), `l'errore dichiara la lunghezza effettiva del task (${errMsg})`);
    check('SA-e-3', /(NON accorciarlo|do not truncate)/i.test(errMsg), `l'errore vieta esplicitamente l'accorciamento (${errMsg})`);
    check('SA-e-4', /spawn_agent/.test(errMsg) && /(pi[uù] chiamate|multiple.*calls)/i.test(errMsg), `l'errore indica l'uscita (a): più chiamate a spawn_agent (${errMsg})`);
    check('SA-e-5', /write_file/.test(errMsg) && /(percorso|briefingFile)/i.test(errMsg), `l'errore indica l'uscita (b): write_file + percorso nel task (${errMsg})`);
    check('SA-e-6', errMsg !== 'Compito troppo lungo (max 2000 caratteri).', 'il messaggio non è più quello originale (che invitava implicitamente ad accorciare)');

    // Il limite resta 2000: un task ESATTAMENTE a 2000 caratteri non deve incappare
    // nell'errore di lunghezza (deve fallire più avanti, per mancanza di provider/registry).
    const exactly2000 = 'y'.repeat(2000);
    let errMsg2000 = '';
    try {
      await spawnAgentTool.execute({ task: exactly2000 });
    } catch (e: any) {
      errMsg2000 = e.message;
    }
    check('SA-e-7', errMsg2000 === 'Provider non disponibile nel contesto.' || errMsg2000 === 'Provider not available in execution context.', `un task di esattamente 2000 caratteri supera il controllo di lunghezza (limite invariato) (${errMsg2000})`);

    // Lo schema JSON del tool non prepara più la reazione sbagliata. Le due
    // alternative (dividere in più chiamate, o un briefing su file) sono ora
    // divise fra 'task' (che rimanda a briefingFile) e 'briefingFile' stesso
    // (T9.8: parametro strutturato, non più solo una convenzione testuale in 'task').
    const schemaRaw = fs.readFileSync(path.join(__dirname, '..', 'tools_schemas', 'spawn_agent.json'), 'utf-8');
    const schema = JSON.parse(schemaRaw);
    const taskDesc: string = schema.parameters.properties.task.description;
    const briefingFileDesc: string = schema.parameters.properties.briefingFile.description;
    const combinedDesc = `${taskDesc}\n${briefingFileDesc}`;
    check('SA-e-8', /2000/.test(combinedDesc) && /write_file/.test(combinedDesc) && /spawn_agent/.test(combinedDesc) && /briefingFile/.test(taskDesc), `le descrizioni di 'task'/'briefingFile' nello schema JSON indicano le alternative (task: ${taskDesc} | briefingFile: ${briefingFileDesc})`);
    check('SA-e-9', !/^Il compito specifico da assegnare al sub-agente \(max 2000 caratteri\)\.$/.test(taskDesc), 'la descrizione nello schema non è più quella originale');
  }

  // ============================================================
  // T9.8 — briefingFile: un briefing lungo letto da un file, non incollato inline
  // ============================================================
  {
    // (a) percorso inesistente → errore esplicito, nessun tentativo di procedere
    let errMissing = '';
    try {
      await spawnAgentTool.execute({ briefingFile: 'briefing-inesistente.md' });
    } catch (e: any) {
      errMissing = e.message;
    }
    check('SA-f-1', /(non esiste|does not exist)/i.test(errMissing), `briefingFile inesistente → errore esplicito (${errMissing})`);

    // (b) file oltre il limite → errore prescrittivo (stesso schema di T8.7, limite diverso)
    fs.writeFileSync(path.join(tmpHome, 'briefing-lungo.md'), 'z'.repeat(12001));
    let errTooLong = '';
    try {
      await spawnAgentTool.execute({ briefingFile: 'briefing-lungo.md' });
    } catch (e: any) {
      errTooLong = e.message;
    }
    check('SA-f-2', /12001/.test(errTooLong) && /(pi[uù] chiamate|multiple.*calls)/i.test(errTooLong), `briefingFile troppo lungo → errore con la lunghezza effettiva e l'uscita corretta (${errTooLong})`);

    // (c) file vuoto → errore esplicito, non un compito vuoto silenzioso
    fs.writeFileSync(path.join(tmpHome, 'briefing-vuoto.md'), '   \n  ');
    let errEmpty = '';
    try {
      await spawnAgentTool.execute({ briefingFile: 'briefing-vuoto.md' });
    } catch (e: any) {
      errEmpty = e.message;
    }
    check('SA-f-3', /(vuoto|empty)/i.test(errEmpty), `briefingFile vuoto (solo whitespace) → errore esplicito (${errEmpty})`);

    // (d) un briefing OLTRE i 2000 caratteri di MAX_TASK_LENGTH, ma sotto i 12000
    // di briefingFile, esegue con successo: il limite più permissivo è quello
    // realmente applicato quando il testo arriva da file, non da 'task' inline.
    const longBriefing = 'Implementa il modulo X.\n' + 'Dettaglio riga.\n'.repeat(200); // ~3200 caratteri, > 2000
    fs.writeFileSync(path.join(tmpHome, 'briefing-ok.md'), longBriefing);
    const provider2 = new MockLLMProvider([
      // Round 1 padre: delega con SOLO un percorso (nessun 'task' inline)
      { toolCalls: [mockToolCall('spawn_agent', { briefingFile: 'briefing-ok.md' })] },
      // Round 1 figlio: nessun tool, chiude subito il proprio turno
      { content: 'Fatto.' },
      // Round 2 padre: riceve il resoconto del figlio e chiude
      { content: 'Ricevuto il resoconto dal sub-agente.' }
    ]);
    const registry2 = buildRegistry();
    const permissionManager2 = new PermissionManager();
    const parentAgent2 = new Agent(
      provider2, registry2, permissionManager2,
      'Sei un agente di test (padre, fuori da un run).',
      ['spawn_agent'],
      40, 65536,
      'padre-briefing'
    );
    let threwOk = false;
    try {
      await parentAgent2.run('Spawna un sub-agente con il briefing lungo su file.');
    } catch {
      threwOk = true;
    }
    check('SA-f-4', !threwOk, `un briefingFile di ~${longBriefing.length} caratteri (> MAX_TASK_LENGTH, < limite briefingFile), passato SOLO come percorso, non fallisce`);
    check('SA-f-4b', provider2.remaining === 0, 'copione interamente consumato (3 round attesi)');

    const childUserMsg = provider2.callLog[1]?.messages?.find((m: any) => m.role === 'user')?.content || '';
    check('SA-f-5', typeof childUserMsg === 'string' && childUserMsg.includes('Implementa il modulo X.'), `il contenuto del file finisce per intero nel compito del sub-agente (ricevuto: ${JSON.stringify(childUserMsg).slice(0, 120)}…)`);
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);

  // Pulizia: nessun residuo su disco (tmpHome include anche runs/ scritto dal tool).
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
