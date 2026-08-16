import * as fs from 'fs';
import * as path from 'path';
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

  // Test 3: Esecuzione del Tool `audit_code` di base
  {
    const result = await auditCodeTool.execute({ targetPath: '.' });
    check('SEC3a', typeof result === 'string', "il tool 'audit_code' viene eseguito correttamente e restituisce una stringa");
    check('SEC3b', result.includes('Audit') || result.includes('🛡️'), "il report di 'audit_code' contiene l'intestazione dell'audit");
  }

  // Test 4: Esecuzione avanzata su cartella temporanea con vulnerabilità simulate
  {
    const tempTestDir = path.join(__dirname, 'tmp_security_audit_test');
    if (!fs.existsSync(tempTestDir)) fs.mkdirSync(tempTestDir, { recursive: true });

    try {
      const vulnFile = path.join(tempTestDir, 'vulnerable_sample.js');
      fs.writeFileSync(vulnFile, [
        'const key = "AKIA1234567890ABCDEF";',
        'const query = "SELECT * FROM users WHERE id = " + req.params.id;',
        'const md5Hash = crypto.createHash("md5").update(data).digest("hex");',
        'const unsafeAgent = new https.Agent({ rejectUnauthorized: false });',
        'eval("const x = 10;");'
      ].join('\n'), 'utf-8');

      // 4a. Scansione completa su vulnerable_sample.js
      const relVulnDir = path.relative(process.cwd(), tempTestDir);
      const auditAll = await auditCodeTool.execute({ targetPath: relVulnDir, severityThreshold: 'LOW' });
      check('SEC4a', auditAll.includes('CWE-798') || auditAll.includes('AKIA'), "rileva chiave AWS hardcoded (CWE-798)");
      check('SEC4b', auditAll.includes('CWE-89') || auditAll.includes('SQL Injection'), "rileva SQL Injection (CWE-89)");
      check('SEC4c', auditAll.includes('CWE-327') || auditAll.includes('Weak Cryptographic Hash'), "rileva hash MD5 debole (CWE-327)");
      check('SEC4d', auditAll.includes('CWE-295') || auditAll.includes('Disabled TLS Certificate'), "rileva disabilitazione TLS (CWE-295)");
      check('SEC4e', auditAll.includes('CWE-95') || auditAll.includes('Insecure Dynamic Code Execution'), "rileva eval/RCE (CWE-95)");

      // 4b. Filtro per severità HIGH
      const auditHighOnly = await auditCodeTool.execute({ targetPath: relVulnDir, severityThreshold: 'HIGH' });
      check('SEC4f', !auditHighOnly.includes('CWE-327'), "il filtro HIGH esclude correttamente le issue di livello MEDIUM (MD5)");
      check('SEC4g', auditHighOnly.includes('CWE-798') || auditHighOnly.includes('CWE-95'), "il filtro HIGH mantiene le issue critiche (eval / token)");

      // 4c. Filtro estensione file
      const auditPyOnly = await auditCodeTool.execute({ targetPath: relVulnDir, fileExtensions: ['.py'] });
      check('SEC4h', auditPyOnly.includes('0 issues found') || auditPyOnly.includes('scanned 0 file'), "il filtro fileExtensions ignora file con estensioni non corrispondenti");

    } finally {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test security agent:', err);
  process.exit(1);
});
