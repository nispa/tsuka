/**
 * Test scope per workspace e retrieval per rilevanza della memoria condivisa (T6.1,
 * TASKS.md — FASE 2). Copre i 4 punti dell'accettazione:
 * (a) isolamento per scope + fatti 'globale' visibili da tutte le workspace;
 * (b) retrocompatibilità di un memory.json nel formato vecchio;
 * (c) search() con scoring OR invece dell'AND rigido (query multi-parola);
 * (d) eviction a punteggio: pinned mai espulso, si espelle il meno rilevante.
 *
 * Non tocca mai memory/memory.json reale (usato dal singleton MemoryStore.getInstance()):
 * ogni MemoryStore qui è costruito su un file temporaneo dedicato, cancellato a fine test.
 * Esecuzione: npx tsx tests/test_memory_scope.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore, GLOBAL_SCOPE } from '../src/core/memory';

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

function tmpPath(name: string): string {
  return path.resolve(process.cwd(), `.smoke_${name}.json`);
}

function cleanup(p: string) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

async function main() {
  console.log('=== Test memoria: scope per workspace e retrieval per rilevanza (T6.1) ===\n');

  // --- (a) isolamento per scope + fatto 'globale' visibile da entrambe ---
  {
    const file = tmpPath('scope_ab');
    cleanup(file);

    // Ogni scrittura usa un'istanza fresca (rilegge il file appena creato) — come fa
    // il singleton MemoryStore.getInstance() con reloadIfChanged() prima di ogni uso:
    // istanze "stantie" con lo stesso file sovrascriverebbero le scritture altrui
    // (read-modify-write in memoria, non un merge), non è lo scope il punto qui.
    new MemoryStore(file, 200, 'workspaceA').addFact('Il progetto A usa TypeScript rigoroso', 'utente');
    new MemoryStore(file, 200, 'workspaceB').addFact('Il progetto B usa Python con type hints', 'utente');
    // Fatto esplicitamente globale, visibile da entrambe indipendentemente dallo scope di chi scrive
    new MemoryStore(file, 200, 'workspaceA').addFact('Regola comune a tutti i progetti: mai committare segreti', 'utente', { scope: GLOBAL_SCOPE });

    const storeA2 = new MemoryStore(file, 200, 'workspaceA');
    const storeB2 = new MemoryStore(file, 200, 'workspaceB');

    check('T6.1a-1', storeB2.search('TypeScript rigoroso').length === 0,
      'il fatto salvato in workspaceA non è visibile da workspaceB');
    // Nota: query volutamente senza 'type' — sarebbe una substring di 'TypeScript'
    // nel fatto di A e produrrebbe un match spurio via OR-scoring, non una violazione di scope.
    check('T6.1a-2', storeA2.search('Python suggerimenti').length === 0,
      'il fatto salvato in workspaceB non è visibile da workspaceA');
    check('T6.1a-3',
      storeA2.search('segreti').length === 1 && storeB2.search('segreti').length === 1,
      'il fatto scope=globale è visibile da entrambe le workspace');
    check('T6.1a-4', storeA2.count() === 2 && storeB2.count() === 2,
      `count() è scoped: A vede i suoi 2 (privato+globale) (${storeA2.count()}), B pure (${storeB2.count()})`);

    cleanup(file);
  }

  // --- (b) memory.json nel formato vecchio si carica senza perdere fatti ---
  {
    const file = tmpPath('legacy_format');
    cleanup(file);

    const legacy = {
      facts: [
        { id: 'legacy-1', content: 'Fatto salvato prima di T6.1', source: 'vecchio_agente', timestamp: '2025-01-01T10:00:00.000Z' },
        { id: 'legacy-2', content: 'Un secondo fatto senza scope/kind/hits', source: 'vecchio_agente', timestamp: '2025-01-02T10:00:00.000Z' },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(legacy, null, 2), 'utf-8');

    // Uno scope qualsiasi, diverso da 'globale': i fatti legacy devono comunque
    // essere visibili perché normalizzati a scope='globale' al caricamento.
    const store = new MemoryStore(file, 200, 'una-workspace-qualsiasi');
    check('T6.1b-1', store.count() === 2, `nessun fatto perso nel caricamento del formato vecchio (${store.count()})`);
    const f1 = store.search('salvato prima')[0];
    check('T6.1b-2', !!f1 && f1.scope === GLOBAL_SCOPE, `fatto senza scope normalizzato a '${GLOBAL_SCOPE}' (letto: '${f1?.scope}')`);
    check('T6.1b-3', !!f1 && f1.kind === 'fatto' && typeof f1.hits === 'number' && typeof f1.lastUsed === 'string',
      'campi nuovi (kind/hits/lastUsed) presenti con default sensati sui fatti legacy');

    cleanup(file);
  }

  // --- (c) search() con scoring OR: query multi-parola senza un fatto che le contiene tutte ---
  {
    const file = tmpPath('or_scoring');
    cleanup(file);

    const store = new MemoryStore(file, 200, 'scope-c');
    store.addFact('Il server usa PostgreSQL come database principale', 'test'); // 2 keyword su 4
    store.addFact('Il frontend è scritto in React con TypeScript', 'test');     // 1 keyword su 4
    store.addFact('Ricetta della torta di mele della nonna', 'test');           // 0 keyword

    const results = store.search('server database TypeScript inesistente');
    check('T6.1c-1', results.length > 0,
      `query multi-parola senza match totale: oggi (AND rigido) darebbe 0, con OR-scoring ne dà ${results.length}`);
    check('T6.1c-2', results.length === 2, `solo i fatti con almeno una keyword sono inclusi (trovati: ${results.length})`);
    check('T6.1c-3', results[0].content.includes('PostgreSQL'),
      'il fatto con più keyword in comune (2 su 4) è il primo in ordine di punteggio');
    check('T6.1c-4', results[1].content.includes('TypeScript'), 'il fatto con 1 keyword in comune segue quello con 2');

    cleanup(file);
  }

  // --- (d) eviction a punteggio: pinned mai espulso, si espelle il meno rilevante (non il più vecchio in assoluto) ---
  {
    const file = tmpPath('eviction_score');
    cleanup(file);

    const store = new MemoryStore(file, 3, 'scope-d');

    // Il più vecchio di tutti: sarebbe il primo a cadere con FIFO, ma è pinned.
    const fPinned = store.addFact('Policy di sicurezza fissa: non esporre mai le chiavi API', 'utente', { pinned: true });
    // Secondo più vecchio: verrà interrogato (hits) prima che scatti l'eviction.
    const fBoosted = store.addFact('Dettaglio tecnico interrogato spesso dagli agenti', 'agente');
    // Terzo: mai interrogato, resta "irrilevante".
    const fNormal = store.addFact('Nota minore mai più consultata', 'agente');

    // Porta i "hits" di fBoosted sopra zero prima che scatti l'eviction
    const boostHits = store.search('interrogato spesso');
    check('T6.1d-pre', boostHits.length === 1 && boostHits[0].id === fBoosted.id, 'setup: search ha trovato ed è quello giusto ad essere "usato"');

    // 4° fatto: fa scattare l'eviction (cap=3)
    const fNew = store.addFact('Nota appena creata', 'agente');

    const survivingIds = new Set((store.getRecent(50)).map((f) => f.id));
    check('T6.1d-1', survivingIds.has(fPinned.id), 'il fatto pinned (il più vecchio di tutti) sopravvive sempre');
    check('T6.1d-2', survivingIds.has(fBoosted.id), 'il fatto con hits > 0 sopravvive anche se più vecchio del normale');
    check('T6.1d-3', !survivingIds.has(fNormal.id), 'il fatto mai interrogato (il meno rilevante tra i non-pinned) viene espulso');
    check('T6.1d-4', survivingIds.has(fNew.id), 'il fatto appena creato che ha fatto scattare l\'eviction resta');
    check('T6.1d-5', store.count() === 3, `il totale resta al cap dopo l'eviction (${store.count()})`);

    cleanup(file);
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
