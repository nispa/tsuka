import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { Tool, ToolExecutionContext } from '../registry';

/**
 * create_tool: self-authoring dei tool.
 * L'agente genera il corpo di una funzione execute; l'harness lo incapsula in un
 * modulo tool completo, lo valida in sandbox (vm), lo salva in impl/ + schema JSON
 * e lo registra a caldo nel registry corrente (utilizzabile subito).
 *
 * Misure di sicurezza:
 * - creazione RESTRICTED (richiede approvazione utente)
 * - blocklist di pattern pericolosi nel codice generato
 * - validazione di forma in sandbox PRIMA di scrivere su disco
 * - i tool generati non possono essere DANGEROUS né sovrascrivere tool core (.ts)
 * - backup automatico in tools_backup/ prima di una sovrascrittura
 */

// Pattern vietati nel codice generato (niente processi figli, eval, env, require arbitrari)
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /child_process/, reason: 'child_process non consentito (usa il tool execute_command)' },
  { pattern: /\beval\s*\(/, reason: 'eval() non consentito' },
  { pattern: /new\s+Function/, reason: 'Function() non consentito' },
  { pattern: /process\.exit/, reason: 'process.exit non consentito' },
  { pattern: /process\.env/, reason: 'accesso a process.env non consentito (possibili segreti)' },
  { pattern: /\brequire\s*\(/, reason: 'require() non consentito: fs e path sono già disponibili nel modulo' }
];

const MAX_BODY_LENGTH = 4000;

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Verifica se nella cartella impl/ esiste un file .ts il cui basename corrisponde
 * al nome tool richiesto (normalizzando camelCase e snake_case: readFile.ts ↔ read_file).
 */
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
    // ── 1. Validazione e sanitizzazione del nome ──
    const cleanName = (args.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanName) {
      throw new Error("Il nome del tool fornito non è valido (usa solo lettere minuscole, numeri e underscore).");
    }

    const implDir = __dirname;
    const targetPath = path.join(implDir, `${cleanName}.js`);

    // Conflitto con tool core: consentita la sovrascrittura SOLO se esiste già un
    // file .js generato in precedenza (versioning); mai sopra un tool core (.ts)
    // né sopra un tool già registrato che non sia un generato.
    const generatedExists = fs.existsSync(targetPath);
    if (!generatedExists) {
      const registeredCore = context?.registry?.getTool(cleanName) !== undefined;
      if (registeredCore || hasCoreFileConflict(implDir, cleanName)) {
        throw new Error(`Esiste già un tool core chiamato '${cleanName}'. Scegli un altro nome.`);
      }
    }

    // ── 2. Validazione argomenti base ──
    if (!args.description || args.description.trim().length === 0) {
      throw new Error("La descrizione del tool è obbligatoria.");
    }
    const body = (args.executeBody || '').trim();
    if (!body) {
      throw new Error("Il corpo della funzione execute (executeBody) non può essere vuoto.");
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new Error(`Il corpo della funzione è troppo lungo (max ${MAX_BODY_LENGTH} caratteri).`);
    }

    // I tool generati non possono essere DANGEROUS
    let riskLevel: 'SAFE' | 'RESTRICTED' = 'SAFE';
    if (args.riskLevel && args.riskLevel.toUpperCase() === 'RESTRICTED') {
      riskLevel = 'RESTRICTED';
    }

    // ── 3. Blocklist di sicurezza sul codice generato ──
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(body)) {
        throw new Error(`Codice rifiutato dalla policy di sicurezza: ${reason}.`);
      }
    }

    // ── 4. Costruzione del modulo (plain JS CommonJS: funziona in dev tsx e in dist compilato) ──
    const exportName = `${toCamelCase(cleanName)}Tool`;
    const indentedBody = body.split('\n').map((l) => '    ' + l).join('\n');
    const moduleCode =
      `// Tool generato automaticamente da create_tool il ${new Date().toISOString()}\n` +
      `// Rigenera o elimina questo file per rimuoverlo. Backup in tools_backup/.\n` +
      `const fs = require('fs');\n` +
      `const path = require('path');\n\n` +
      `exports.${exportName} = {\n` +
      `  name: '${cleanName}',\n` +
      `  riskLevel: '${riskLevel}',\n` +
      `  execute: async (args) => {\n` +
      `${indentedBody}\n` +
      `  }\n` +
      `};\n`;

    // ── 5. Validazione di forma in sandbox (senza registrare il modulo) ──
    const sandbox: { exports: Record<string, any> } = { exports: {} };
    const sandboxRequire = (mod: string) => {
      if (mod === 'fs') return require('fs');
      if (mod === 'path') return require('path');
      throw new Error(`Modulo non consentito: ${mod}`);
    };
    try {
      vm.runInNewContext(moduleCode, { exports: sandbox.exports, require: sandboxRequire, console }, { timeout: 1000 });
    } catch (err: any) {
      throw new Error(`Il codice generato non è valido: ${err.message}`);
    }

    const exported = Object.values(sandbox.exports).find(
      (v: any) => v && typeof v.name === 'string' && typeof v.execute === 'function' && typeof v.riskLevel === 'string'
    ) as any;
    if (!exported || exported.name !== cleanName) {
      throw new Error("Validazione fallita: il modulo non esporta un tool conforme (name/riskLevel/execute).");
    }

    // ── 6. Backup della versione precedente (versioning/rollback) ──
    let backupNote = '';
    if (fs.existsSync(targetPath)) {
      const backupDir = path.resolve(process.cwd(), 'tools_backup');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `${cleanName}.${stamp}.js.bak`);
      fs.copyFileSync(targetPath, backupPath);
      backupNote = `\nVersione precedente salvata in tools_backup/${path.basename(backupPath)}.`;
    }

    // ── 7. Scrittura del modulo e dello schema ──
    fs.writeFileSync(targetPath, moduleCode, 'utf-8');

    const schemaDir = path.resolve(process.cwd(), 'tools_schemas');
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

    // ── 8. Registrazione a caldo nel registry corrente (utilizzabile subito) ──
    let hotNote = '';
    if (context?.registry) {
      try {
        const existing = context.registry.getTool(cleanName);
        if (existing && generatedExists) {
          // Sovrascrittura di un tool generato: sostituisci la registrazione con la nuova versione
          context.registry.unregister(cleanName);
        }
        if (!context.registry.getTool(cleanName)) {
          context.registry.register(exported as Tool, { alwaysAllow: true });
          hotNote = '\nTool registrato a caldo: utilizzabile SUBITO in questa sessione.';
        } else {
          hotNote = '\nNome occupato da un tool core: la nuova versione NON è stata registrata (conflitto).';
        }
      } catch {
        hotNote = '\nNota: registrazione a caldo non riuscita, sarà attivo dal prossimo avvio.';
      }
    }

    return (
      `Tool '${cleanName}' creato e validato con successo.\n` +
      `- Modulo: src/tools/impl/${cleanName}.js\n` +
      `- Schema: tools_schemas/${cleanName}.json (tier: small, rischio: ${riskLevel})` +
      hotNote + backupNote +
      `\nAl prossimo avvio verrà caricato dall'auto-discovery e sarà soggetto agli allowedTools del ruolo attivo ` +
      `(aggiungi '${cleanName}' in roles/*.json per renderlo permanente).`
    );
  }
};
