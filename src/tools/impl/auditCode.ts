import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath, isBinaryFile } from './utils';
import { capForContext } from '../../core/contextBudget';

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB per file

interface SecurityIssue {
  filePath: string;
  line: number;
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  snippet: string;
}

const SECURITY_PATTERNS: Array<{
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  regex: RegExp;
  description: string;
}> = [
  {
    type: 'Hardcoded Secret',
    severity: 'HIGH',
    regex: /(?:api[_-]?key|secret|password|passwd|auth[_-]?token|private[_-]?key)\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    description: 'Possibile chiave API o segreto hardcoded nel codice.'
  },
  {
    type: 'Insecure Dynamic Execution',
    severity: 'HIGH',
    regex: /\beval\s*\(|\bnew\s+Function\s*\(|\bexec\s*\(/,
    description: 'Uso di funzioni di esecuzione dinamica a rischio Remote Code Execution (RCE).'
  },
  {
    type: 'Insecure SQL Query',
    severity: 'HIGH',
    regex: /(SELECT|INSERT|UPDATE|DELETE)\s+.*\s+\+\s*[\w\$]+/i,
    description: 'Concatenazione diretta di stringhe in query SQL (possibile SQL Injection).'
  },
  {
    type: 'Weak Cryptographic Algorithm',
    severity: 'MEDIUM',
    regex: /crypto\.createHash\s*\(\s*["'](md5|sha1)["']\s*\)/i,
    description: 'Uso di algoritmo di hashing debole o vulnerabile a collisioni (MD5/SHA1).'
  },
  {
    type: 'Hardcoded IP / Endpoint',
    severity: 'LOW',
    regex: /\b(?:http:\/\/)?(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/,
    description: 'Indirizzo IP hardcoded presente nel codice.'
  }
];

export const auditCodeTool: Tool = {
  name: 'audit_code',
  riskLevel: 'SAFE',
  execute: async (args: { targetPath?: string }) => {
    const targetDir = resolveSafePath(args.targetPath || '.');
    const issues: SecurityIssue[] = [];
    let filesScanned = 0;

    function scan(currentPath: string) {
      const stat = fs.statSync(currentPath);

      if (stat.isDirectory()) {
        const items = fs.readdirSync(currentPath);
        for (const item of items) {
          if (item === '.git' || item === 'node_modules' || item === 'dist' || item === 'coverage') continue;
          scan(path.join(currentPath, item));
        }
      } else if (stat.isFile()) {
        if (stat.size > MAX_FILE_SIZE_BYTES) return;
        if (isBinaryFile(currentPath)) return;
        if (currentPath.endsWith('.json') && currentPath.includes('package-lock.json')) return;

        filesScanned++;
        const content = fs.readFileSync(currentPath, 'utf-8');
        const lines = content.split(/\r?\n/);

        lines.forEach((line, index) => {
          for (const pattern of SECURITY_PATTERNS) {
            if (pattern.regex.test(line)) {
              const relPath = path.relative(process.cwd(), currentPath);
              issues.push({
                filePath: relPath,
                line: index + 1,
                type: pattern.type,
                severity: pattern.severity,
                description: pattern.description,
                snippet: line.trim()
              });
            }
          }
        });
      }
    }

    try {
      scan(targetDir);
    } catch (err: any) {
      throw new Error(`Errore durante l'audit di sicurezza: ${err.message}`);
    }

    if (issues.length === 0) {
      return `🛡️ Audit di sicurezza completato con successo: analizzati ${filesScanned} file in '${args.targetPath || '.'}', nessuna criticità rilevata.`;
    }

    const highCount = issues.filter(i => i.severity === 'HIGH').length;
    const mediumCount = issues.filter(i => i.severity === 'MEDIUM').length;
    const lowCount = issues.filter(i => i.severity === 'LOW').length;

    let report = `🛡️ Report Audit di Sicurezza ('${args.targetPath || '.'}'):\n`;
    report += `File analizzati: ${filesScanned} | Criticità: ${issues.length} (HIGH: ${highCount}, MEDIUM: ${mediumCount}, LOW: ${lowCount})\n\n`;

    issues.forEach((issue, idx) => {
      report += `[${idx + 1}] [${issue.severity}] ${issue.type} in ${issue.filePath}:${issue.line}\n`;
      report += `    Descrizione: ${issue.description}\n`;
      report += `    Codice: "${issue.snippet}"\n\n`;
    });

    return capForContext(report, undefined, {
      label: `report audit_code`,
      recoveryHint: `Restringi la scansione specificando "targetPath" su una sottocartella.`
    });
  }
};
