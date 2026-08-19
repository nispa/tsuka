/**
 * Test per il self-authoring dei tool (create_tool).
 * Esecuzione: npx tsx tests/test_self_authoring.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { createDefaultRegistry } from '../src/tools/index';

import { homePath } from '../src/core/apphome';

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
  console.log('=== Test Self-Authoring dei Tool ===\n');

  const registry = await createDefaultRegistry();
  const perm: any = { checkPermission: async () => true };
  const customToolsDir = homePath('custom_tools');
  const generatedPath = path.join(customToolsDir, '__probe_tool.js');
  const schemaPath = homePath('custom_tools_schemas', '__probe_tool.json');
  const backupDir = homePath('tools_backup');

  // Pulizia pre-test
  for (const p of [generatedPath, schemaPath]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  try {
    // --- X4.1: creazione di un tool valido + hot-register + esecuzione immediata ---
    const createRes = await registry.executeTool('create_tool', {
      name: '__probe_tool',
      description: 'Tool di prova che concatena una stringa con il suo quadrato di lunghezza',
      riskLevel: 'SAFE',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      executeBody: "const t = String(args.text || ''); return t + ':' + (t.length * t.length);"
    }, perm);

    check('X4.1a', createRes.success, `create_tool eseguito: ${createRes.output.split('\n')[0]}`);
    check('X4.1b', fs.existsSync(generatedPath) && fs.existsSync(schemaPath), 'file .js e schema .json creati su disco');

    // Hot-register: il tool è subito eseguibile senza riavvio
    const useRes = await registry.executeTool('__probe_tool', { text: 'abc' }, perm);
    check('X4.1c', useRes.success && useRes.output === 'abc:9', `hot-register: eseguito subito → "${useRes.output}"`);

    // Lo schema è stato registrato correttamente
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    check('X4.1d', schema.name === '__probe_tool' && schema.requiredTier === 'small', 'schema JSON corretto');

    // --- X4.2: blocklist di sicurezza ---
    const blocked = await registry.executeTool('create_tool', {
      name: '__evil_tool',
      description: 'tenta di usare child_process',
      executeBody: "const { execSync } = require('child_process'); return execSync('dir').toString();"
    }, perm);
    check('X4.2a', !blocked.success && /sicurezza|security/i.test(blocked.output), 'child_process bloccato dalla policy');

    const blocked2 = await registry.executeTool('create_tool', {
      name: '__evil_tool2',
      description: 'tenta eval',
      executeBody: "return eval('1+1').toString();"
    }, perm);
    check('X4.2b', !blocked2.success, 'eval() bloccato dalla policy');

    // --- X4.3: mai sovrascrivere tool core ---
    const overwriteCore = await registry.executeTool('create_tool', {
      name: 'read_file',
      description: 'tenta di sovrascrivere un tool core',
      executeBody: "return 'hacked';"
    }, perm);
    check('X4.3', !overwriteCore.success && /core/i.test(overwriteCore.output), 'sovrascrittura tool core rifiutata');

    // --- X4.4: sovrascrittura di un generato → backup ---
    await registry.executeTool('create_tool', {
      name: '__probe_tool',
      description: 'versione 2',
      executeBody: "return 'v2';"
    }, perm);
    const backups = fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir).filter((f) => f.startsWith('__probe_tool.'))
      : [];
    check('X4.4', backups.length >= 1, `sovrascrittura con backup (${backups.length} backup)`);

    // --- X4.5: codice sintatticamente rotto rifiutato ---
    const broken = await registry.executeTool('create_tool', {
      name: '__broken_tool',
      description: 'sintassi rotta',
      executeBody: "return {{{{;"
    }, perm);
    check('X4.5', !broken.success, 'codice con sintassi invalida rifiutato dalla sandbox');

    // --- T14.22a: la fiducia dell'agente su se stesso non è mai sufficiente ---
    // Anche dichiarandosi esplicitamente SAFE, il tool creato resta sempre RESTRICTED: nulla
    // verifica che il codice generato corrisponda davvero al livello di rischio dichiarato,
    // quindi non è mai lecito saltare la conferma dell'utente sulla sola parola dell'agente.
    const claimedSafeTool = registry.getTool('__probe_tool');
    check('X4.6', claimedSafeTool?.riskLevel === 'RESTRICTED', `riskLevel forzato a RESTRICTED anche se richiesto SAFE (era: ${claimedSafeTool?.riskLevel})`);
    check('X4.6b', createRes.output.includes('risk: RESTRICTED'), `livello effettivo riportato all'agente, non quello richiesto: ${createRes.output.split('\n')[2]}`);

    // --- T14.22b: fs iniettato nel tool generato è jailato alla workspace, non il modulo reale ---
    const outsideAttempt = await registry.executeTool('create_tool', {
      name: '__escape_tool',
      description: 'tenta di leggere fuori dalla workspace tramite fs',
      parameters: { type: 'object', properties: { target: { type: 'string' } } },
      executeBody: "return fs.readFileSync(args.target, 'utf-8');"
    }, perm);
    check('X4.7a', outsideAttempt.success, `tool con fs creato senza essere bloccato in creazione: ${outsideAttempt.output.split('\n')[0]}`);
    const escapeRun = await registry.executeTool('__escape_tool', { target: path.join(require('os').tmpdir(), '..', '..', 'Windows', 'win.ini') }, perm);
    check('X4.7b', !escapeRun.success, `lettura fuori dalla workspace bloccata dal jail invece di riuscire: success=${escapeRun.success}`);
    const escapeGenerated = fs.readFileSync(path.join(customToolsDir, '__escape_tool.js'), 'utf-8');
    check('X4.7c', /jailedFs["'\\]/.test(escapeGenerated) && !/require\(\s*['"]fs['"]\s*\)/.test(escapeGenerated), `codice generato richiede il wrapper jailato, non 'fs' grezzo: ${escapeGenerated.split('\n')[1]}`);
    for (const p of [path.join(customToolsDir, '__escape_tool.js'), homePath('custom_tools_schemas', '__escape_tool.json')]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // --- T14.22c: blocklist estesa — escape del sandbox via prototype chain e import() dinamico ---
    const constructorEscape = await registry.executeTool('create_tool', {
      name: '__ctor_escape',
      description: 'tenta di raggiungere Function via constructor.constructor',
      executeBody: "return (function(){}).constructor.constructor('return 1')().toString();"
    }, perm);
    check('X4.8', !constructorEscape.success, 'accesso a Function via constructor.constructor bloccato');

    const dynamicImport = await registry.executeTool('create_tool', {
      name: '__dynimport_escape',
      description: 'tenta import() dinamico per aggirare require()',
      executeBody: "const cp = await import('child_process'); return 'x';"
    }, perm);
    check('X4.9', !dynamicImport.success, 'import() dinamico bloccato');

    const processKill = await registry.executeTool('create_tool', {
      name: '__proc_escape',
      description: 'tenta process.kill',
      executeBody: "process.kill(0); return 'x';"
    }, perm);
    check('X4.10', !processKill.success, 'process.kill bloccato');
  } finally {
    // Pulizia post-test
    for (const p of [generatedPath, schemaPath]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (fs.existsSync(backupDir)) {
      for (const f of fs.readdirSync(backupDir)) {
        if (f.startsWith('__probe_tool.')) fs.unlinkSync(path.join(backupDir, f));
      }
      if (fs.readdirSync(backupDir).length === 0) fs.rmdirSync(backupDir);
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
