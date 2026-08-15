import { auditCodeTool } from '../src/tools/impl/auditCode';
import { loadRole, loadCharacter, resolveCharacter } from '../src/cli/shared';

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
  console.log('=== Test Agent Cybersecurity, Ruolo e Tool Audit (T8.18) ===\n');

  // Test 1: Caricamento Ruolo `security_auditor`
  {
    const role = loadRole('security_auditor');
    check('SEC1a', role !== null, "il ruolo 'security_auditor' esiste ed è caricabile");
    check('SEC1b', role?.allowedTools.includes('audit_code') === true, "il ruolo 'security_auditor' include il tool 'audit_code'");
    check('SEC1c', role?.reasoningEffort === 'xhigh', "il ruolo 'security_auditor' imposta reasoningEffort: 'xhigh'");
    check('SEC1d', role?.creativity === 'precise', "il ruolo 'security_auditor' imposta creativity: 'precise'");
  }

  // Test 2: Caricamento Personaggio `sentinel`
  {
    const char = loadCharacter('sentinel');
    check('SEC2a', char !== null, "il personaggio 'sentinel' esiste ed è caricabile");
    check('SEC2b', char?.role === 'security_auditor', "il personaggio 'sentinel' usa il ruolo 'security_auditor'");
    check('SEC2c', char?.creativity === 'precise', "il personaggio 'sentinel' imposta creativity: 'precise'");

    const resolved = resolveCharacter('sentinel');
    check('SEC2d', resolved !== null && resolved.name === 'sentinel', "resolveCharacter('sentinel') risolve correttamente il personaggio");
  }

  // Test 3: Esecuzione del Tool `audit_code`
  {
    const result = await auditCodeTool.execute({ targetPath: '.' });
    check('SEC3a', typeof result === 'string', "il tool 'audit_code' viene eseguito correttamente e restituisce una stringa");
    check('SEC3b', result.includes('Audit') || result.includes('🛡️'), "il report di 'audit_code' contiene l'intestazione dell'audit");
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test security agent:', err);
  process.exit(1);
});
