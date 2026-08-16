import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath, isBinaryFile } from './utils';
import { capForContext } from '../../core/contextBudget';

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB per file limit
const DEFAULT_MAX_ISSUES = 50;

export type SecuritySeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SecurityIssue {
  filePath: string;
  line: number;
  cwe: string;
  type: string;
  severity: SecuritySeverity;
  description: string;
  remediation: string;
  snippet: string;
}

interface SecurityRule {
  cwe: string;
  type: string;
  severity: SecuritySeverity;
  regex: RegExp;
  description: string;
  remediation: string;
  skipComments?: boolean;
}

const PLACEHOLDER_KEYWORDS = [
  'your-api-key',
  'your_api_key',
  'change_me',
  'changeme',
  'example',
  'placeholder',
  'todo',
  'dummy',
  'dummy_key',
  'test_secret',
  'fake_token',
  'xxx',
  '00000000'
];

const SECURITY_RULES: SecurityRule[] = [
  // 1. Hardcoded Secrets & Tokens (CWE-798)
  {
    cwe: 'CWE-798',
    type: 'Hardcoded Cloud/API Token (OpenAI)',
    severity: 'HIGH',
    regex: /\bsk-[a-zA-Z0-9]{20,}\b/,
    description: 'Hardcoded OpenAI API key identified.',
    remediation: 'Load API keys via environment variables (process.env.OPENAI_API_KEY) or a secure secrets manager.',
    skipComments: true
  },
  {
    cwe: 'CWE-798',
    type: 'Hardcoded Cloud/API Token (AWS)',
    severity: 'HIGH',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    description: 'Hardcoded AWS Access Key ID detected.',
    remediation: 'Use AWS IAM Roles or AWS credential environment variables instead of hardcoding keys.',
    skipComments: true
  },
  {
    cwe: 'CWE-798',
    type: 'Hardcoded VCS Token (GitHub)',
    severity: 'HIGH',
    regex: /\b(?:ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{22,})\b/,
    description: 'Hardcoded GitHub Personal Access Token detected.',
    remediation: 'Store GitHub tokens in environment secrets or .env (added to .gitignore).',
    skipComments: true
  },
  {
    cwe: 'CWE-798',
    type: 'Hardcoded Private Key (PEM)',
    severity: 'HIGH',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/,
    description: 'Unencrypted private cryptographic key embedded in source code.',
    remediation: 'Move cryptographic private keys out of repository into a dedicated key vault or file outside VCS.',
    skipComments: false
  },
  {
    cwe: 'CWE-798',
    type: 'Hardcoded JWT Token',
    severity: 'MEDIUM',
    regex: /\beyJ[A-Za-z0-9-_=]{10,}\.[A-Za-z0-9-_=]{10,}\.?[A-Za-z0-9-_.+/=]*\b/,
    description: 'Hardcoded JSON Web Token (JWT) detected.',
    remediation: 'Generate or pass JWT tokens dynamically at runtime; never commit static tokens.',
    skipComments: true
  },
  {
    cwe: 'CWE-798',
    type: 'Generic Hardcoded Credential',
    severity: 'HIGH',
    regex: /(?:api[_-]?key|secret|password|passwd|auth[_-]?token|private[_-]?key)\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    description: 'Possible hardcoded API key, secret, or password assignment.',
    remediation: 'Extract credentials to environment variables or config files excluded by .gitignore.',
    skipComments: true
  },

  // 2. Command Injection & Arbitrary Execution (CWE-78 / CWE-95)
  {
    cwe: 'CWE-78',
    type: 'OS Command Injection Risk',
    severity: 'HIGH',
    regex: /\b(?:child_process\.(?:exec|execSync)|exec\s*\(|execSync\s*\(|os\.system\s*\(|subprocess\.Popen\s*\([^)]*shell\s*=\s*True)\b/,
    description: 'Execution of OS shell commands with potentially unescaped input.',
    remediation: 'Use child_process.execFile or spawn with array arguments instead of shell execution string.',
    skipComments: true
  },
  {
    cwe: 'CWE-95',
    type: 'Insecure Dynamic Code Execution (RCE)',
    severity: 'HIGH',
    regex: /\b(?:eval\s*\(|new\s+Function\s*\(|vm\.runInThisContext\s*\(|execScript\s*\()/,
    description: 'Direct dynamic code evaluation posing Remote Code Execution (RCE) risk.',
    remediation: 'Avoid eval/new Function. Use safe JSON parsers or isolated sandboxes with explicit allowlists.',
    skipComments: true
  },

  // 3. SQL Injection (CWE-89)
  {
    cwe: 'CWE-89',
    type: 'SQL Injection Vulnerability',
    severity: 'HIGH',
    regex: /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION)\s+.*\s+(?:\+|\$\{.*\}|concat\s*\()/i,
    description: 'String concatenation or template interpolation inside dynamic SQL query.',
    remediation: 'Use parameterized queries or ORM prepared statements with bound parameters.',
    skipComments: true
  },

  // 4. Path Traversal & Arbitrary File Access (CWE-22)
  {
    cwe: 'CWE-22',
    type: 'Path Traversal Risk',
    severity: 'MEDIUM',
    regex: /\b(?:fs\.(?:readFile|readFileSync|writeFile|writeFileSync|unlink|unlinkSync)|open)\s*\([^)]*(?:\+|path\.join\([^)]*(?:req\.|params\.|query\.))/,
    description: 'Filesystem operation with concatenated or un-sanitized user-controlled path.',
    remediation: 'Validate paths using path.resolve() and ensure target starts with allowed base directory.',
    skipComments: true
  },

  // 5. Cross-Site Scripting (DOM XSS) (CWE-79)
  {
    cwe: 'CWE-79',
    type: 'DOM-based XSS Risk',
    severity: 'MEDIUM',
    regex: /(?:\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|\$\([^)]+\)\.html\s*\()/,
    description: 'Direct insertion of unescaped HTML content into the DOM.',
    remediation: 'Use textContent, innerText, or sanitize HTML inputs with DOMPurify before insertion.',
    skipComments: true
  },

  // 6. Broken Cryptography & Insecure Hashes (CWE-327)
  {
    cwe: 'CWE-327',
    type: 'Weak Cryptographic Hash (MD5/SHA1)',
    severity: 'MEDIUM',
    regex: /crypto\.createHash\s*\(\s*["'](md5|sha1)["']\s*\)/i,
    description: 'Cryptographically broken or collision-prone hash algorithm (MD5 or SHA1).',
    remediation: 'Upgrade to SHA-256 (crypto.createHash("sha256")) or password hashing algorithms (bcrypt/argon2).',
    skipComments: true
  },
  {
    cwe: 'CWE-327',
    type: 'Insecure Cipher Algorithm (DES/RC4)',
    severity: 'HIGH',
    regex: /crypto\.createCipher(?:iv)?\s*\(\s*["'](?:des|rc4|blowfish)["']/i,
    description: 'Use of deprecated or weak cipher algorithm.',
    remediation: 'Use AES-256-GCM (crypto.createCipheriv("aes-256-gcm", key, iv)) for authenticated encryption.',
    skipComments: true
  },

  // 7. Insecure TLS / SSL Validation Disabled (CWE-295)
  {
    cwe: 'CWE-295',
    type: 'Disabled TLS Certificate Verification',
    severity: 'HIGH',
    regex: /\b(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?|verify\s*=\s*False)\b/i,
    description: 'TLS certificate verification is disabled, allowing Man-in-the-Middle (MitM) attacks.',
    remediation: 'Enable TLS validation (rejectUnauthorized: true). Install valid CA certificates if in development.',
    skipComments: true
  },

  // 8. Sensitive Data in Logs (CWE-532)
  {
    cwe: 'CWE-532',
    type: 'Sensitive Credential Exposure in Logs',
    severity: 'LOW',
    regex: /console\.(?:log|debug|info|warn|error)\s*\([^)]*(?:password|passwd|secret|api_key|apiKey|authToken|privateKey)[^)]*\)/i,
    description: 'Logging variables that likely contain sensitive credentials.',
    remediation: 'Mask or redact sensitive fields before printing to log streams or console.',
    skipComments: true
  },

  // 9. Overly Permissive File Permissions (CWE-732)
  {
    cwe: 'CWE-732',
    type: 'Permissive File Permissions (chmod 777)',
    severity: 'MEDIUM',
    regex: /\b(?:chmodSync|chmod)\s*\([^)]*0o?777\b/,
    description: 'Assigning full read/write/execute permissions to all users.',
    remediation: 'Restrict file mode permissions to minimum necessary (e.g. 0o600 or 0o750).',
    skipComments: true
  },

  // 10. Insecure Plain HTTP Endpoints (CWE-319)
  {
    cwe: 'CWE-319',
    type: 'Insecure Plain HTTP Endpoint',
    severity: 'LOW',
    regex: /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|example\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i,
    description: 'Hardcoded external plain HTTP endpoint found in code.',
    remediation: 'Use HTTPS for all external communications to prevent eavesdropping and data tampering.',
    skipComments: true
  }
];

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'workflow_logs',
  '.tsuka',
  '.tsuka_history',
  '.gemini',
  'brain',
  'scratch'
]);

const IGNORED_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'models_profile.json'
]);

export interface AuditCodeArgs {
  targetPath?: string;
  severityThreshold?: SecuritySeverity;
  fileExtensions?: string[];
  maxIssues?: number;
}

export const auditCodeTool: Tool = {
  name: 'audit_code',
  riskLevel: 'SAFE',
  execute: async (args: AuditCodeArgs) => {
    const targetDir = resolveSafePath(args.targetPath || '.');
    const severityThreshold = args.severityThreshold || 'LOW';
    const allowedExtensions = args.fileExtensions?.map(ext => ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
    const maxIssues = args.maxIssues && args.maxIssues > 0 ? args.maxIssues : DEFAULT_MAX_ISSUES;

    const issues: SecurityIssue[] = [];
    let filesScanned = 0;

    const severityRanks: Record<SecuritySeverity, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3
    };

    const minSeverityRank = severityRanks[severityThreshold] || 1;

    function isCommentLine(line: string): boolean {
      const trimmed = line.trim();
      return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*');
    }

    function containsPlaceholder(line: string): boolean {
      const lower = line.toLowerCase();
      return PLACEHOLDER_KEYWORDS.some(k => lower.includes(k));
    }

    function scan(currentPath: string) {
      if (issues.length >= maxIssues) return;

      const stat = fs.statSync(currentPath);

      if (stat.isDirectory()) {
        const basename = path.basename(currentPath);
        if (IGNORED_DIRECTORIES.has(basename)) return;

        const items = fs.readdirSync(currentPath);
        for (const item of items) {
          scan(path.join(currentPath, item));
          if (issues.length >= maxIssues) break;
        }
      } else if (stat.isFile()) {
        const filename = path.basename(currentPath);
        if (IGNORED_FILES.has(filename)) return;
        if (stat.size > MAX_FILE_SIZE_BYTES) return;
        if (isBinaryFile(currentPath)) return;

        if (allowedExtensions && allowedExtensions.length > 0) {
          const ext = path.extname(currentPath).toLowerCase();
          if (!allowedExtensions.includes(ext)) return;
        }

        filesScanned++;
        const content = fs.readFileSync(currentPath, 'utf-8');
        const lines = content.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
          if (issues.length >= maxIssues) break;
          const line = lines[i];
          if (!line || line.trim().length === 0) continue;

          for (const rule of SECURITY_RULES) {
            if (severityRanks[rule.severity] < minSeverityRank) continue;

            if (rule.skipComments && isCommentLine(line)) continue;
            if (rule.cwe === 'CWE-798' && containsPlaceholder(line)) continue;

            // Insecure HTTP rule should only match actual http://
            if (rule.cwe === 'CWE-319' && !line.includes('http://')) continue;

            if (rule.regex.test(line)) {
              const relPath = path.relative(process.cwd(), currentPath).replace(/\\/g, '/');
              issues.push({
                filePath: relPath || filename,
                line: i + 1,
                cwe: rule.cwe,
                type: rule.type,
                severity: rule.severity,
                description: rule.description,
                remediation: rule.remediation,
                snippet: line.trim()
              });
              break; // One issue per line max to avoid duplicate spam
            }
          }
        }
      }
    }

    try {
      scan(targetDir);
    } catch (err: any) {
      throw new Error(`Security audit error: ${err.message}`);
    }

    if (issues.length === 0) {
      return `🛡️ Security audit completed successfully: scanned ${filesScanned} file(s) in '${args.targetPath || '.'}' (Severity threshold: ${severityThreshold}), 0 issues found.`;
    }

    const highIssues = issues.filter(i => i.severity === 'HIGH');
    const mediumIssues = issues.filter(i => i.severity === 'MEDIUM');
    const lowIssues = issues.filter(i => i.severity === 'LOW');

    let report = `🛡️ Security Audit Report ('${args.targetPath || '.'}')\n`;
    report += `Scanned Files: ${filesScanned} | Total Findings: ${issues.length}${issues.length >= maxIssues ? ` (Capped at ${maxIssues})` : ''}\n`;
    report += `Severity Breakdown: [🔴 HIGH: ${highIssues.length}] [🟡 MEDIUM: ${mediumIssues.length}] [🔵 LOW: ${lowIssues.length}]\n\n`;

    issues.forEach((issue, idx) => {
      const icon = issue.severity === 'HIGH' ? '🔴' : issue.severity === 'MEDIUM' ? '🟡' : '🔵';
      report += `[${idx + 1}] ${icon} [${issue.severity}] ${issue.type} (${issue.cwe})\n`;
      report += `    Location:    ${issue.filePath}:${issue.line}\n`;
      report += `    Finding:     ${issue.description}\n`;
      report += `    Remediation: ${issue.remediation}\n`;
      report += `    Snippet:     ${issue.snippet}\n\n`;
    });

    report += `\n📋 Summary & Mitigation Guidance:\n`;
    if (highIssues.length > 0) {
      report += `• 🔴 Fix ${highIssues.length} HIGH severity vulnerability(ies) immediately (e.g. hardcoded credentials, RCE, command injection).\n`;
    }
    if (mediumIssues.length > 0) {
      report += `• 🟡 Address ${mediumIssues.length} MEDIUM severity issue(s) before production deployment (e.g. weak hashes, XSS vectors, path traversal).\n`;
    }
    if (lowIssues.length > 0) {
      report += `• 🔵 Review ${lowIssues.length} LOW severity finding(s) as part of routine code hardening.\n`;
    }

    return capForContext(report, undefined, {
      label: `audit_code report`,
      recoveryHint: `Narrow audit target path to a specific directory or filter by fileExtensions.`
    });
  }
};
