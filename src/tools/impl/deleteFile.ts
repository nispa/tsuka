import * as fs from 'fs';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

export const deleteFileTool: Tool = {
  name: 'delete_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string }) => {
    const fullPath = resolveSafePath(args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File '${args.path}' does not exist.`);
    }
    if (fs.statSync(fullPath).isDirectory()) {
      throw new Error(`Path '${args.path}' is a directory; use list_dir instead.`);
    }

    fs.unlinkSync(fullPath);
    return `File '${args.path}' deleted successfully.`;
  }
};
