import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';

// Hard limit for single write_file call to prevent JSON truncation issues with local LLMs
const MAX_CONTENT_LENGTH = 16000;

export const writeFileTool: Tool = {
  name: 'write_file',
  riskLevel: 'RESTRICTED',
  execute: async (args: { path: string; content: string; append?: boolean | string }) => {
    if (args.content.length > MAX_CONTENT_LENGTH) {
      throw new Error(
        `Content exceeds limit for a single write call: ${args.content.length} characters (limit ${MAX_CONTENT_LENGTH}). ` +
        `Do NOT truncate content. Split into multiple write_file calls on '${args.path}': initial call with append: false, ` +
        `followed by calls with 'append': true until the complete file is written.`
      );
    }

    const fullPath = resolveSafePath(args.path);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const append = args.append === true || (typeof args.append === 'string' && args.append.trim().toLowerCase() === 'true');
    if (append) {
      fs.appendFileSync(fullPath, args.content, 'utf-8');
      const totalSize = fs.statSync(fullPath).size;
      return `Content appended to '${args.path}' (+${Buffer.byteLength(args.content)} bytes, ${totalSize} bytes total).`;
    }

    fs.writeFileSync(fullPath, args.content, 'utf-8');
    return `File '${args.path}' written successfully (${Buffer.byteLength(args.content)} bytes).`;
  }
};
