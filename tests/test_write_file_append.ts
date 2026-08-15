/**
 * Test per T9.9 — write_file: modalità 'append' per costruire un file lungo a pezzi
 * (`src/tools/impl/writeFile.ts`).
 *
 * Contesto: `content` inline in un'unica chiamata è esposto allo stesso problema
 * già affrontato per `spawn_agent` in T9.8 — una stringa JSON lunga rischia di
 * rompere la generazione della tool call su un modello locale. `append` permette
 * di scrivere un file lungo con più chiamate piccole invece di una sola gigante.
 *
 * Copre:
 *  - WA.1: senza 'append' (o append:false) il comportamento è invariato (sovrascrive);
 *  - WA.2: con append:true accoda al file esistente, non lo sovrascrive;
 *  - WA.3: append:true su un file NON esistente lo crea (nessun errore);
 *  - WA.4: la stringa "false" (non il booleano) NON viene trattata come append —
 *    guardia contro la trappola "una stringa non vuota è truthy in JS".
 *
 * Path assoluti (fuori dalla jail della workspace, stesso pattern di
 * tests/test_phase1_fixes.ts): nessun isolamento TSUKA_HOME necessario.
 *
 * Esecuzione: npx tsx tests/test_write_file_append.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { writeFileTool } from '../src/tools/impl/writeFile';

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
  console.log('=== Test write_file: modalità append (T9.9) ===\n');

  const tmpFile = path.resolve(process.cwd(), '.smoke_wa.txt');
  try {
    // WA.1: comportamento invariato senza 'append'
    fs.writeFileSync(tmpFile, 'vecchio contenuto', 'utf-8');
    await writeFileTool.execute({ path: tmpFile, content: 'nuovo contenuto' });
    check('WA.1', fs.readFileSync(tmpFile, 'utf-8') === 'nuovo contenuto', 'senza append sovrascrive interamente, come prima');

    // WA.2: append:true accoda
    await writeFileTool.execute({ path: tmpFile, content: '-pezzo2', append: true });
    await writeFileTool.execute({ path: tmpFile, content: '-pezzo3', append: true });
    check('WA.2', fs.readFileSync(tmpFile, 'utf-8') === 'nuovo contenuto-pezzo2-pezzo3', 'più chiamate con append:true accodano in ordine, nessuna sovrascrittura');

    // WA.3: append:true su file inesistente lo crea
    fs.rmSync(tmpFile, { force: true });
    await writeFileTool.execute({ path: tmpFile, content: 'creato da append', append: true });
    check('WA.3', fs.readFileSync(tmpFile, 'utf-8') === 'creato da append', 'append:true su file non esistente lo crea (prima porzione)');

    // WA.4: la STRINGA "false" non deve attivare l'append (trappola truthy)
    fs.writeFileSync(tmpFile, 'partenza', 'utf-8');
    await writeFileTool.execute({ path: tmpFile, content: 'sovrascritto', append: 'false' as any });
    check('WA.4', fs.readFileSync(tmpFile, 'utf-8') === 'sovrascritto', `append:"false" (stringa) sovrascrive come append assente, non accoda (contenuto: ${JSON.stringify(fs.readFileSync(tmpFile, 'utf-8'))})`);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
