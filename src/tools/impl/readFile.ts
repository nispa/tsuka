import * as fs from 'fs';
import { Tool } from '../registry';
import { resolveSafePath, isBinaryFile } from './utils';
import { capForContext } from '../../core/contextBudget';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const readFileTool: Tool = {
  name: 'read_file',
  riskLevel: 'SAFE',
  execute: async (args: { path: string; startLine?: number; endLine?: number; offset?: number; limit?: number }) => {
    const fullPath = resolveSafePath(args.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File '${args.path}' does not exist.`);
    }
    if (fs.statSync(fullPath).isDirectory()) {
      throw new Error(`Path '${args.path}' is a directory, not a file.`);
    }
    if (fs.statSync(fullPath).size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File '${args.path}' exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB. ` +
        `Use startLine/endLine (or offset/limit) to page through content.`
      );
    }
    if (isBinaryFile(fullPath)) {
      throw new Error(`File '${args.path}' appears to be binary.`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split(/\r?\n/);

    let start: number;
    let end: number;
    if (args.offset !== undefined || args.limit !== undefined) {
      start = args.offset !== undefined ? Math.max(1, Math.floor(args.offset)) : 1;
      const limit = args.limit !== undefined ? Math.max(1, Math.floor(args.limit)) : (lines.length - start + 1);
      end = Math.min(lines.length, start + limit - 1);
    } else {
      start = args.startLine !== undefined ? Math.max(1, args.startLine) : 1;
      end = args.endLine !== undefined ? Math.min(lines.length, args.endLine) : lines.length;
    }

    if (start > lines.length) {
      return `[File: ${args.path} - Total lines: ${lines.length}]\n(File contains fewer lines than requested start)`;
    }

    const selectedLines = lines.slice(start - 1, end);
    const body = `[Content of ${args.path} (Lines ${start}-${end} of ${lines.length})]\n${selectedLines.join('\n')}`;

    return capForContext(body, undefined, {
      label: `file '${args.path}'`,
      recoveryHint: `Call read_file again on '${args.path}' with offset=${end + 1} (or startLine=${end + 1})` +
        ` to continue reading, or use grep_search to locate specific patterns.`
    });
  }
};
