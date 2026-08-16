/**
 * Test per il comando /continue (T13.4): ripresa forzata di un ragionamento
 * interrotto salvato in memory/thinking/ (T9.12).
 * Isolamento (stesso schema di test_blackboard.ts/test_parallel_workspace.ts):
 * TSUKA_HOME temporaneo, così nessuna traccia del repo reale viene letta.
 * Esecuzione: npx tsx tests/test_continue_command.ts
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

async function run() {
  console.log('=== Test /continue (ripresa forzata del ragionamento) ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-continue-home-'));
  process.env.TSUKA_HOME = tmpHome;

  // Import dinamico DOPO aver impostato TSUKA_HOME: homePath() la legge ad
  // ogni chiamata, ma per coerenza con la convenzione del repo importiamo dopo.
  const { listThinkingTraces, resolveThinkingTrace, buildResumeDirective } = await import('../src/cli/commands/continueSession');

  const thinkingDir = path.join(tmpHome, 'memory', 'thinking');

  // 1. Cartella assente: nessuna traccia, nessun crash
  const emptyTraces = listThinkingTraces();
  check('CONT.1', Array.isArray(emptyTraces) && emptyTraces.length === 0, 'listThinkingTraces su cartella assente ritorna array vuoto senza eccezioni');

  const emptyResolve = await resolveThinkingTrace('', []);
  check('CONT.2', emptyResolve === null, 'resolveThinkingTrace su elenco vuoto ritorna null');

  // 2. Popola alcune tracce con mtime distinti e distanziati (evita ambiguità
  // su filesystem a bassa risoluzione dell'orologio, come Windows ~15ms).
  fs.mkdirSync(thinkingDir, { recursive: true });
  const older = path.join(thinkingDir, '2026-08-16T17-34-44-687Z-agente.md');
  const interrupted = path.join(thinkingDir, '2026-08-16T18-06-10-667Z-agente-interrotto.md');
  const newest = path.join(thinkingDir, '2026-08-16T18-10-00-000Z-agente.md');

  fs.writeFileSync(older, 'Ragionamento breve più vecchio.');
  await new Promise((r) => setTimeout(r, 30));
  fs.writeFileSync(interrupted, 'Ragionamento lungo interrotto sul task X: valuto le opzioni A e B...');
  await new Promise((r) => setTimeout(r, 30));
  fs.writeFileSync(newest, 'Ultimo ragionamento completo, il più recente.');

  // 3. Elenco ordinato dal più recente
  const traces = listThinkingTraces();
  check('CONT.3', traces.length === 3, `listThinkingTraces trova tutti e 3 i file .md creati (trovati: ${traces.length})`);
  check('CONT.4', traces[0].filename === '2026-08-16T18-10-00-000Z-agente.md', `il più recente per mtime è primo in elenco (trovato: ${traces[0]?.filename})`);
  check('CONT.5', traces.some((t) => t.filename.includes('interrotto') && t.interrupted === true), 'il flag "interrotto" è riconosciuto dal nome file');
  check('CONT.6', traces.find((t) => t.filename === newest.split(path.sep).pop())?.interrupted === false, 'una traccia senza "-interrotto" nel nome ha interrupted=false');

  // 4. Ignora file non-.md nella stessa cartella
  fs.writeFileSync(path.join(thinkingDir, 'note.txt'), 'non è una traccia');
  const tracesAfterNoise = listThinkingTraces();
  check('CONT.7', tracesAfterNoise.length === 3, 'i file non-.md nella cartella thinking/ vengono ignorati');

  // 5. resolveThinkingTrace con arg: match su sottostringa del filename (case-insensitive)
  const matched = await resolveThinkingTrace('INTERROTTO', traces);
  check('CONT.8', matched?.filename === interrupted.split(path.sep).pop(), 'resolveThinkingTrace con arg trova la traccia per sottostringa del filename, case-insensitive');

  const noMatch = await resolveThinkingTrace('non-esiste-xyz', traces);
  check('CONT.9', noMatch === null, 'resolveThinkingTrace ritorna null se nessun filename combacia con arg');

  // 6. resolveThinkingTrace senza arg in ambiente non-TTY: la più recente, nessun menu interattivo
  const nonTtyPick = await resolveThinkingTrace('', traces);
  check('CONT.10', nonTtyPick?.filename === traces[0].filename, 'senza arg e non-TTY, resolveThinkingTrace ritorna la traccia più recente senza bloccarsi su un menu');

  // 7. buildResumeDirective: contiene il contenuto originale e l'istruzione esplicita di non ripartire da capo
  const directive = buildResumeDirective('Il mio ragionamento completo su come strutturare levels.js.');
  check('CONT.11', directive.includes('Il mio ragionamento completo su come strutturare levels.js.'), 'buildResumeDirective include il testo integrale della traccia');
  check('CONT.12', /non ripartire da capo/i.test(directive), 'buildResumeDirective istruisce esplicitamente di non ripartire da capo');
  check('CONT.13', /esegui subito/i.test(directive), 'buildResumeDirective istruisce di agire subito se il ragionamento converge già a una decisione');

  // 8. buildResumeDirective con whitespace superfluo: il contenuto viene trimmato
  const trimmedDirective = buildResumeDirective('   testo con spazi tutt\'intorno   \n\n');
  check('CONT.14', !trimmedDirective.includes('   testo'), 'buildResumeDirective rimuove whitespace superfluo dal contenuto della traccia');

  delete process.env.TSUKA_HOME;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
