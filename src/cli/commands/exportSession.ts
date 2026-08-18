import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import { logSink } from '../../core/logSink';

/**
 * `/export` command: exports current session conversation and tool history to a formatted Markdown file.
 */
export async function handleExport(ctx: CommandCtx, arg: string): Promise<void> {
  const agent = ctx.agent.current;
  const messages = agent.getMessages();

  // Exclude single system prompt initialization
  const userOrAssistant = messages.filter((m) => m.role !== 'system');
  if (userOrAssistant.length === 0) {
    CLITheme.warning('No conversation messages in session to export.');
    return;
  }

  let targetFile = arg ? arg.trim() : '';
  if (!targetFile) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    targetFile = `exports/session-${stamp}.md`;
  } else if (!targetFile.endsWith('.md')) {
    targetFile += '.md';
  }

  const fullPath = path.isAbsolute(targetFile) ? targetFile : path.resolve(process.cwd(), targetFile);
  const relativePath = path.relative(process.cwd(), fullPath) || targetFile;

  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    const charName = ctx.configManager.getActiveCharacter();
    const char = ctx.loadCharacter(charName);
    const roleName = char ? char.role : ctx.configManager.getActiveRole();
    const role = ctx.loadRole(roleName);
    const model = ctx.provider.getCurrentModel();

    const lines: string[] = [];
    lines.push(`# 📜 TSUKA Chat Session Export`);
    lines.push('');
    lines.push(`> **Export Date:** ${new Date().toLocaleString()}  `);
    lines.push(`> **Active Agent:** ${char ? `${char.displayName} (\`@${char.aiName}\`)` : role.displayName} (Role: \`${roleName}\`)  `);
    lines.push(`> **Provider / Model:** \`${ctx.configManager.getActiveProviderName()}\` / \`${model}\`  `);
    lines.push(`> **Total Messages:** ${messages.length} (${userOrAssistant.length} dialogue turns)  `);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of messages) {
      if (msg.role === 'user') {
        lines.push(`### 👤 User`);
        lines.push('');
        lines.push(msg.content || '');
        lines.push('');
      } else if (msg.role === 'assistant') {
        const author = char ? `@${char.aiName}` : 'Assistant';
        lines.push(`### 🤖 ${author}`);
        lines.push('');

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            lines.push('<details>');
            lines.push(`<summary>⚡ <b>Tool Execution: \`${tc.function.name}\`</b></summary>`);
            lines.push('');
            lines.push('**Arguments:**');
            lines.push('```json');
            lines.push(tc.function.arguments || '{}');
            lines.push('```');
            lines.push('</details>');
            lines.push('');
          }
        }

        if (msg.content) {
          lines.push(msg.content);
          lines.push('');
        }
      } else if (msg.role === 'tool') {
        lines.push('<details>');
        lines.push(`> 🛠️ **Tool Result [ID: ${msg.tool_call_id || 'call'}]:**`);
        lines.push('```');
        lines.push(msg.content || '(no output)');
        lines.push('```');
        lines.push('</details>');
        lines.push('');
      }
    }

    const mdContent = lines.join('\n');
    fs.writeFileSync(fullPath, mdContent, 'utf-8');

    CLITheme.success(`Session exported successfully to ${chalk.cyan(relativePath)} (${(mdContent.length / 1024).toFixed(1)} KB)`);
  } catch (err: any) {
    CLITheme.error(`Export failed: ${err.message || String(err)}`);
  }
}
