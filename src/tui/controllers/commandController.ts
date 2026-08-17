import { TuiStore } from '../store';
import { ConfigManager } from '../../core/config';
import { ILLMProvider } from '../../core/provider';
import { Agent } from '../../core/agent';
import { MemoryStore } from '../../core/memory';
import { getEffortPin, setEffortPin } from '../../core/effortControl';
import { TuiLayoutConfig } from '../layoutConfig';
import { PersonaModals, SystemModals, LayoutModals } from '../modals';

import { ToolRegistry } from '../../tools/registry';
import { PermissionManager } from '../../safety/permissions';

export interface CommandControllerContext {
  store: TuiStore;
  configManager: ConfigManager;
  provider: ILLMProvider;
  registry?: ToolRegistry;
  permissionManager?: PermissionManager;
  layoutConfig: TuiLayoutConfig;
  getAgent: () => Agent;
  setAgent: (a: Agent) => void;
  recreateAgent: () => Agent;
  syncState: () => void;
  probeContextWindow: () => Promise<void>;
  setActiveTab: (tab: 'chat' | 'tools') => void;
  getTurnRunner?: () => any;
  stopApp: () => void;
}

export class TuiCommandController {
  constructor(private ctx: CommandControllerContext) {}

  private getCommandCtx(): any {
    const { configManager, provider } = this.ctx;
    const { listAvailableCharacters, loadCharacter, loadRole, loadTrait, loadTeam, listAvailableItems } = require('../../cli/shared');
    return {
      configManager,
      provider,
      registry: this.ctx.registry || (this.ctx.getAgent() as any).registry,
      permissionManager: this.ctx.permissionManager || (this.ctx.getAgent() as any).permissionManager,
      listAvailableCharacters,
      loadCharacter,
      loadRole,
      loadTrait,
      loadTeam,
      listAvailableItems,
      isTui: true,
      agent: { current: this.ctx.getAgent() },
      availableModels: { current: [] },
      recreateAgent: () => this.ctx.recreateAgent(),
    };
  }

