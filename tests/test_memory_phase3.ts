/**
 * Test per T8.2/T8.3/T8.4 (TASKS.md — FASE 3), tutti su src/core/memory.ts + src/cli/shared.ts:
 *
 * - T8.2 — Memoria: filtro per agente in lettura (`sources?: string[]` in getRecent/search/
 *   formatRelevant/formatForPrompt): un agente vede i propri fatti + i kind:'lezione'/'decisione'
 *   di chiunque, escluso i kind:'run' altrui. Attivo in loadSystemPrompt solo se c'è un
 *   `character.aiName`.
 * - T8.3 — Retrieval: normalizzazione morfologica leggera (accenti + desinenza finale troncata,
 *   applicata a keyword e haystack in search()) e maxChars dell'iniezione configurabile via
 *   `ConfigManager.getMemoryMaxChars()` (tsuka.config.json, default 600).
 * - T8.4 — Costruire un prompt non deve scrivere sulla memoria: search() guadagna `touch`
 *   (default true), formatRelevant/formatForPrompt lo chiamano con `touch: false`.
 *
 * Isolamento totale dalla memoria/config reali dell'utente (stesso schema di
 * test_context_budget.ts / test_workspace_jail.ts): TSUKA_HOME è puntata a una cartella
 * temporanea PRIMA di qualunque import dei moduli core (memory.ts/config.ts/shared.ts sono
 * importati dinamicamente dentro main(), dopo aver impostato l'env var — CONFIG_PATH è una
 * const calcolata al load del modulo, quindi deve vedere TSUKA_HOME già impostata).
 * TSUKA_MEMORY_FILE è impostata in aggiunta (ridondante ma esplicita, come richiesto) per il
 * singleton MemoryStore.getInstance() usato nei test end-to-end via loadSystemPrompt.
 *
 * Esecuzione: node --import tsx tests/test_memory_phase3.ts
 * (impostare TSUKA_MEMORY_FILE non è necessario per questa suite — vedi sopra — ma è comunque
 * consigliato dalla procedura quando si lancia una suite di memoria a mano)
 */
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

