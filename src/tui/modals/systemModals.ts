import { TuiStore } from '../store';
import { ConfigManager } from '../../core/config';
import { ILLMProvider } from '../../core/provider';
import { MemoryStore, MemoryFact } from '../../core/memory';
import { getEffortPin, setEffortPin } from '../../core/effortControl';
import commandsData from '../commands.json';

export class SystemModals {
  static openMemoryModal(store: TuiStore): void {
    const memoryStore = MemoryStore.getInstance();
    const facts: MemoryFact[] = memoryStore.getRecent(100);

    const options = facts.map((f: MemoryFact) => {
      const pinIcon = f.pinned ? '📌 ' : '';
      const snippet = f.content.length > 45 ? f.content.slice(0, 42) + '…' : f.content;
      return {
        label: `${pinIcon}[${f.source}] ${snippet}`,
        value: f.id,
        hint: `Date: ${new Date(f.timestamp).toLocaleTimeString()}`,
      };
    });

    if (options.length === 0) {
      options.push({ label: '(No memories saved)', value: 'none', hint: 'Facts saved via save_memory will appear here' });
    }

    store.showModal({
      type: 'slash_menu',
      title: `🧠 Persistent Memory (${facts.length} items)`,
      selectedIndex: 0,
      options,
      onSelect: (chosenId) => {
        if (chosenId === 'none') {
          store.closeModal();
          return;
        }
        const fact = facts.find((f: MemoryFact) => f.id === chosenId);
        if (fact) {
          SystemModals.openMemoryActionModal(store, fact);
        } else {
          store.closeModal();
        }
      },
    });
  }

  static openMemoryActionModal(store: TuiStore, fact: MemoryFact): void {
    const memoryStore = MemoryStore.getInstance();

    store.showModal({
      type: 'slash_menu',
      title: `Memory #${fact.id.slice(0, 8)}`,
      selectedIndex: 0,
      options: [
        { label: '📥 Recall (Insert into prompt)', value: 'insert', hint: 'Copies text into input prompt' },
        { label: '🔍 View Full Text', value: 'view', hint: 'Read the full content' },
        { label: '🗑️ Delete (Permanent removal)', value: 'delete', hint: 'Removes this fact from memory' },
        { label: '↩️ Back to List', value: 'back', hint: 'Return to memory list' },
      ],
      onSelect: (action) => {
        if (action === 'insert') {
          const current = store.getState().inputText;
          store.setInputText((current ? current + ' ' : '') + fact.content);
          store.setFocus('input');
          store.closeModal();
          store.notify('Memory inserted into prompt', 'info');
        } else if (action === 'view') {
          store.showModal({
            type: 'slash_menu',
            title: `Memory #${fact.id.slice(0, 8)}: Content`,
            selectedIndex: 0,
            options: [
              { label: '↩️ Close View', value: 'close', hint: fact.content },
            ],
            onSelect: () => SystemModals.openMemoryActionModal(store, fact),
          });
        } else if (action === 'delete') {
          memoryStore.remove(fact.id);
          store.notify(`Memory #${fact.id.slice(0, 8)} deleted`, 'warn');
          SystemModals.openMemoryModal(store);
        } else if (action === 'back') {
          SystemModals.openMemoryModal(store);
        } else {
          store.closeModal();
        }
      },
    });
  }

  static async openModelModal(
    store: TuiStore,
    provider: ILLMProvider,
    configManager: ConfigManager,
    onAgentRecreate: () => void,
    onSyncState: () => void,
    onProbeCtx: () => Promise<void>
  ): Promise<void> {
    try {
      const models = await provider.listModels();
      const current = provider.getCurrentModel();

      const options = models.map((m) => ({
        label: `${m === current ? '● ' : '  '}${m}`,
        value: m,
        hint: m === current ? 'Active' : 'Available',
      }));

      store.showModal({
        type: 'slash_menu',
        title: 'Select Backend LLM Model',
        selectedIndex: Math.max(0, models.indexOf(current)),
        options,
        onSelect: (chosen) => {
          provider.setCurrentModel(chosen);
          configManager.updateActiveModel(chosen);
          onAgentRecreate();
          onSyncState();
          store.closeModal();
          store.notify(`Model switched to: ${chosen}`, 'success');
          onProbeCtx().catch(() => {});
        },
      });
    } catch (err: any) {
      store.notify(`Failed to fetch models: ${err.message}`, 'error');
    }
  }

  static openHelpModal(store: TuiStore, onCommandSelect: (cmd: string) => void): void {
    const commands = (commandsData as Array<{ command: string; label: string; hint: string }>).map((c) => ({
      label: c.label,
      value: c.command,
      hint: c.hint,
    }));

    store.showModal({
      type: 'slash_menu',
      title: '📖 REPL Slash Commands & Shortcuts (F1-F7, F12)',
      selectedIndex: 0,
      options: commands,
      onSelect: (chosen) => {
        store.closeModal();
        if (chosen.endsWith(' ')) {
          store.setInputText(chosen);
          store.setFocus('input');
        } else {
          onCommandSelect(chosen);
        }
      },
    });
  }

  static openEffortModal(
    store: TuiStore,
    onAgentRecreate: () => void,
    onSyncState: () => void
  ): void {
    const state = store.getState();
    const currentPin = getEffortPin();
    const activeEffort = state.activeReasoningEffort || 'none';

    const options = [
      { label: '🧠 Auto (Cascade)', value: 'auto', hint: `Cascade: character -> role -> default (${activeEffort})` },
      { label: '⚡ None', value: 'none', hint: 'Disable reasoning tokens (maximum speed)' },
      { label: '🟢 Low', value: 'low', hint: 'Brief reasoning for simple tasks' },
      { label: '🟡 Medium', value: 'medium', hint: 'Balanced reasoning (default/recommended)' },
      { label: '🔴 High / XHigh', value: 'xhigh', hint: 'Deep multi-step reasoning' },
    ];

    store.showModal({
      type: 'slash_menu',
      title: `🎚️ Reasoning Effort [Active: ${activeEffort}${currentPin ? ' (pinned)' : ''}]`,
      selectedIndex: 0,
      options,
      onSelect: (chosen) => {
        if (chosen === 'auto') {
          setEffortPin(undefined);
          onAgentRecreate();
          onSyncState();
          store.closeModal();
          store.notify('Reasoning effort restored to automatic cascade', 'success');
        } else {
          setEffortPin(chosen as any);
          onAgentRecreate();
          onSyncState();
          store.closeModal();
          store.notify(`Reasoning effort pinned to: ${chosen}`, 'success');
        }
      },
    });
  }
}
