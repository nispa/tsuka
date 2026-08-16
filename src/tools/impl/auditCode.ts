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
    description: 'Possible hardcoded API key, token, or password.'
  },
  {
    type: 'Insecure Dynamic Execution',
    severity: 'HIGH',
    regex: /\beval\s*\(|\bnew\s+Function\s*\(|\bexec\s*\(/,
    description: 'Dynamic code execution call posing potential RCE risk.'
  },
  {
    type: 'Insecure SQL Query',
    severity: 'HIGH',
    regex: /(SELECT|INSERT|UPDATE|DELETE)\s+.*\s+\+\s*[\w\$]+/i,
    description: 'Direct string concatenation in SQL queries (potential SQL injection).'
  },
  {
    type: 'Weak Cryptographic Algorithm',
    severity: 'MEDIUM',
    regex: /crypto\.createHash\s*\(\s*["'](md5|sha1)["']\s*\)/i,
    description: 'Weak or collision-vulnerable hash algorithm (MD5/SHA1).'
  },
  {
    type: 'Hardcoded IP / Endpoint',
    severity: 'LOW',
    regex: /\b(?:http:\/\/)?(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/,
    description: 'Hardcoded IP address detected in source code.'
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
      throw new Error(`Security audit error: ${err.message}`);
    }

    if (issues.length === 0) {
      return `🛡️ Security audit completed successfully: scanned ${filesScanned} file(s) in '${args.targetPath || '.'}', no issues found.`;
    }

    const highCount = issues.filter(i => i.severity === 'HIGH').length;
    const mediumCount = issues.filter(i => i.severity === 'MEDIUM').length;
    const lowCount = issues.filter(i => i.severity === 'LOW').length;

    let report = `🛡️ Security Audit Report ('${args.targetPath || '.'}'):\n`;
    report += `Scanned files: ${filesScanned} | Issues found: ${issues.length} (HIGH: ${highCount}, MEDIUM: ${mediumCount}, LOW: ${lowCount})\n\n`;

    issues.forEach((issue, idx) => {
      report += `[${idx + 1}] [${issue.severity}] ${issue.type} in ${issue.filePath}:${issue.line}\n`;
      report += `    Description: ${issue.description}\n`;
      report += `    Code snippet: "${issue.snippet}"\n\n`;
    });

    return capForContext(report, undefined, {
      label: `audit_code report`,
      recoveryHint: `Narrow audit target path to a specific subdirectory.`
    });
  }
};
