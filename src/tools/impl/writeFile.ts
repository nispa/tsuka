import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';
import { TOOLS_DEFAULTS } from '../../core/constants';

export const writeFileTool: Tool = {
  name: 'write_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string; content: string; append?: boolean }) => {
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments: expected an object.');
    }
    if (typeof args.path !== 'string' || typeof args.content !== 'string') {
      throw new Error("Invalid arguments: 'path' and 'content' must be strings.");
    }
    if (Object.prototype.hasOwnProperty.call(args, 'append') && typeof args.append !== 'boolean') {
      throw new Error("Invalid argument 'append': expected a boolean when provided.");
    }
    if (args.content.length > TOOLS_DEFAULTS.writeFileMaxContentChars) {
      throw new Error(
        `Content exceeds limit for a single write call: ${args.content.length} characters (limit ${TOOLS_DEFAULTS.writeFileMaxContentChars}). ` +
        `Do NOT truncate content. Split into multiple write_file calls on '${args.path}': initial call with append: false, ` +
        `followed by calls with 'append': true until the complete file is written.`
      );
    }

    const fullPath = resolveSafePath(args.path);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const append = args.append === true;
    if (append) {
      fs.appendFileSync(fullPath, args.content, 'utf-8');
      const totalSize = fs.statSync(fullPath).size;
      return `Content appended to '${args.path}' (+${Buffer.byteLength(args.content)} bytes, ${totalSize} bytes total).`;
    }

    fs.writeFileSync(fullPath, args.content, 'utf-8');
    return `File '${args.path}' written successfully (${Buffer.byteLength(args.content)} bytes).`;
  }
};
