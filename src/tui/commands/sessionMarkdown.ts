/**
 * Renders the active TUI session as a Markdown document (T14.4).
 * Kept apart from the /export command so the formatting can be tested
 * without touching the filesystem.
 */

import { TuiState, TuiChatMessage } from '../types';

/** Renderer for one chat role: the message shape drives the output, not an if-chain. */
type MessageRenderer = (msg: TuiChatMessage, state: TuiState, timeBadge: string) => string[];

function renderThinking(msg: TuiChatMessage): string[] {
  if (!msg.thinkingContent) return [];
  const tokens = msg.thinkingTokens ? `${msg.thinkingTokens.toLocaleString()} tokens` : 'Chain of Thought';
  return [
    '<details>',
    `<summary>💭 <i>Reasoning Trace (${tokens})</i></summary>`,
    '',
    msg.thinkingContent,
    '',
    '</details>',
    '',
  ];
}

function renderToolCalls(msg: TuiChatMessage): string[] {
  const lines: string[] = [];
  for (const tc of msg.toolCalls || []) {
    const duration = tc.durationMs ? ` in ${tc.durationMs}ms` : '';
    lines.push(
      '<details>',
      `<summary>⚡ <b>Tool Execution: \`${tc.name}\`</b> (${tc.status}${duration})</summary>`,
      '',
      '**Arguments:**',
      '```json',
      tc.args || '{}',
      '```'
    );
    if (tc.output) {
      lines.push('', '**Output:**', '```', tc.output, '```');
    }
    lines.push('', '</details>', '');
  }
  return lines;
}

// Roles missing from this table (e.g. 'tool') are not exported: their content is
// already carried by the tool call blocks of the assistant message.
const MESSAGE_RENDERERS: Partial<Record<TuiChatMessage['role'], MessageRenderer>> = {
  user: (msg, _state, timeBadge) => [`### 👤 User${timeBadge}`, '', msg.content || '', ''],

  assistant: (msg, state, timeBadge) => [
    `### 🤖 @${msg.authorName || state.activeAiName}${timeBadge}`,
    '',
    ...renderThinking(msg),
    ...renderToolCalls(msg),
    ...(msg.content ? [msg.content, ''] : []),
  ],

  system: (msg, _state, timeBadge) => [`> ℹ️ **System Notification**${timeBadge}: ${msg.content}`, ''],
};

function renderHeader(state: TuiState): string[] {
  const totalBurned = (state.stats.totalSessionTokens || state.stats.usedTokens).toLocaleString();
  return [
    '# 📜 TSUKA Chat Session Export',
    '',
    `> **Export Date:** ${new Date().toLocaleString()}  `,
    `> **Active Persona:** \`${state.activeAiName}\` (Role: \`${state.activeCharacterRole}\`, Trait: \`${state.activeCharacterTrait}\`)  `,
    `> **Provider / Model:** \`${state.activeProvider}\` / \`${state.activeModel}\`  `,
    `> **Metrics:** ${state.stats.turnCount} turns • ${state.stats.toolCallsCount} tool calls • ` +
      `${state.stats.usedTokens} active tokens (${totalBurned} total burned)  `,
    '',
    '---',
    '',
  ];
}

export function buildSessionMarkdown(state: TuiState): string {
  const lines = renderHeader(state);

  for (const msg of state.messages) {
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
    const timeBadge = time ? ` *[${time}]*` : '';
    const render = MESSAGE_RENDERERS[msg.role];
    if (render) lines.push(...render(msg, state, timeBadge));
  }

  return lines.join('\n');
}

/** Default target when /export is called without a filename: exports/session-<timestamp>.md */
export function defaultExportPath(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `exports/session-${stamp}.md`;
}
