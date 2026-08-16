import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { homePath } from '../../core/apphome';
import { Tool, ToolExecutionContext } from '../registry';

/**
 * create_tool: self-authoring of agent tools.
 * Generates and validates an execute function inside a VM sandbox,
 * persists the implementation and schema, and hot-registers into the active registry.
 */

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /child_process/, reason: 'child_process is not permitted (use execute_command tool instead)' },
  { pattern: /\beval\s*\(/, reason: 'eval() is not permitted' },
  { pattern: /new\s+Function/, reason: 'Function() constructor is not permitted' },
  { pattern: /process\.exit/, reason: 'process.exit is not permitted' },
  { pattern: /process\.env/, reason: 'direct process.env access is not permitted' },
  { pattern: /\brequire\s*\(/, reason: 'require() is not permitted: fs and path are already injected' }
];

const MAX_BODY_LENGTH = 4000;

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function hasCoreFileConflict(implDir: string, cleanName: string): boolean {
  const normalizedTarget = cleanName.replace(/_/g, '');
  try {
    return fs.readdirSync(implDir).some((f) => {
      if (!f.endsWith('.ts')) return false;
      const base = f.slice(0, -3).toLowerCase().replace(/[^a-z0-9]/g, '');
      return base === normalizedTarget;
    });
  } catch {
    return false;
  }
}

export const createToolTool: Tool = {
  name: 'create_tool',
  riskLevel: 'RESTRICTED',
  execute: async (
    args: {
      name: string;
      description: string;
      riskLevel?: string;
      parameters?: any;
      executeBody: string;
    },
    context?: ToolExecutionContext
  ) => {
    // 1. Validate and sanitize name
    const cleanName = (args.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) {
      throw new Error("Invalid tool name (use lowercase letters, numbers, and underscores only).");
    }

    const implDir = __dirname;
    const targetPath = path.join(implDir, `${cleanName}.js`);

    const generatedExists = fs.existsSync(targetPath);
    if (!generatedExists) {
      const registeredCore = context?.registry?.getTool(cleanName) !== undefined;
      if (registeredCore || hasCoreFileConflict(implDir, cleanName)) {
        throw new Error(`A core tool named '${cleanName}' already exists. Please choose a different name.`);
      }
    }

    // 2. Validate arguments
    if (!args.description || args.description.trim().length === 0) {
      throw new Error("Tool description is required.");
    }
    const body = (args.executeBody || '').trim();
    if (!body) {
      throw new Error("Function executeBody cannot be empty.");
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new Error(`executeBody exceeds limit (max ${MAX_BODY_LENGTH} characters).`);
    }

    let riskLevel: 'SAFE' | 'RESTRICTED' = 'SAFE';
    if (args.riskLevel && args.riskLevel.toUpperCase() === 'RESTRICTED') {
      riskLevel = 'RESTRICTED';
    }

    // 3. Security blocklist check
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(body)) {
        throw new Error(`Code rejected by security policy: ${reason}.`);
      }
    }

    // 4. Construct tool module
    const exportName = `${toCamelCase(cleanName)}Tool`;
    const indentedBody = body.split('\n').map((l) => '    ' + l).join('\n');
    const moduleCode =
      `// Auto-generated tool by create_tool on ${new Date().toISOString()}\n` +
      `const fs = require('fs');\n` +
      `const path = require('path');\n\n` +
      `exports.${exportName} = {\n` +
      `  name: '${cleanName}',\n` +
      `  riskLevel: '${riskLevel}',\n` +
      `  execute: async (args) => {\n` +
      `${indentedBody}\n` +
      `  }\n` +
      `};\n`;

    // 5. Sandbox shape validation
    const sandbox: { exports: Record<string, any> } = { exports: {} };
    const sandboxRequire = (mod: string) => {
      if (mod === 'fs') return require('fs');
      if (mod === 'path') return require('path');
      throw new Error(`Module not allowed: ${mod}`);
    };
    try {
      vm.runInNewContext(moduleCode, { exports: sandbox.exports, require: sandboxRequire, console }, { timeout: 1000 });
    } catch (err: any) {
      throw new Error(`Generated code is invalid: ${err.message}`);
    }

    const exported = Object.values(sandbox.exports).find(
      (v: any) => v && typeof v.name === 'string' && typeof v.execute === 'function' && typeof v.riskLevel === 'string'
    ) as any;
    if (!exported || exported.name !== cleanName) {
      throw new Error("Validation failed: module does not export a valid Tool instance.");
    }

    // 6. Versioning backup
    let backupNote = '';
    if (fs.existsSync(targetPath)) {
      const backupDir = homePath('tools_backup');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `${cleanName}.${stamp}.js.bak`);
      fs.copyFileSync(targetPath, backupPath);
      backupNote = `\nPrevious version backed up in tools_backup/${path.basename(backupPath)}.`;
    }

    // 7. Write tool file and schema
    fs.writeFileSync(targetPath, moduleCode, 'utf-8');

    const schemaDir = homePath('tools_schemas');
    if (!fs.existsSync(schemaDir)) {
      fs.mkdirSync(schemaDir, { recursive: true });
    }
    const schemaContent = {
      name: cleanName,
      description: args.description.trim(),
      requiredTier: 'small',
      parameters: args.parameters && typeof args.parameters === 'object'
        ? args.parameters
        : { type: 'object', properties: {} }
    };
    fs.writeFileSync(path.join(schemaDir, `${cleanName}.json`), JSON.stringify(schemaContent, null, 2), 'utf-8');

    // 8. Hot-register into active registry
    let hotNote = '';
    if (context?.registry) {
      try {
        const existing = context.registry.getTool(cleanName);
        if (existing && generatedExists) {
          context.registry.unregister(cleanName);
        }
        if (!context.registry.getTool(cleanName)) {
          context.registry.register(exported as Tool, { alwaysAllow: true });
          hotNote = '\nTool hot-registered: available immediately in this session.';
        } else {
          hotNote = '\nName conflict with core tool: not hot-registered.';
        }
      } catch {
        hotNote = '\nNote: hot registration failed; will be loaded on next startup.';
      }
    }

    return (
      `Tool '${cleanName}' created and validated successfully.\n` +
      `- Module: src/tools/impl/${cleanName}.js\n` +
      `- Schema: tools_schemas/${cleanName}.json (tier: small, risk: ${riskLevel})` +
      hotNote + backupNote +
      `\nAdd '${cleanName}' to roles/*.json allowedTools to make it permanently accessible.`
    );
  }
};
