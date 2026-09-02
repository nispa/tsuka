import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath } from './utils';
import { createDefaultResumableWriteStore, type IResumableWriteStore } from './resumableWrite';

interface WriteFileArgs {
  path: string;
  content: string;
  append?: boolean;
  offset?: number;
  complete?: boolean;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function usesResumableMode(args: WriteFileArgs): boolean {
  return hasOwn(args, 'offset') || hasOwn(args, 'complete');
}

/** Creates a write_file tool with a replaceable resumable transaction backend. */
export function createWriteFileTool(resumableStore: IResumableWriteStore = createDefaultResumableWriteStore()): Tool<WriteFileArgs> {
  return {
    name: 'write_file',
    riskLevel: 'RESTRICTED',
    execute: async (args: WriteFileArgs) => {
      if (!args || typeof args !== 'object') {
        throw new Error('Invalid arguments: expected an object.');
      }
      if (typeof args.path !== 'string' || typeof args.content !== 'string') {
        throw new Error("Invalid arguments: 'path' and 'content' must be strings.");
      }
      if (hasOwn(args, 'append') && typeof args.append !== 'boolean') {
        throw new Error("Invalid argument 'append': expected a boolean when provided.");
      }
      const fullPath = resolveSafePath(args.path);
      const parentDir = path.dirname(fullPath);

      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

      if (usesResumableMode(args)) {
        if (hasOwn(args, 'append')) {
          throw new Error("'append' cannot be combined with resumable 'offset'/'complete' mode.");
        }
        if (!hasOwn(args, 'offset') || !Number.isSafeInteger(args.offset) || args.offset! < 0) {
          throw new Error("Resumable writes require a non-negative integer 'offset' measured in UTF-8 bytes.");
        }
        if (hasOwn(args, 'complete') && typeof args.complete !== 'boolean') {
          throw new Error("Invalid argument 'complete': expected a boolean when provided.");
        }

        const nextOffset = resumableStore.append(fullPath, args.offset!, args.content);
        if (args.complete === true) {
          const totalBytes = resumableStore.commit(fullPath);
          return `File '${args.path}' committed successfully (${totalBytes} bytes).`;
        }
        return `Chunk staged for '${args.path}' (${Buffer.byteLength(args.content, 'utf8')} bytes). Continue with offset ${nextOffset}; send complete:true only on the final chunk.`;
      }

      if (args.append === true) {
        fs.appendFileSync(fullPath, args.content, 'utf-8');
        const totalSize = fs.statSync(fullPath).size;
        return `Content appended to '${args.path}' (+${Buffer.byteLength(args.content)} bytes, ${totalSize} bytes total).`;
      }

      fs.writeFileSync(fullPath, args.content, 'utf-8');
      return `File '${args.path}' written successfully (${Buffer.byteLength(args.content)} bytes).`;
    }
  };
}

export const writeFileTool = createWriteFileTool();