function tmpPath(dir: string, name: string): string {
  return path.join(dir, `.smoke_${name}.json`);
}

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function main() {
  console.log('=== Test memoria: filtro per agente, normalizzazione morfologica, no-write su build prompt (T8.2/T8.3/T8.4) ===\n');

  // Isolamento: TSUKA_HOME su cartella temporanea PRIMA di importare i moduli core (CONFIG_PATH
  // è una const calcolata al load di config.ts). Nessun file reale del repo viene letto/scritto.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-memphase3-home-'));
  fs.mkdirSync(path.join(tmpHome, 'memory'), { recursive: true });
  process.env.TSUKA_HOME = tmpHome;
  const singletonMemFile = path.join(tmpHome, 'memory', 'memory.json');
  process.env.TSUKA_MEMORY_FILE = singletonMemFile; // ridondante con TSUKA_HOME, esplicito come da procedura

  const { MemoryStore, GLOBAL_SCOPE } = await import('../src/core/memory');
  const { ConfigManager, CONFIG_PATH } = await import('../src/core/config');
  const { loadSystemPrompt } = await import('../src/cli/shared');
  type RoleConfig = { name: string; displayName: string; description: string; systemPrompt: string; allowedTools: string[] };
  type TraitConfig = { name: string; displayName: string; description: string; prompt: string };
  type CharacterConfig = { name: string; displayName: string; aiName: string; role: string; trait: string; description: string };

  check('SETUP-1', path.resolve(CONFIG_PATH).startsWith(path.resolve(tmpHome)),
    `CONFIG_PATH è sotto la home temporanea, non nel repo reale (${CONFIG_PATH})`);

  // ────────────────────────────────────────────────────────────────────────
  // T8.2 — filtro per agente in lettura, a livello di MemoryStore (istanze dirette, non singleton)
  // ────────────────────────────────────────────────────────────────────────
  {
    const file = tmpPath(tmpHome, 'agent_filter');
    const store = new MemoryStore(file, 200, 'scope-t82');

    const aRun = store.addFact('AgenteA: scarto di turno A', 'AgenteA', { kind: 'run' });
    const bRun = store.addFact('AgenteB: scarto di turno B', 'AgenteB', { kind: 'run' });
    const aLezione = store.addFact('Lezione di AgenteA: fare sempre i test prima del commit', 'AgenteA', { kind: 'lezione' });
    const bLezione = store.addFact('Lezione di AgenteB: controllare sempre i log di errore', 'AgenteB', { kind: 'decisione' });
    const bFatto = store.addFact('AgenteB: nota generica non condivisibile', 'AgenteB', { kind: 'fatto' });

    const seenByA = new Set(store.getRecent(50, ['AgenteA']).map((f) => f.id));
    check('T8.2-1', seenByA.has(aRun.id), 'A vede il proprio scarto di run');
    check('T8.2-2', seenByA.has(aLezione.id), 'A vede la propria lezione');
    check('T8.2-3', seenByA.has(bLezione.id), 'A vede la decisione/lezione altrui (kind condivisibile)');
    check('T8.2-4', !seenByA.has(bRun.id), 'A NON vede lo scarto di run altrui');
    check('T8.2-5', !seenByA.has(bFatto.id), 'A NON vede il kind:\'fatto\' altrui (non condivisibile, non proprio)');

    const seenWithoutFilter = new Set(store.getRecent(50).map((f) => f.id));
    check('T8.2-6', [aRun, bRun, aLezione, bLezione, bFatto].every((f) => seenWithoutFilter.has(f.id)),
      'sources assente = comportamento attuale (nessuna regressione): tutti i fatti visibili');

    // Stessa regola anche in search() (opts.sources) e formatForPrompt() (sources posizionale)
    const searchSeenByA = new Set(store.search('scarto lezione log', 50, { sources: ['AgenteA'] }).map((f) => f.id));
    check('T8.2-7', searchSeenByA.has(aRun.id) && searchSeenByA.has(bLezione.id) && !searchSeenByA.has(bRun.id),
      'search() con opts.sources applica lo stesso filtro');

    const promptSection = store.formatForPrompt(50, 5000, ['AgenteA']);
    check('T8.2-8', promptSection.includes('Lezione di AgenteB') && !promptSection.includes('scarto di turno B'),
      'formatForPrompt() con sources: lezione altrui presente, run altrui assente');

    fs.unlinkSync(file);
  }

  // ────────────────────────────────────────────────────────────────────────
  // T8.2 — stessa cosa end-to-end attraverso loadSystemPrompt (usa MemoryStore.getInstance())
  // ────────────────────────────────────────────────────────────────────────
  {
    const role: RoleConfig = {
      name: 'test-role', displayName: 'Test', description: '', systemPrompt: 'Sei un agente di test.', allowedTools: []
    };
    const trait: TraitConfig = { name: 'test-trait', displayName: 'Test', description: '', prompt: 'Tono neutro.' };
    const charA: CharacterConfig = { name: 'agentea', displayName: 'AgenteA', aiName: 'AgenteA', role: 'test-role', trait: 'test-trait', description: '' };

    const store = MemoryStore.getInstance();
    store.addFact('[Goal] AgenteA: scarto di turno A (run)', 'AgenteA', { kind: 'run' });
    store.addFact('[Goal] AgenteB: scarto di turno B (run)', 'AgenteB', { kind: 'run' });
    store.addFact('Lezione utile lasciata da AgenteB: usare una cache LRU per gli embedding', 'AgenteB', { kind: 'lezione' });

    const promptA = loadSystemPrompt(role, trait, 'test-model', undefined, charA);
    check('T8.2-E2E-1', promptA.includes('Lezione utile lasciata da AgenteB'), 'system prompt di A contiene la lezione di B');
    check('T8.2-E2E-2', !promptA.includes('scarto di turno B'), 'system prompt di A NON contiene lo scarto di run di B');
    check('T8.2-E2E-3', promptA.includes('scarto di turno A'), 'system prompt di A contiene il proprio scarto di run (fatto proprio, qualunque kind)');

    const promptNoChar = loadSystemPrompt(role, trait, 'test-model', undefined, null);
    check('T8.2-E2E-4', promptNoChar.includes('scarto di turno B'),
      'senza character (nessun aiName) il filtro è inattivo: comportamento attuale, tutto visibile');
  }

  // ────────────────────────────────────────────────────────────────────────
  // T8.3 — normalizzazione morfologica leggera in search()
  // ────────────────────────────────────────────────────────────────────────
  {
    const file = tmpPath(tmpHome, 'morfologia');
    const store = new MemoryStore(file, 200, 'scope-t83');

    const fCorso = store.addFact('Ho completato con successo il corso di formazione avanzata', 'test');
    const fBadges = store.addFact('Il sistema rilascia automaticamente i badges agli utenti attivi', 'test');
    const fCitta = store.addFact('La città di Milano ospita molte aziende tecnologiche', 'test');
    const fEstraneo = store.addFact('Ricetta della torta di mele della nonna', 'test');

    const rCorsi = store.search('corsi');
    check('T8.3-1', rCorsi.some((f) => f.id === fCorso.id), '"corsi" trova un fatto che contiene "corso"');

    const rBadge = store.search('badge');
    check('T8.3-2', rBadge.some((f) => f.id === fBadges.id), '"badge" trova un fatto che contiene "badges"');

    const rCitta = store.search('citta'); // query senza accento
    check('T8.3-3', rCitta.some((f) => f.id === fCitta.id), '"citta" (senza accento) trova un fatto che contiene "città"');

    const rEstraneo = store.search('corsi');
    check('T8.3-4', !rEstraneo.some((f) => f.id === fEstraneo.id), 'nessun falso positivo sul fatto estraneo per la stessa query');

    fs.unlinkSync(file);
  }

  // ────────────────────────────────────────────────────────────────────────
  // T8.3 — regressione mirata dello scoring OR multi-keyword di T6.1 con la normalizzazione attiva
  // (stesso scenario di test_memory_scope.ts T6.1c, replicato qui per dimostrare che T8.3 non
  // introduce falsi positivi nei casi già coperti)
  // ────────────────────────────────────────────────────────────────────────
  {
    const file = tmpPath(tmpHome, 'or_scoring_regression');
    const store = new MemoryStore(file, 200, 'scope-t83b');
    store.addFact('Il server usa PostgreSQL come database principale', 'test');
    store.addFact('Il frontend è scritto in React con TypeScript', 'test');
    store.addFact('Ricetta della torta di mele della nonna', 'test');

    const results = store.search('server database TypeScript inesistente');
    check('T8.3-5', results.length === 2, `ancora solo 2 fatti con keyword in comune dopo la normalizzazione (trovati: ${results.length})`);
    check('T8.3-6', results[0].content.includes('PostgreSQL'), 'ordine per punteggio invariato: il fatto con 2 keyword resta primo');

    fs.unlinkSync(file);
  }

  // ────────────────────────────────────────────────────────────────────────
  // T8.3 — maxChars configurabile via tsuka.config.json (ConfigManager.getMemoryMaxChars)
  // ────────────────────────────────────────────────────────────────────────
  {
    check('T8.3-CFG-1', new ConfigManager().getMemoryMaxChars() === 600, 'default senza memoryMaxChars nel config = 600');

    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer', activeTrait: 'professional', activeCharacter: 'custom',
      memoryMaxChars: 120
    }, null, 2));
    check('T8.3-CFG-2', new ConfigManager().getMemoryMaxChars() === 120, 'valore esplicito valido onorato (120)');

    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer', activeTrait: 'professional', activeCharacter: 'custom',
      memoryMaxChars: 10
    }, null, 2));
    check('T8.3-CFG-3', new ConfigManager().getMemoryMaxChars() === 600, 'valore sotto il minimo (100) ricade sul default (600)');

    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer', activeTrait: 'professional', activeCharacter: 'custom',
      memoryMaxChars: 'tanti'
    }, null, 2));
    check('T8.3-CFG-4', new ConfigManager().getMemoryMaxChars() === 600, 'valore non numerico ricade sul default (600)');

    // Fine-a-fine: formatForPrompt() senza maxChars esplicito onora il config (120 impostato sopra
    // non è più attivo qui: riscriviamo un valore piccolo dedicato a questo controllo)
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer', activeTrait: 'professional', activeCharacter: 'custom',
      memoryMaxChars: 100
    }, null, 2));
    const file = tmpPath(tmpHome, 'maxchars_e2e');
    const store2 = new MemoryStore(file, 200, 'scope-t83c');
    for (let i = 0; i < 10; i++) {
      store2.addFact(`Fatto numero ${i} con un contenuto abbastanza lungo da riempire lo spazio disponibile nel prompt`, 'test');
    }
    const unrestricted = store2.formatForPrompt(50, 100000); // maxChars esplicito: config ignorato
    const configDriven = store2.formatForPrompt(50); // maxChars omesso: usa ConfigManager (100)
    check('T8.3-CFG-5', unrestricted.length > configDriven.length,
      `senza maxChars esplicito il config (100) limita l'iniezione (config-driven: ${configDriven.length} car., senza tetto: ${unrestricted.length} car.)`);
    check('T8.3-CFG-6', configDriven.length < 300, `sezione compatta rispetto al tetto configurato di 100 (${configDriven.length} car., include la nota "altri N ricordi")`);

    fs.unlinkSync(file);
    // Ripristina un config "pulito" (senza memoryMaxChars) per le sezioni successive della suite
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer', activeTrait: 'professional', activeCharacter: 'custom'
    }, null, 2));
  }

  // ────────────────────────────────────────────────────────────────────────
  // T8.4 — search() con touch:false non altera hits/lastUsed né scrive su disco
  // ────────────────────────────────────────────────────────────────────────
  {
    const file = tmpPath(tmpHome, 'touch_option');
    const store = new MemoryStore(file, 200, 'scope-t84');
    const fact = store.addFact('Fatto usato per verificare il comportamento di touch:false', 'test');
    const hashBefore = sha256(file);
    const hitsBefore = fact.hits;

    const r1 = store.search('comportamento touch', 10, { touch: false });
    check('T8.4-1', r1.length === 1 && r1[0].id === fact.id, 'search con touch:false trova comunque il fatto');
    check('T8.4-2', r1[0].hits === hitsBefore, 'touch:false non incrementa hits');
    const hashAfterNoTouch = sha256(file);
    check('T8.4-3', hashAfterNoTouch === hashBefore, 'touch:false non scrive su disco (hash file invariato)');

    const r2 = store.search('comportamento touch'); // touch di default = true (comportamento invariato per recall_memory)
    check('T8.4-4', r2.length === 1 && r2[0].hits === hitsBefore + 1, 'search senza opts (default) continua a incrementare hits come prima');
    const hashAfterTouch = sha256(file);
    check('T8.4-5', hashAfterTouch !== hashBefore, 'search con touch di default scrive su disco (comportamento invariato)');

    fs.unlinkSync(file);
  }

  // ────────────────────────────────────────────────────────────────────────
  // T8.4 — accettazione letterale: hash di memory.json identico dopo N costruzioni di system
  // prompt senza chiamate esplicite a save_memory/recall_memory (stessa forma di prova di T6.5)
  // ────────────────────────────────────────────────────────────────────────
  {
    const role: RoleConfig = {
      name: 'test-role', displayName: 'Test', description: '', systemPrompt: 'Sei un agente di test.', allowedTools: []
    };
    const trait: TraitConfig = { name: 'test-trait', displayName: 'Test', description: '', prompt: 'Tono neutro.' };
    const char: CharacterConfig = { name: 'agentec', displayName: 'AgenteC', aiName: 'AgenteC', role: 'test-role', trait: 'test-trait', description: '' };

    // Riusa il singleton (MemoryStore.getInstance()) già puntato su singletonMemFile fin
    // dall'inizio della suite: il singleton è costruito una sola volta per processo, quindi
    // riassegnare TSUKA_MEMORY_FILE a metà suite non lo ripunterebbe altrove — bisogna operare
    // sullo stesso file su cui è già agganciato. clear() riparte da uno stato noto.
    const store = MemoryStore.getInstance();
    store.clear();
    store.addFact('Fatto A rilevante per il compito di test sul prompt', 'AgenteC', { kind: 'fatto' });
    store.addFact('Lezione di un altro agente sulla gestione degli errori', 'AltroAgente', { kind: 'lezione' });

    const rawBefore = JSON.parse(fs.readFileSync(singletonMemFile, 'utf-8'));
    const hitsBefore = rawBefore.facts.map((f: any) => f.hits);
    const hashBefore = sha256(singletonMemFile);

    for (let i = 0; i < 5; i++) {
      loadSystemPrompt(role, trait, 'test-model', undefined, char, 'compito di test sul prompt');
      loadSystemPrompt(role, trait, 'test-model', undefined, char); // ramo formatForPrompt (senza taskText)
    }

    const hashAfter = sha256(singletonMemFile);
    check('T8.4-E2E-1', hashAfter === hashBefore, 'hash di memory.json identico dopo 10 costruzioni di system prompt (5x con task, 5x senza)');
    const rawAfter = JSON.parse(fs.readFileSync(singletonMemFile, 'utf-8'));
    const hitsAfter = rawAfter.facts.map((f: any) => f.hits);
    check('T8.4-E2E-2', JSON.stringify(hitsBefore) === JSON.stringify(hitsAfter), 'hits dei fatti invariati (nessuna iniezione automatica li ha "toccati")');

    // recall_memory (via search() con opts di default, touch:true) continua a incrementare hits
    MemoryStore.getInstance().search('compito di test sul prompt');
    const hashAfterRecall = sha256(singletonMemFile);
    check('T8.4-E2E-3', hashAfterRecall !== hashBefore, 'un recall esplicito (search senza touch:false) continua a scrivere/aggiornare hits');
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  console.log(`(memoria/config isolate in: ${tmpHome} — nessun file del repo reale toccato)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
