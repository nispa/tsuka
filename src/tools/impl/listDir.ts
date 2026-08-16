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
      throw new Error(`Directory '${args.path || '.'}' does not exist.`);
    }
    if (!fs.statSync(dirPath).isDirectory()) {
      throw new Error(`Path '${args.path || '.'}' is not a directory.`);
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
        result.push(`[FILE] ${relativePath} (${stat.size} bytes)`);
      }
    });

    return result.length > 0 
      ? `Items in '${args.path || '.'}':\n${result.join('\n')}`
      : `Directory '${args.path || '.'}' is empty.`;
  }
};
