import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

export const writeFileTool: Tool = {
  name: 'write_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string; content: string }) => {
    const fullPath = resolveSafePath(args.path);
    const parentDir = path.dirname(fullPath);
    
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(fullPath, args.content, 'utf-8');
    return `File '${args.path}' scritto con successo (${Buffer.byteLength(args.content)} byte).`;
  }
};
