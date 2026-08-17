import { TuiStore } from '../store';
import { ConfigManager } from '../../core/config';
import { ILLMProvider } from '../../core/provider';
import { Agent } from '../../core/agent';
import { MemoryStore } from '../../core/memory';
import { getEffortPin, setEffortPin } from '../../core/effortControl';
import { TuiLayoutConfig } from '../layoutConfig';
import { PersonaModals, SystemModals, LayoutModals } from '../modals';

export interface CommandControllerContext {
  store: TuiStore;
  configManager: ConfigManager;
  provider: ILLMProvider;
  layoutConfig: TuiLayoutConfig;
  getAgent: () => Agent;
  setAgent: (a: Agent) => void;
  recreateAgent: () => Agent;
  syncState: () => void;
  probeContextWindow: () => Promise<void>;
  setActiveTab: (tab: 'chat' | 'tools') => void;
  stopApp: () => void;
}

export class TuiCommandController {
  constructor(private ctx: CommandControllerContext) {}

  async handleCommand(commandStr: string): Promise<void> {
    const parts = commandStr.trim().split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');
    const { store, configManager, provider, layoutConfig } = this.ctx;

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

    if (cmd === '/team') {
      if (arg) {
        store.setState({ activeTeam: arg });
        store.notify(`Active team set to: ${arg}`, 'success');
      } else {
        PersonaModals.openTeamModal(store);
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
