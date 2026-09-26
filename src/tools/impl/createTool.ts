import * as fs from 'fs';
import * as path from 'path';
import { homePath, localWorkspacePath } from '../../core/apphome';
import { Tool, ToolExecutionContext } from '../registry';
import { TOOLS_DEFAULTS } from '../../core/constants';
import { isolatedCustomTool, runCustomToolIsolated } from '../customToolRunner';

/**
 * create_tool: self-authoring of agent tools.
 * Writes an execute function into a module, validates its shape in a confined child
 * process, persists module and schema, and hot-registers an isolated proxy. The code
 * never runs inside TSUKA (T23.8): see customToolRunner.ts for what the child may do.
 */

// Defense in depth only: the confinement is the child process, not these patterns.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /child_process/, reason: 'child_process is not permitted (use execute_command tool instead)' },
  { pattern: /\beval\s*\(/, reason: 'eval() is not permitted' },
  { pattern: /new\s+Function/, reason: 'Function() constructor is not permitted' },
  { pattern: /process\.exit/, reason: 'process.exit is not permitted' },
  { pattern: /process\.env/, reason: 'direct process.env access is not permitted' },
  { pattern: /process\.(kill|abort|binding|dlopen|_linkedBinding)/, reason: 'that process API is not permitted' },
  { pattern: /\brequire\s*\(/, reason: 'require() is not permitted: fs and path are already injected' },
  { pattern: /\bimport\s*\(/, reason: 'dynamic import() is not permitted (same reason as require())' },
  // T14.22: `new Function` is blocked above, but the Function constructor is reachable
  // indirectly through any object's prototype chain (`x.constructor.constructor('return process')()`)
  // — a well-known vm-sandbox escape that doesn't contain the literal text "new Function" at all.
  { pattern: /constructor\s*\.\s*constructor/, reason: 'accessing the Function constructor via a prototype chain is not permitted' },
];

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function hasCoreFileConflict(coreImplDir: string, name: string): boolean {
  try {
    const files = fs.readdirSync(coreImplDir);
    const targetFile = `${name.toLowerCase()}.ts`;
    const targetJs = `${name.toLowerCase()}.js`;
    return files.some((f) => f.toLowerCase() === targetFile || f.toLowerCase() === targetJs);
  } catch {
    return false;
  }
}

export const createToolTool: Tool = {
  name: 'create_tool',
  riskLevel: 'DANGEROUS',
  execute: async (
    args: {
      name: string;
      description: string;
      /** Ignored since T14.22 — kept only so an older caller still passing it isn't a type error. */
      riskLevel?: string;
      parameters?: any;
      executeBody: string;
      global?: boolean;
    },
    context?: ToolExecutionContext
  ) => {
    // 1. Validate and sanitize name
    const cleanName = (args.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) {
      throw new Error("Invalid tool name (use lowercase letters, numbers, and underscores only).");
    }

    const isGlobal = args.global === true;
    const localDir = !isGlobal ? localWorkspacePath('custom_tools') : null;
    const customToolsDir = localDir ?? homePath('custom_tools');
    if (!fs.existsSync(customToolsDir)) {
      fs.mkdirSync(customToolsDir, { recursive: true });
    }
    const targetPath = path.join(customToolsDir, `${cleanName}.js`);
    const coreImplDir = __dirname;

    const generatedExists = fs.existsSync(targetPath);
    if (!generatedExists) {
      const registeredCore = context?.registry?.getTool(cleanName) !== undefined;
      if (registeredCore || hasCoreFileConflict(coreImplDir, cleanName)) {
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
    if (body.length > TOOLS_DEFAULTS.createToolMaxBodyChars) {
      throw new Error(`executeBody exceeds limit (max ${TOOLS_DEFAULTS.createToolMaxBodyChars} characters).`);
    }

    // T14.22: a self-authored tool's own claim about its risk was, until now, the only thing
    // deciding whether the user ever saw a confirmation prompt before it ran — checkPermission()
    // returns true unconditionally for 'SAFE' (permissions.ts), no other check involved. A tool
    // is welcome to describe itself as harmless; nothing here verifies that's true. Generated
    // executable code therefore always requires the maximum permission tier.
    const riskLevel: 'DANGEROUS' = 'DANGEROUS';

    // 3. Security blocklist check
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(body)) {
        throw new Error(`Code rejected by security policy: ${reason}.`);
      }
    }

    // 4. Construct tool module. `fs` and `path` are injected by the isolated runner; the
    // module requires nothing, so it has exactly what the child process allows.
    const exportName = `${toCamelCase(cleanName)}Tool`;
    const indentedBody = body.split('\n').map((l) => '    ' + l).join('\n');
    const moduleCode =
      `// Auto-generated tool by create_tool on ${new Date().toISOString()}\n` +
      `// Runs out of process with 'fs' (workspace only) and 'path' injected; no network, no processes.\n` +
      `exports.${exportName} = {\n` +
      `  name: '${cleanName}',\n` +
      `  riskLevel: '${riskLevel}',\n` +
      `  execute: async (args) => {\n` +
      `${indentedBody}\n` +
      `  }\n` +
      `};\n`;

    // 5. Shape validation in the same confined child that will run it: the module's
    // top-level code executes there, never in this process.
    try {
      await runCustomToolIsolated({
        name: cleanName,
        source: moduleCode,
        mode: 'validate',
        signal: context?.signal,
        timeoutMs: TOOLS_DEFAULTS.createToolValidationTimeoutMs,
      });
    } catch (err: any) {
      throw new Error(`Generated code is invalid: ${err.message}`);
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

    const localSchemaDir = !isGlobal ? localWorkspacePath('custom_tools_schemas') : null;
    const schemaDir = localSchemaDir ?? homePath('custom_tools_schemas');
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
          context.registry.register(isolatedCustomTool(cleanName, targetPath));
          hotNote = '\nTool hot-registered. Add it to the active role allowedTools before an agent can call it.';
        } else {
          hotNote = '\nName conflict with core tool: not hot-registered.';
        }
      } catch {
        hotNote = '\nNote: hot registration failed; will be loaded on next startup.';
      }
    }

    return (
      `Tool '${cleanName}' created and validated successfully.\n` +
      `- Module: custom_tools/${cleanName}.js\n` +
      `- Schema: custom_tools_schemas/${cleanName}.json (tier: small, risk: ${riskLevel})` +
      hotNote + backupNote +
      `\nAdd '${cleanName}' to roles/*.json allowedTools to make it permanently accessible.`
    );
  }
};
