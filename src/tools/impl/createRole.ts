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
    
    if (!fs.existsSync(rolesDir)) {
      fs.mkdirSync(rolesDir, { recursive: true });
    }

    const cleanName = args.name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!cleanName) {
      throw new Error("Invalid role name identifier provided.");
    }

    const rolePath = path.join(rolesDir, `${cleanName}.json`);
    
    const roleContent = {
      name: cleanName,
      displayName: args.displayName,
      description: args.description,
      systemPrompt: args.systemPrompt,
      allowedTools: args.allowedTools
    };

    fs.writeFileSync(rolePath, JSON.stringify(roleContent, null, 2), 'utf-8');

    return `Role '${args.displayName}' (${cleanName}) saved successfully in 'roles/${cleanName}.json'.\nActivate with '/agent' in the REPL.`;
  }
};