  async handleCommand(commandStr: string): Promise<void> {
    const parts = commandStr.trim().split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');
    const { store, configManager, provider, layoutConfig } = this.ctx;

    if (cmd === '/stop' || cmd === '/abort' || cmd === '/cancel' || cmd === '/kill') {
      const runner = this.ctx.getTurnRunner?.();
      if (runner) {
        runner.interrupt();
      }
      store.setState({
        isGenerating: false,
        generationStatus: { phase: 'idle' },
      });
      store.addMessage({
        role: 'system',
        content: '🛑 **Agent activity stopped by user** (`/stop`).',
      });
      store.notify('Agent activity stopped successfully', 'warn');
      return;
    }

    if (cmd === '/clear') {
      store.setState({ messages: [], activeTools: [] });
      store.notify('Screen cleared', 'info');
      return;
    }

    if (cmd === '/copy') {
      const state = store.getState();
      const lastMsg = [...state.messages].reverse().find((m) => m.role === 'assistant' && m.content);
      if (!lastMsg) {
        store.notify('No assistant response found to copy', 'warn');
        return;
      }
      const { copyToClipboard } = require('../../core/platform');
      const ok = copyToClipboard(lastMsg.content);
      if (ok) store.notify('Copied last assistant response to clipboard!', 'success');
      else store.notify('Clipboard copy failed', 'error');
      return;
    }

    if (cmd === '/exit') {
      this.ctx.stopApp();
      process.exit(0);
    }

    if (cmd === '/help' || cmd === '/h' || cmd === '/?') {
      SystemModals.openHelpModal(store, (chosen) => this.handleCommand(chosen));
      return;
    }

    if (cmd === '/tools') {
      this.ctx.setActiveTab('tools');
      store.notify('Showing Tools inspector tab', 'info');
      return;
    }

    if (cmd === '/reset') {
      this.ctx.setAgent(this.ctx.recreateAgent());
      store.setState({ messages: [], activeTools: [] });
      store.notify('Agent session context reset', 'success');
      return;
    }

    if (cmd === '/agent' || cmd === '/role' || cmd === '/trait') {
      if (arg) {
        if (cmd === '/agent') configManager.setActiveCharacter(arg);
        if (cmd === '/role') configManager.setActiveRole(arg);
        if (cmd === '/trait') configManager.setActiveTrait(arg);
        this.ctx.setAgent(this.ctx.recreateAgent());
        this.ctx.syncState();
        store.notify(`Switched ${cmd.slice(1)} to: ${arg}`, 'success');
      } else {
        PersonaModals.openPersonaModal(store, configManager, () => this.ctx.setAgent(this.ctx.recreateAgent()), () => this.ctx.syncState());
      }
      return;
    }

    if (cmd === '/goal') {
      if (!arg) {
        store.addMessage({
          role: 'system',
          content: '🎯 **Usage:** `/goal <objective>`\nExample: `/goal "Implement user authentication with JWT"`',
        });
        return;
      }

      store.addMessage({
        role: 'user',
        content: `/goal ${arg}`,
      });

      const { handleGoal } = require('../../cli/commands/goal');
      const commandCtx = this.getCommandCtx();

      store.setState({
        isGenerating: true,
        generationStatus: { phase: 'reasoning', agentName: 'Goal Orchestrator' },
      });

      try {
        await handleGoal(commandCtx, arg);
        store.notify(`Goal workflow completed for: "${arg}"`, 'success');
      } catch (err: any) {
        store.addMessage({
          role: 'system',
          content: `❌ **Goal Orchestrator Error:** ${err.message}`,
        });
      } finally {
        store.setState({
          isGenerating: false,
          generationStatus: { phase: 'idle' },
        });
      }
      return;
    }

    if (cmd === '/team') {
      if (!arg) {
        PersonaModals.openTeamModal(store);
        return;
      }

      const trimmed = arg.trim();
      const parts = trimmed.split(/\s+/);
      const teamName = parts[0];
      const rest = trimmed.slice(teamName.length).trim();
      const quoteMatch = rest.match(/^["'](.*)["']$/);
      const task = quoteMatch ? quoteMatch[1] : rest;

      if (!task) {
        store.setState({ activeTeam: teamName });
        store.notify(`Active team set to: ${teamName}`, 'success');
        return;
      }

      store.addMessage({
        role: 'user',
        content: `/team ${teamName} "${task}"`,
      });

      const { handleTeam } = require('../../cli/commands/team');
      const commandCtx = this.getCommandCtx();

      store.setState({
        isGenerating: true,
        generationStatus: { phase: 'reasoning', agentName: `Team: ${teamName}` },
      });

      try {
        await handleTeam(commandCtx, teamName, task);
        store.notify(`Team workflow finished for: ${teamName}`, 'success');
      } catch (err: any) {
        store.addMessage({
          role: 'system',
          content: `❌ **Team Error:** ${err.message}`,
        });
      } finally {
        store.setState({
          isGenerating: false,
          generationStatus: { phase: 'idle' },
        });
      }
      return;
    }

    if (cmd === '/call') {
      if (!arg) {
        store.addMessage({
          role: 'system',
          content: '📞 **Usage:** `/call @agent1 @agent2 "Topic to discuss"`\nExample: `/call @spock @bones "Debate warp engine diagnostics"`',
        });
        return;
      }

      store.addMessage({
        role: 'user',
        content: `/call ${arg}`,
      });

      const { handleCall } = require('../../cli/commands/call');
      const commandCtx = this.getCommandCtx();

      store.setState({
        isGenerating: true,
        generationStatus: { phase: 'reasoning', agentName: 'Conference Call' },
      });

      try {
        await handleCall(commandCtx, arg);
        store.notify('Conference call finished', 'success');
      } catch (err: any) {
        store.addMessage({
          role: 'system',
          content: `❌ **Call Error:** ${err.message}`,
        });
      } finally {
        store.setState({
          isGenerating: false,
          generationStatus: { phase: 'idle' },
        });
      }
      return;
    }

    if (cmd === '/provider') {
      if (arg) {
        const target = arg.toLowerCase().trim();
        if (target === 'ollama' || target === 'openrouter' || target === 'unsloth') {
          configManager.setActiveProvider(target as any);
          const newCfg = configManager.getActiveProviderConfig();
          provider.reconfigure(newCfg.baseUrl, configManager.getApiKey(), newCfg.model);
          this.ctx.setAgent(this.ctx.recreateAgent());
          this.ctx.syncState();
          store.notify(`Provider switched to: ${target.toUpperCase()}`, 'success');
          this.ctx.probeContextWindow().catch(() => {});
        } else {
          store.notify('Supported providers: /provider ollama, openrouter, or unsloth', 'warn');
        }
      } else {
        SystemModals.openProviderModal(
          store,
          configManager,
          provider,
          () => this.ctx.setAgent(this.ctx.recreateAgent()),
          () => this.ctx.syncState(),
          () => this.ctx.probeContextWindow()
        );
      }
      return;
    }

    if (cmd === '/runs') {
      const { getLatestWorkflowLogs } = require('../../cli/commands/workflowLog');
      const logs = getLatestWorkflowLogs(10);
      if (logs.length === 0) {
        store.addMessage({
          role: 'system',
          content: '📜 No workflows saved in `workflow_logs/`. Run a team (`/team`) or goal (`/goal`) to generate reports.',
        });
        return;
      }
      const lines = logs.map((l: any) => {
        const d = l.data;
        const isGoal = d.type === 'goal';
        const ok = d.success || d.completed;
        const icon = ok ? '🟢' : '🔴';
        const title = isGoal ? `Goal: ${d.goal}` : `Team: ${d.displayName || d.team} (${d.task || ''})`;
        const date = (d.timestamp || '').replace('T', ' ').slice(0, 16);
        return `• ${icon} **${date}** \`[${l.file}]\` ${title}`;
      });
      store.addMessage({
        role: 'system',
        content: `📜 **Recent Workflow Runs (${logs.length}):**\n\n${lines.join('\n')}`,
      });
      return;
    }

    if (cmd === '/blackboard') {
      const { getLatestWorkflowLogs } = require('../../cli/commands/workflowLog');
      const limit = parseInt(arg, 10) || 3;
      const logs = getLatestWorkflowLogs(limit);
      if (logs.length === 0) {
        store.addMessage({
          role: 'system',
          content: '📋 No workflow reports found in `workflow_logs/`.',
        });
        return;
      }
      const blocks: string[] = [];
      for (const { file, data } of logs) {
        const isGoal = data.type === 'goal';
        const title = isGoal ? `🎯 GOAL: "${data.goal}"` : `👥 TEAM: ${data.displayName || data.team} — "${data.task}"`;
        const notes = Array.isArray(data.blackboard) ? data.blackboard : [];
        const notesStr = notes.length > 0
          ? notes.map((n: any) => `  • \`[${n.key}]\` (@${n.author}): ${n.value}`).join('\n')
          : '  _(No notes recorded)_';
        blocks.push(`**${file}** — ${title}\n${notesStr}`);
      }
      store.addMessage({
        role: 'system',
        content: `📋 **Recent Blackboard Notes:**\n\n${blocks.join('\n\n')}`,
      });
      return;
    }

    if (cmd === '/benchmark') {
      const { handleBenchmark } = require('../../cli/commands/benchmark');
      const commandCtx = this.getCommandCtx();

      store.addMessage({
        role: 'user',
        content: `/benchmark ${arg || ''}`.trim(),
      });

      store.setState({
        isGenerating: true,
        generationStatus: { phase: 'reasoning', agentName: 'Benchmark Suite' },
      });

      try {
        await handleBenchmark(commandCtx, arg);
        store.notify('Benchmark completed! Results saved to models_profile.json', 'success');
      } catch (err: any) {
        store.addMessage({
          role: 'system',
          content: `❌ **Benchmark Error:** ${err.message}`,
        });
      } finally {
        store.setState({
          isGenerating: false,
          generationStatus: { phase: 'idle' },
        });
      }
      return;
    }

    if (cmd === '/search-engine') {
      if (arg) {
        const eng = arg.toLowerCase().trim();
        if (eng === 'duckduckgo' || eng === 'tavily' || eng === 'google') {
          configManager.setWebSearchProvider(eng as any);
          store.notify(`Web search provider updated to: ${eng.toUpperCase()}`, 'success');
        } else {
          store.notify('Supported engines: duckduckgo, tavily, google', 'warn');
        }
      } else {
        const current = configManager.getWebSearchProvider();
        const options = [
          { label: `${current === 'duckduckgo' ? '● ' : '  '}DuckDuckGo`, value: 'duckduckgo', hint: 'Free, no API key required' },
          { label: `${current === 'google' ? '● ' : '  '}Google Search`, value: 'google', hint: 'Requires GOOGLE_SEARCH_API_KEY in .env' },
          { label: `${current === 'tavily' ? '● ' : '  '}Tavily API`, value: 'tavily', hint: 'Requires TAVILY_API_KEY in .env' },
        ];
        store.showModal({
          type: 'slash_menu',
          title: 'Select Web Search Provider',
          selectedIndex: options.findIndex((o) => o.value === current) >= 0 ? options.findIndex((o) => o.value === current) : 0,
          options,
          onSelect: (chosen) => {
            configManager.setWebSearchProvider(chosen as any);
            store.closeModal();
            store.notify(`Web search provider set to: ${chosen.toUpperCase()}`, 'success');
          },
        });
      }
      return;
    }

    if (cmd === '/models' || cmd === '/model') {
      if (arg) {
        configManager.updateActiveModel(arg);
        provider.setCurrentModel(arg);
        this.ctx.setAgent(this.ctx.recreateAgent());
        this.ctx.syncState();
        store.notify(`Active model switched to: ${arg}`, 'success');
        this.ctx.probeContextWindow().catch(() => {});
      } else {
        await SystemModals.openModelModal(
          store,
          provider,
          configManager,
          () => this.ctx.setAgent(this.ctx.recreateAgent()),
          () => this.ctx.syncState(),
          () => this.ctx.probeContextWindow()
        );
      }
      return;
    }

    if (cmd === '/memory') {
      if (!arg) {
        SystemModals.openMemoryModal(store);
        return;
      }
      const memStore = MemoryStore.getInstance();
      if (arg.toLowerCase() === 'clear') {
        memStore.clear();
        store.notify('Persistent shared memory cleared', 'warn');
        return;
      }
      const results = memStore.search(arg, 10);
      if (results.length === 0) {
        store.addMessage({
          role: 'system',
          content: `🧠 No memories matching "${arg}".`,
        });
      } else {
        const formatted = results.map((r, i) => `• [#${i + 1}] (${r.source}): ${r.content}`).join('\n');
        store.addMessage({
          role: 'system',
          content: `🧠 **Memories matching "${arg}":**\n\n${formatted}`,
        });
      }
      return;
    }

    if (cmd === '/effort') {
      if (!arg) {
        SystemModals.openEffortModal(store, () => this.ctx.setAgent(this.ctx.recreateAgent()), () => this.ctx.syncState());
      } else {
        const eff = arg.toLowerCase().trim();
        if (eff === 'none') {
          setEffortPin('none');
          this.ctx.setAgent(this.ctx.recreateAgent());
          this.ctx.syncState();
          store.notify('Reasoning effort set to: none', 'info');
        } else if (eff === 'low' || eff === 'medium' || eff === 'xhigh' || eff === 'high') {
          setEffortPin(eff as any);
          this.ctx.setAgent(this.ctx.recreateAgent());
          this.ctx.syncState();
          store.notify(`Reasoning effort set to: ${eff}`, 'success');
        } else if (eff === 'auto') {
          setEffortPin(undefined);
          this.ctx.setAgent(this.ctx.recreateAgent());
          this.ctx.syncState();
          store.notify('Reasoning effort reset to auto cascade', 'info');
        } else {
          SystemModals.openEffortModal(store, () => this.ctx.setAgent(this.ctx.recreateAgent()), () => this.ctx.syncState());
        }
      }
      return;
    }

    if (cmd === '/layout') {
      LayoutModals.openLayoutModal(store, layoutConfig);
      return;
    }

    if (cmd === '/info') {
      const state = store.getState();
      const role = configManager.getActiveRole();
      const trait = configManager.getActiveTrait();
      store.addMessage({
        role: 'system',
        content: `ℹ️ **TSUKA System Info:**\n• **Character**: ${state.activeAiName} (Role: \`${role}\`, Trait: \`${trait}\`)\n• **Provider**: \`${state.activeProvider}\` (Model: \`${state.activeModel}\`)\n• **Context Tokens**: ${state.stats.usedTokens} / ${state.stats.maxTokens} (${state.stats.percentage}%)\n• **Turns**: ${state.stats.turnCount} | **Tool Calls**: ${state.stats.toolCallsCount}`,
      });
      return;
    }

    if (cmd === '/context') {
      const state = store.getState();
      store.addMessage({
        role: 'system',
        content: `📊 **Context Breakdown:**\n• Used: ${state.stats.usedTokens} tokens (${state.stats.percentage}%)\n• Max Budget: ${state.stats.maxTokens} tokens\n• Messages: ${state.messages.length} retained in session`,
      });
      return;
    }

    if (cmd === '/thinking' || cmd === '/thought') {
      const isExpanded = store.toggleThinkingExpansion();
      store.notify(`Reasoning traces: ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
      return;
    }

    // Default fallback
    store.addMessage({
      role: 'system',
      content: `Executed command: ${cmd} ${arg}. Type \`/help\` or press F12 to see all commands.`,
    });
  }
}
