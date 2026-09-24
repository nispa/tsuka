/**
 * Commands acting on the current session: screen, clipboard, export, lifecycle.
 */

import { controlSudo } from '../../core/sudoControl';
import * as fs from 'fs';
import * as path from 'path';
import { copyToClipboard } from '../../core/platform';
import { getContextPressure } from '../../core/contextBudget';
import { ContextTracker } from '../../core/contextTracker';
import { SystemModals } from '../modals';
import { TuiCommandSpec } from './types';
import { buildSessionMarkdown, defaultExportPath } from './sessionMarkdown';

export const SESSION_COMMANDS: TuiCommandSpec[] = [
  {
    name: '/sudo',
    description: 'Session shell and file write/edit authorization: on / off / status',
    run: ({ cliContext, store, arg }) => {
      store.addMessage({ role: 'system', content: controlSudo(cliContext().permissionManager, arg) });
    },
  },
  {
    name: '/stop',
    aliases: ['/abort', '/cancel', '/kill'],
    description: 'Stop the running agent activity or workflow',
    run: ({ getTurnRunner }) => {
      getTurnRunner?.()?.interrupt();
    },
  },

  {
    name: '/clear',
    description: 'Clear the conversation feed',
    run: ({ store }) => {
      store.setState({ messages: [], activeTools: [] });
      store.notify('Screen cleared', 'info');
    },
  },

  {
    name: '/copy',
    description: 'Copy the last assistant response to the OS clipboard',
    run: ({ store }) => {
      const lastMsg = [...store.getState().messages].reverse().find((m) => m.role === 'assistant' && m.content);
      if (!lastMsg) {
        store.notify('No assistant response found to copy', 'warn');
        return;
      }
      if (copyToClipboard(lastMsg.content)) store.notify('Copied last assistant response to clipboard!', 'success');
      else store.notify('Clipboard copy failed', 'error');
    },
  },

  {
    name: '/export',
    aliases: ['/save'],
    description: 'Export the session (chat, reasoning, tool calls) to Markdown',
    run: ({ store, arg }) => {
      const state = store.getState();
      if (state.messages.length === 0) {
        store.notify('No messages in session to export', 'warn');
        return;
      }

      let targetFile = arg.trim() || defaultExportPath();
      if (!targetFile.endsWith('.md')) targetFile += '.md';

      const fullPath = path.isAbsolute(targetFile) ? targetFile : path.resolve(process.cwd(), targetFile);
      const relativePath = path.relative(process.cwd(), fullPath) || targetFile;

      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        const mdContent = buildSessionMarkdown(state);
        fs.writeFileSync(fullPath, mdContent, 'utf-8');

        store.addMessage({
          role: 'system',
          content: `✔ **Session exported successfully** to \`${relativePath}\` (${(mdContent.length / 1024).toFixed(1)} KB).`,
        });
        store.notify(`Session exported to ${relativePath}!`, 'success');
      } catch (err: any) {
        store.notify(`Export failed: ${err.message || String(err)}`, 'error');
      }
    },
  },

  {
    name: '/reset',
    description: 'Reset the agent history and restart the session',
    run: ({ store, setAgent, recreateAgent, cliContext }) => {
      cliContext().permissionManager.resetSession();
      setAgent(recreateAgent());
      store.setState({ messages: [], activeTools: [] });
      store.notify('Agent session context reset', 'success');
    },
  },

  {
    name: '/exit',
    description: 'Leave the TUI',
    run: async ({ stopApp }) => {
      try {
        await stopApp();
      } finally {
        process.exit(0);
      }
    },
  },

  {
    name: '/help',
    aliases: ['/h', '/?'],
    // The cheatsheet is the menu itself: listing it inside would be circular.
    hidden: true,
    description: 'Open the commands cheatsheet',
    run: ({ store, run }) => SystemModals.openHelpModal(store, (chosen) => run(chosen)),
  },

  {
    name: '/tools',
    description: 'Show the tools inspector tab',
    run: ({ store, setActiveTab }) => {
      setActiveTab('tools');
      store.notify('Showing Tools inspector tab', 'info');
    },
  },

  {
    name: '/thinking',
    aliases: ['/thought'],
    description: 'Toggle expansion of the reasoning traces',
    run: ({ store }) => {
      const isExpanded = store.toggleThinkingExpansion();
      store.notify(`Reasoning traces: ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
    },
  },

  {
    name: '/info',
    description: 'Session status: persona, provider, model, tokens',
    run: ({ store, configManager }) => {
      const state = store.getState();
      store.addMessage({
        role: 'system',
        content:
          `ℹ️ **TSUKA System Info:**\n` +
          `• **Character**: ${state.activeAiName} (Role: \`${configManager.getActiveRole()}\`, Trait: \`${configManager.getActiveTrait()}\`)\n` +
          `• **Provider**: \`${state.activeProvider}\` (Model: \`${state.activeModel}\`)\n` +
          `• **Context Tokens**: ${state.stats.usedTokens} / ${state.stats.maxTokens} (${state.stats.percentage}%)\n` +
          `• **Turns**: ${state.stats.turnCount} | **Tool Calls**: ${state.stats.toolCallsCount}`,
      });
    },
  },

  {
    name: '/context',
    description: 'Context window and token budget breakdown',
    run: ({ store }) => {
      const state = store.getState();
      const pressure = getContextPressure(state.stats.usedTokens, state.stats.maxTokens);
      const pct = Math.round(pressure.ratio * 100);
      const tracker = ContextTracker.getInstance();
      const scheduler = tracker.getSchedulerMetrics();
      let schedulerSection = '';
      if (scheduler.prepareDecisions > 0 || scheduler.delegateDecisions > 0 || scheduler.delegationsAttempted > 0 || scheduler.peakEstimatedPressure > 0) {
        const ampStr = scheduler.contextAmplification !== null ? `${scheduler.contextAmplification}x` : 'n/a';
        const blockedStr = scheduler.delegationsBlocked > 0 ? `, ${scheduler.delegationsBlocked} blocked` : '';
        schedulerSection =
          `\n\n⚙️ **Context Scheduler Diagnostics:**\n` +
          `• Peak Estimated Pressure: ${Math.round(scheduler.peakEstimatedPressure * 100)}%\n` +
          (scheduler.lastObservedPressure ? `• Last Observed Pressure: ${Math.round(scheduler.lastObservedPressure.ratio * 100)}% (${scheduler.lastObservedPressure.usedTokens}/${scheduler.lastObservedPressure.limitTokens} tok)\n` : '') +
          `• Decisions: ${scheduler.prepareDecisions} prepare, ${scheduler.delegateDecisions} delegate\n` +
          `• Delegations: ${scheduler.delegationsAttempted} attempted, ${scheduler.delegationsCompleted} completed${blockedStr}, ${scheduler.delegationsFailed} failed\n` +
          ((scheduler.delegationsCompleted > 0 || scheduler.delegationsBlocked > 0 || scheduler.delegationsFailed > 0) ? `• Token Economy: ${scheduler.lastChildTokens} child tok / ${scheduler.lastReturnedTokens} returned tok (amplification: ${ampStr})\n` : '') +
          ((scheduler.delegationsCompleted > 0 || scheduler.delegationsBlocked > 0 || scheduler.delegationsFailed > 0) ? `• AgentResult: ${scheduler.lastAgentResultChars} chars\n` : '');
      }
      store.addMessage({
        role: 'system',
        content:
          `📊 **Context Breakdown:**\n` +
          `• Context: ${pct}% (estimated)\n` +
          `• Used: ${pressure.usedTokens.toLocaleString('en-US')} / ${pressure.limitTokens.toLocaleString('en-US')} tokens (${state.stats.percentage}%)\n` +
          `• Max Budget: ${state.stats.maxTokens} tokens\n` +
          `• Messages: ${state.messages.length} retained in session` +
          schedulerSection,
      });
    },
  },
];
