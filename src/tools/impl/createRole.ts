import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../../core/apphome';
import { Tool } from '../registry';

export const createRoleTool: Tool = {
  name: 'create_role',
  riskLevel: 'RESTRICTED',
  execute: async (args: {
    name: string;
    displayName: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
  }) => {
    const rolesDir = homePath('roles');
    
    // Assicura che la cartella roles esista
    if (!fs.existsSync(rolesDir)) {
      fs.mkdirSync(rolesDir, { recursive: true });
    }

    // Pulisce il nome del file per sicurezza
    const cleanName = args.name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!cleanName) {
      throw new Error("Il nome identificativo del ruolo fornito non è valido.");
    }

    const rolePath = path.join(rolesDir, `${cleanName}.json`);
    
    const roleContent = {
      name: cleanName,
      displayName: args.displayName,
      description: args.description,
      systemPrompt: args.systemPrompt,
      allowedTools: args.allowedTools
    };

    // Scrive il file JSON
    fs.writeFileSync(rolePath, JSON.stringify(roleContent, null, 2), 'utf-8');

    return `Ruolo '${args.displayName}' (${cleanName}) salvato con successo in 'roles/${cleanName}.json'.\nPuoi attivare questa nuova personalità usando il comando '/agent' nel REPL.`;
  }
};
