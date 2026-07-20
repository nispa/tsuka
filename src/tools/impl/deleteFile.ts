import * as fs from 'fs';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

export const deleteFileTool: Tool = {
  name: 'delete_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string }) => {
    const fullPath = resolveSafePath(args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Il file '${args.path}' non esiste.`);
    }
    if (fs.statSync(fullPath).isDirectory()) {
      throw new Error(`Il percorso '${args.path}' è una directory, usa list_dir.`);
    }

    fs.unlinkSync(fullPath);
    return `File '${args.path}' eliminato con successo.`;
  }
};
