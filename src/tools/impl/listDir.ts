import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

export const listDirTool: Tool = {
  name: 'list_dir',
  riskLevel: 'SAFE',
  execute: async (args: { path?: string }) => {
    const dirPath = resolveSafePath(args.path || '.');
    if (!fs.existsSync(dirPath)) {
      throw new Error(`La directory '${args.path || '.'}' non esiste.`);
    }
    if (!fs.statSync(dirPath).isDirectory()) {
      throw new Error(`Il percorso '${args.path || '.'}' non è una directory.`);
    }

    const items = fs.readdirSync(dirPath);
    const result: string[] = [];

    items.forEach((item) => {
      if (item === '.git' || item === 'node_modules' || item === 'dist') return;

      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      const relativePath = path.relative(process.cwd(), itemPath);

      if (stat.isDirectory()) {
        result.push(`[DIR]  ${relativePath}/`);
      } else {
        result.push(`[FILE] ${relativePath} (${stat.size} byte)`);
      }
    });

    return result.length > 0 
      ? `Elementi in '${args.path || '.'}':\n${result.join('\n')}`
      : `La directory '${args.path || '.'}' è vuota.`;
  }
};
