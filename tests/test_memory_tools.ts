/**
 * Tests for T15.7 — update_memory / forget_memory tools (TASKS.md — FASE 7):
 *
 *  - New native tools are auto-discovered and carry SAFE tier + valid English schemas.
 *  - update_memory edits content/summary/kind in place and refreshes timestamps.
 *  - An update that makes one fact duplicate another collapses via the dedup rule (T14.15).
 *  - forget_memory removes the fact permanently and reports a clean boolean wrapper.
 *  - Roles that gate save_memory also expose update_memory and forget_memory.
 *  - kind resolver rejects English tokens outside the documented enum.
 *
 * Full isolation from the real user store: TSUKA_MEMORY_FILE points at a temp file before the
 * memory module is imported, so MemoryStore.getInstance() (used by the tools) and any fresh
 * instance read the same sandboxed file. ./isolateMemory is a redundant safety net on top.
 *
 * Isolated run: npx tsx tests/test_memory_tools.ts
 */
import './isolateMemory';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
  console.log('=== Test memoria: tool update_memory / forget_memory (T15.7) ===\n');

  const memFile = path.join(os.tmpdir(), `tsuka-memtools-${Date.now()}.json`);
  process.env.TSUKA_MEMORY_FILE = memFile;

  const { MemoryStore, resolveMemoryKind } = await import('../src/core/memory');
  const { createDefaultRegistry } = await import('../src/tools/index');
  const { loadToolSchema } = await import('../src/tools/registry');
  const { updateMemoryTool } = await import('../src/tools/impl/updateMemory');
  const { forgetMemoryTool } = await import('../src/tools/impl/forgetMemory');

  const store = MemoryStore.getInstance();

  // ── MT1: auto-discovery registra i due nuovi tool nativi con schemi validi ──
  {
    const registry = await createDefaultRegistry();
    const update = registry.getTool('update_memory');
    const forget = registry.getTool('forget_memory');
    const save = registry.getTool('save_memory');
    check('MT1a', !!update && update.riskLevel === 'SAFE', 'update_memory scoperto, tier SAFE');
    check('MT1b', !!forget && forget.riskLevel === 'SAFE', 'forget_memory scoperto, tier SAFE');
    check('MT1c', !!save, 'save_memory ancora presente');
    const sUpdate = loadToolSchema('update_memory');
    const sForget = loadToolSchema('forget_memory');
    const descUpdate = sUpdate?.description ?? '';
    const descForget = sForget?.description ?? '';
    check('MT1d', /^[A-Z]/.test(descUpdate) && !/[àèìòùç]/.test(descUpdate), 'schema update_memory in inglese');
    check('MT1e', /^[A-Z]/.test(descForget) && !/[àèìòùç]/.test(descForget), 'schema forget_memory in inglese');
    check('MT1f', (sUpdate?.schema?.required ?? []).includes('id'), 'update_memory richiede solo id');
    check('MT1g', (sForget?.schema?.required ?? []).includes('id'), 'forget_memory richiede solo id');
  }

  // ── MT2: update_memory modifica in place e rifresca i timestamp ──
  {
    store.clear();
    const fact = store.addFact('Port is 8080.', 'agent', { summary: 'Old label' });
    const before = fact.lastUsed;
    await new Promise((r) => setTimeout(r, 5));

    const out = await updateMemoryTool.execute({ id: fact.id, content: 'Port is now 9090.', kind: 'decision', summary: 'Service port moved' } as any);
    const parsed = JSON.parse(String(out));
    check('MT2a', parsed.ok === true && parsed.id === fact.id, 'update ritorna ok con lo stesso id');
    check('MT2b', parsed.content === 'Port is now 9090.', 'contenuto aggiornato');
    check('MT2c', parsed.summary === 'Service port moved', 'summary aggiornato');
    check('MT2d', parsed.kind === 'decisione', 'kind inglese mappato a decisione');
    const reloaded = new MemoryStore(memFile);
    const [rv] = reloaded.search('9090');
    check('MT2e', rv.content === 'Port is now 9090.' && rv.kind === 'decisione', 'modifica persistita su disco e ricaricata');
    check('MT2f', rv.lastUsed > before, 'lastUsed rifrescato dall\'update');
  }

  // ── MT3: un update che duplica un altro fatto collassa (dedup T14.15) ──
  {
    store.clear();
    const a = store.addFact('Distinct note about the API.', 'agent');
    const b = store.addFact('Original wording that will be edited.', 'agent');
    const out = await updateMemoryTool.execute({ id: b.id, content: 'Distinct note about the API.' } as any);
    const parsed = JSON.parse(String(out));
    check('MT3a', store.count() === 1, `duplicazione collassata a 1 fatto (${store.count()})`);
    check('MT3b', parsed.id === a.id, 'l\'update restituisce il fatto sopravvissuto (il primo)');
  }

  // ── MT4: forget_memory rimuove definitivamente ──
  {
    store.clear();
    const fact = store.addFact('Something to forget.', 'agent');
    const out = await forgetMemoryTool.execute({ id: fact.id } as any);
    check('MT4a', String(out).includes('"ok":true') && String(out).includes(fact.id), 'forget conferma la rimozione con id');
    check('MT4b', store.count() === 0, 'fatto rimosso dallo store');
    const again: any = await forgetMemoryTool.execute({ id: fact.id } as any).catch((e: Error) => e);
    check('MT4c', again instanceof Error && /No memory fact found/.test(again.message), 'id inesistente -> errore esplicito');
  }

  // ── MT5: i ruoli che gateano save_memory espongono anche update/forget ──
  {
    const roleFiles = fs.readdirSync(path.resolve(process.cwd(), 'roles')).filter((f) => f.endsWith('.json'));
    let checked = 0;
    for (const f of roleFiles) {
      const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'roles', f), 'utf-8'));
      const tools: string[] = [...(raw.allowedTools ?? []), ...(raw.coreTools ?? [])];
      if (tools.includes('save_memory')) {
        check(`MT5-${f}`, tools.includes('update_memory') && tools.includes('forget_memory'),
          `${f}: save_memory presente -> anche update_memory e forget_memory`);
        checked++;
      }
    }
    check('MT5-count', checked === 20, `20 ruoli gateano i tool di memoria (verificati: ${checked})`);
  }

  // ── MT6: resolver dei kind inglesi ──
  {
    check('MT6a', resolveMemoryKind('lesson') === 'lezione', 'lesson -> lezione');
    check('MT6b', resolveMemoryKind('Facts') === 'fatto', 'Facts (case-insensitive) -> fatto');
    check('MT6c', resolveMemoryKind('run') === 'run', 'run -> run');
    let threw = false;
    try { resolveMemoryKind('pizza'); } catch { threw = true; }
    check('MT6d', threw, 'token fuori enum -> throw');
  }

  fs.rmSync(memFile, { force: true });

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});