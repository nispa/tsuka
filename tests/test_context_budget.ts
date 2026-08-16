/**
 * Test per il tetto di contesto per singolo risultato di tool (T8.8, TASKS.md — FASE 3).
 * Copre i punti dell'Accettazione:
 * - un read_file su un file grande produce un risultato sotto il tetto configurato,
 *   con una nota che spiega come ottenere il resto (offset/limit, grep_search);
 * - read_file con offset/limit ritorna esattamente la finestra di righe richiesta;
 * - un execute_command con output enorme resta sotto il tetto;
 * - grep_search con molti risultati lunghi resta sotto il tetto;
 * - capForContext (unità isolata) tronca solo sopra soglia, mai sotto;
 * - maxToolResultTokens in tsuka.config.json è onorato da ConfigManager, con fallback
 *   al default (4000) per valori assenti o non validi.
 *
 * Isolamento (stesso schema di test_workspace_jail.ts): TSUKA_HOME temporaneo con un
 * tsuka.config.json dedicato (workspaceRoot su una cartella temporanea) — nessun file
 * del repo reale viene letto o scritto. Import dei moduli DOPO aver impostato TSUKA_HOME,
 * perché CONFIG_PATH viene calcolato al load del modulo core/config.ts.
 * Esecuzione: npx tsx tests/test_context_budget.ts
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

function writeConfig(tmpHome: string, tmpWorkspace: string, extra: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(tmpHome, 'tsuka.config.json'),
    JSON.stringify({
      activeProvider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434/v1', model: 'x' }, openrouter: { baseUrl: '', model: '' } },
      webSearch: { provider: 'duckduckgo' },
      activeRole: 'developer',
      activeTrait: 'professional',
      activeCharacter: 'custom',
      workspaceRoot: tmpWorkspace,
      ...extra
    }, null, 2)
  );
}

async function main() {
  console.log('=== Test tetto di contesto per singolo risultato di tool (T8.8) ===\n');

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-ctxbudget-home-'));
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-ctxbudget-ws-'));
  process.env.TSUKA_HOME = tmpHome;
  writeConfig(tmpHome, tmpWorkspace); // nessun maxToolResultTokens: default 4000

  // Import dinamico DOPO aver impostato TSUKA_HOME: CONFIG_PATH è calcolato al load del modulo.
  const { ConfigManager } = await import('../src/core/config');
  const { capForContext, getMaxToolResultTokens } = await import('../src/core/contextBudget');
  const { readFileTool } = await import('../src/tools/impl/readFile');
  const { executeCommandTool } = await import('../src/tools/impl/executeCommand');
  const { grepSearchTool } = await import('../src/tools/impl/grepSearch');
  const { isWindows } = await import('../src/core/platform');

  const CHARS_PER_TOKEN = 3.5;
  const defaultMaxTokens = getMaxToolResultTokens();
  const defaultMaxChars = Math.floor(defaultMaxTokens * CHARS_PER_TOKEN);
  check('CB0', defaultMaxTokens === 4000, `default maxToolResultTokens = ${defaultMaxTokens} (atteso 4000)`);

  // ============================================================
  // 1) capForContext — unità isolata, indipendente dalla config
  // ============================================================
  {
    const shortText = 'riga corta, nulla da tagliare';
    const untouched = capForContext(shortText, 100);
    check('CB1a', untouched === shortText, 'testo sotto il tetto torna invariato');

    const longText = 'A'.repeat(2000) + 'MEZZO' + 'B'.repeat(3000);
    const capped = capForContext(longText, 100, { label: 'testo di prova', recoveryHint: 'USA_QUESTO_SUGGERIMENTO' });
    const maxChars100 = Math.floor(100 * CHARS_PER_TOKEN); // 350
    check('CB1b', capped.length <= maxChars100, `risultato tagliato (${capped.length} car.) resta sotto il tetto (${maxChars100} car.)`);
    check('CB1c', capped.length < longText.length, 'il risultato tagliato è più corto del testo originale');
    check('CB1d', capped.includes('TAGLIATO') || capped.includes('TRUNCATED'), 'la nota di taglio è presente');
    check('CB1e', capped.includes('USA_QUESTO_SUGGERIMENTO'), 'il recoveryHint passato esplicitamente compare nella nota');
    check('CB1f', capped.startsWith('AAAA'), 'la testa del testo originale è preservata');
    check('CB1g', capped.endsWith('BBBB'), 'la coda del testo originale è preservata');
    check('CB1h', !capped.includes('MEZZO'), 'il centro (sacrificato) non compare nel risultato tagliato');
  }

  // ============================================================
  // 2) read_file — file grande (~200KB): sotto il tetto + nota di recupero
  // ============================================================
  {
    const filler = 'x'.repeat(45);
    const lines: string[] = ['HEAD_MARKER_LINE'];
    for (let i = 0; i < 4000; i++) lines.push(`${i}: ${filler}`);
    lines.push('TAIL_MARKER_LINE');
    const content = lines.join('\n');
    const bigFile = path.join(tmpWorkspace, 'big.txt');
    fs.writeFileSync(bigFile, content, 'utf-8');
    check('RF0', content.length > 190_000, `file di prova abbastanza grande (${content.length} caratteri)`);

    const result: string = await readFileTool.execute({ path: 'big.txt' });

    check('RF1', result.length <= defaultMaxChars, `read_file su file grande resta sotto il tetto (${result.length} <= ${defaultMaxChars} caratteri)`);
    check('RF2', Math.ceil(result.length / CHARS_PER_TOKEN) <= defaultMaxTokens, 'stima in token del risultato entro maxToolResultTokens');
    check('RF3', result.includes('TAGLIATO') || result.includes('TRUNCATED'), 'nota di taglio presente');
    check('RF4', /offset/i.test(result) && /grep_search/i.test(result), "la nota spiega come recuperare il resto (offset / grep_search)");
    check('RF5', result.includes('HEAD_MARKER_LINE'), "la testa del file (inizio) è preservata nel risultato");
    check('RF6', result.includes('TAIL_MARKER_LINE'), "la coda del file (fine) è preservata nel risultato");
  }

  // ============================================================
  // 3) read_file — offset/limit: finestra esatta, nessun taglio spurio
  // ============================================================
  {
    const lines: string[] = [];
    for (let i = 1; i <= 30; i++) lines.push(`LINE_${i}_END`);
    const smallFile = path.join(tmpWorkspace, 'small.txt');
    fs.writeFileSync(smallFile, lines.join('\n'), 'utf-8');

    // offset + limit: finestra esatta [10..14]
    const windowed: string = await readFileTool.execute({ path: 'small.txt', offset: 10, limit: 5 });
    check('RF7a', windowed.includes('Righe 10-14 di 30') || windowed.includes('Lines 10-14 of 30'), `intestazione corretta: ${windowed.split('\n')[0]}`);
    for (let i = 10; i <= 14; i++) check(`RF7a-${i}`, windowed.includes(`LINE_${i}_END`), `contiene LINE_${i}_END`);
    check('RF7b', !windowed.includes('LINE_9_END'), 'non contiene la riga precedente alla finestra');
    check('RF7c', !windowed.includes('LINE_15_END'), 'non contiene la riga successiva alla finestra');
    check('RF7d', !windowed.includes('TAGLIATO') && !windowed.includes('TRUNCATED'), 'finestra piccola: nessuna nota di taglio spuria');

    // solo offset (senza limit): dalla riga 25 a fine file
    const fromOffset: string = await readFileTool.execute({ path: 'small.txt', offset: 25 });
    check('RF8', fromOffset.includes('Righe 25-30 di 30') || fromOffset.includes('Lines 25-30 of 30'), `solo offset: ${fromOffset.split('\n')[0]}`);

    // solo limit (senza offset): dalla riga 1, prime 3 righe
    const onlyLimit: string = await readFileTool.execute({ path: 'small.txt', limit: 3 });
    check('RF9', onlyLimit.includes('Righe 1-3 di 30') || onlyLimit.includes('Lines 1-3 of 30'), `solo limit: ${onlyLimit.split('\n')[0]}`);

    // regressione: startLine/endLine restano invariati (comportamento pre-T8.8)
    const legacyRange: string = await readFileTool.execute({ path: 'small.txt', startLine: 2, endLine: 4 });
    check('RF10', (legacyRange.includes('Righe 2-4 di 30') || legacyRange.includes('Lines 2-4 of 30')) && legacyRange.includes('LINE_2_END') && legacyRange.includes('LINE_4_END'),
      'startLine/endLine (comportamento legacy) invariato');

    // file piccolo intero: nessuna nota di taglio, nessun cambio di comportamento
    const whole: string = await readFileTool.execute({ path: 'small.txt' });
    check('RF11', !whole.includes('TAGLIATO') && whole.includes('LINE_1_END') && whole.includes('LINE_30_END'),
      'file piccolo letto per intero, senza troncamento (nessuna regressione)');
  }

  // ============================================================
  // 4) execute_command — output enorme: resta sotto il tetto
  // ============================================================
  {
    const filler = 'z'.repeat(50);
    const bigCmd = isWindows()
      ? `1..4000 | ForEach-Object { "cmdline_$_ ${filler}" }`
      : `i=1; while [ $i -le 4000 ]; do echo "cmdline_$i ${filler}"; i=$((i+1)); done`;

    const cmdOut: string = await executeCommandTool.execute({ command: bigCmd });
    check('EC1', cmdOut.length <= defaultMaxChars, `execute_command su output enorme resta sotto il tetto (${cmdOut.length} <= ${defaultMaxChars} caratteri)`);
    check('EC2', cmdOut.includes('TAGLIATO') || cmdOut.includes('TRUNCATED'), 'nota di taglio presente sull\'output enorme');

    // Regressione: comando con output piccolo invariato (nessuna nota spuria)
    const marker = `probe_ctxbudget_${Date.now()}`;
    const echoCmd = isWindows() ? `Write-Output ${marker}` : `echo ${marker}`;
    const smallOut: string = await executeCommandTool.execute({ command: echoCmd });
    check('EC3', smallOut.includes(marker) && !smallOut.includes('TAGLIATO') && !smallOut.includes('TRUNCATED'), 'output piccolo di execute_command invariato');
  }

  // ============================================================
  // 5) grep_search — molti risultati lunghi: resta sotto il tetto
  // ============================================================
  {
    const grepDir = path.join(tmpWorkspace, 'grepbig');
    fs.mkdirSync(grepDir, { recursive: true });
    const filler = 'y'.repeat(580);
    const grepLines: string[] = [];
    for (let i = 0; i < 60; i++) grepLines.push(`NEEDLE_MARKER line ${i} ${filler}`);
    fs.writeFileSync(path.join(grepDir, 'haystack.txt'), grepLines.join('\n'), 'utf-8');

    const grepOut: string = await grepSearchTool.execute({ query: 'NEEDLE_MARKER', path: 'grepbig' });
    check('GS1', grepOut.length <= defaultMaxChars, `grep_search su molti risultati lunghi resta sotto il tetto (${grepOut.length} <= ${defaultMaxChars} caratteri)`);
    check('GS2', grepOut.includes('TAGLIATO') || grepOut.includes('TRUNCATED'), 'nota di taglio presente sui risultati grep enormi');

    // Regressione: risultato piccolo invariato (nessuna nota spuria)
    const smallGrep: string = await grepSearchTool.execute({ query: 'HEAD_MARKER_LINE' });
    check('GS3', smallGrep.includes('HEAD_MARKER_LINE') && !smallGrep.includes('TAGLIATO') && !smallGrep.includes('TRUNCATED'), 'risultato piccolo di grep_search invariato');
  }

  // ============================================================
  // 6) ConfigManager.getMaxToolResultTokens() — letto per ultimo: riscrive il config
  //    più volte, e nessuna sezione successiva dipende dallo stato del file.
  // ============================================================
  {
    writeConfig(tmpHome, tmpWorkspace); // nessun campo: default
    check('CFG1', new ConfigManager().getMaxToolResultTokens() === 4000, 'default senza maxToolResultTokens nel config = 4000');

    writeConfig(tmpHome, tmpWorkspace, { maxToolResultTokens: 1234 });
    check('CFG2', new ConfigManager().getMaxToolResultTokens() === 1234, 'valore esplicito valido onorato (1234)');

    writeConfig(tmpHome, tmpWorkspace, { maxToolResultTokens: 10 }); // sotto il minimo (256)
    check('CFG3', new ConfigManager().getMaxToolResultTokens() === 4000, 'valore sotto il minimo (256) ricade sul default (4000)');

    writeConfig(tmpHome, tmpWorkspace, { maxToolResultTokens: 'non-un-numero' });
    check('CFG4', new ConfigManager().getMaxToolResultTokens() === 4000, 'valore non numerico ricade sul default (4000)');
  }

  // Pulizia
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpWorkspace, { recursive: true, force: true }); } catch {}
  delete process.env.TSUKA_HOME;

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
