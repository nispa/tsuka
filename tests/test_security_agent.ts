import { auditCodeTool } from '../src/tools/impl/auditCode';
import { loadRole, loadCharacter, resolveCharacter } from '../src/cli/shared';
import { characterWithRole } from './fixtures/roster';


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

  // Test 2: chi esercita il mestiere 'security_auditor' nel catalogo installato
  {
    const char = characterWithRole('security_auditor');
    check('SEC2a', !!char, `il ruolo 'security_auditor' è coperto da un personaggio installato (@${char.name})`);
    check('SEC2b', (char.roles || [char.role]).includes('security_auditor'), `@${char.name} dichiara il ruolo 'security_auditor'`);
    check('SEC2c', (char.creativity || role?.creativity) === 'precise', `l'auditor gira con creativity 'precise' (personaggio o ruolo)`);

    // resolveCharacter accetta sia il nome sia il MESTIERE
    const byName = resolveCharacter(char.name);
    const byCraft = resolveCharacter('security_auditor');
    check('SEC2d',
      byName?.name === char.name && byCraft?.name === char.name,
      `resolveCharacter risolve sia per nome ('${char.name}') sia per mestiere ('security_auditor')`);
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
