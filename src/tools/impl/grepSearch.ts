import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../registry';
import { resolveSafePath, isBinaryFile, walkWorkspaceFiles } from './utils';
import { capForContext } from '../../core/contextBudget';
import { TOOLS_DEFAULTS } from '../../core/constants';

export const grepSearchTool: Tool = {
  name: 'grep_search',
  riskLevel: 'SAFE',
  execute: async (args: { query: string; path?: string }) => {
    const startDir = resolveSafePath(args.path || '.');
    const matches: string[] = [];
    let walkResult: ReturnType<typeof walkWorkspaceFiles>;

    try {
      walkResult = walkWorkspaceFiles(startDir, {
        ignoredDirectories: new Set(['.git', 'node_modules', 'dist'])
      });
      for (const file of walkResult.files) {
        if (matches.length >= TOOLS_DEFAULTS.grepMaxMatches) break;
        if (file.size > TOOLS_DEFAULTS.grepMaxFileBytes || isBinaryFile(file.fullPath)) continue;
        const content = fs.readFileSync(file.fullPath, 'utf-8');
        if (!content.includes(args.query)) continue;
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.includes(args.query) && matches.length < TOOLS_DEFAULTS.grepMaxMatches) {
            const relPath = path.relative(process.cwd(), file.fullPath);
            matches.push(`${relPath}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    } catch (err: any) {
      throw new Error(`Error during grep search: ${err.message}`);
    }

    if (matches.length === 0) {
      return `No matches found for "${args.query}" in '${args.path || '.'}'.`;
    }

    const scanNote = walkResult.blockedLinks > 0 || walkResult.truncatedReason
      ? `\nScan guard: blocked links=${walkResult.blockedLinks}, truncated=${walkResult.truncatedReason ?? 'no'}.`
      : '';
    const body = `Found ${matches.length} result(s) for "${args.query}":\n${matches.join('\n')}${scanNote}`;

    return capForContext(body, undefined, {
      label: `grep_search results for "${args.query}"`,
      recoveryHint: `Narrow search with a more specific query term or specify a "path" subdirectory.`
    });
  }
};
