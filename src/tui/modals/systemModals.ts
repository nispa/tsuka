import { TuiStore } from '../store';
import { ConfigManager } from '../../core/config';
import { ILLMProvider } from '../../core/provider';
import { MemoryStore, MemoryFact } from '../../core/memory';
import { getEffortPin, setEffortPin } from '../../core/effortControl';
import { probeProvider } from '../../core/discovery';
import { warmUpIfNeeded } from '../../cli/commands/provider';
import commandsData from '../commands/menu.json';

/**
 * `toLocaleTimeString()` alone (the previous hint) drops the date entirely — every fact saved on
 * a different day at a similar time of day looked identical, and there was no way to tell how
 * old anything was. Absolute and locale-independent on purpose: no ambiguity between entries
 * saved days vs. months apart, unlike a relative "2h ago" that keeps changing meaning as it ages.
 */
function formatFactDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class SystemModals {
  static openMemoryModal(store: TuiStore): void {
    const memoryStore = MemoryStore.getInstance();
    const facts: MemoryFact[] = memoryStore.getRecent(100);

    const options = facts.map((f: MemoryFact) => {
      const pinIcon = f.pinned ? '📌 ' : '';
      // T14.20: the label is now the fact's short summary, not a raw truncation of `content` —
      // most facts share a long common prefix (`[Goal] `, `AGENTE: `, …), so a 40-char slice of
      // content made every entry in the list look the same. Full content is still one keypress
      // away via "View Full Text".
      return {
        label: `${pinIcon}[${f.source}] ${f.summary}`,
        value: f.id,
        hint: `${formatFactDate(f.timestamp)} · ${f.kind}${f.hits > 1 ? ` · ×${f.hits}` : ''}`,
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
      title: `Memory #${fact.id.slice(0, 8)}: ${fact.summary}`,
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
            title: `Memory #${fact.id.slice(0, 8)}: ${fact.summary}`,
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
      // probeProvider (not the plain provider.listModels()) also reports what the server has
      // loaded in RAM right now — needed both for the "● loaded" badge and, on selection, to
      // know whether a warm-up request is actually needed (see T14.19).
      const providerName = configManager.getActiveProviderName();
      const activeConfig = configManager.getActiveProviderConfig();
      const apiKey = configManager.getApiKey();
      const scan = await probeProvider(providerName, activeConfig, apiKey);
      const models = scan ? scan.models : await provider.listModels();
      const loadedModel = scan?.loadedModel ?? null;
      const current = provider.getCurrentModel();

      const options = models.map((m) => {
        const tags = [m === loadedModel ? '● loaded' : '', m === current ? '(active)' : ''].filter(Boolean).join(' ');
        return {
          label: `${m === current ? '● ' : '  '}${m}`,
          value: m,
          hint: tags || 'Available',
        };
      });

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
          // T14.19: never steals the "generating" flag from a real turn already in flight.
          const wasIdle = !store.getState().isGenerating;
          if (wasIdle) store.setState({ isGenerating: true, generationStatus: { phase: 'reasoning', agentName: 'Model Warm-Up' } });
          warmUpIfNeeded(activeConfig.baseUrl, apiKey, chosen, loadedModel)
            .catch(() => {})
            .finally(() => { if (wasIdle) store.setState({ isGenerating: false, generationStatus: { phase: 'idle' } }); });
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

  static openProviderModal(
    store: TuiStore,
    configManager: ConfigManager,
    provider: ILLMProvider,
    onAgentRecreate: () => void,
    onSyncState: () => void,
    onProbeCtx: () => Promise<void>
  ): void {
    const current = configManager.getActiveProviderName();
    const options = [
      { label: `${current === 'ollama' ? '● ' : '  '}Ollama`, value: 'ollama', hint: 'Local inference on http://localhost:11434' },
      { label: `${current === 'openrouter' ? '● ' : '  '}OpenRouter`, value: 'openrouter', hint: 'Cloud gateway on https://openrouter.ai/api' },
      { label: `${current === 'unsloth' ? '● ' : '  '}Unsloth Studio`, value: 'unsloth', hint: 'Local unsloth server' },
    ];

    store.showModal({
      type: 'slash_menu',
      title: 'Select LLM Provider Gateway',
      selectedIndex: options.findIndex((o) => o.value === current) >= 0 ? options.findIndex((o) => o.value === current) : 0,
      options,
      onSelect: async (chosen) => {
        configManager.setActiveProvider(chosen as any);
        const newCfg = configManager.getActiveProviderConfig();
        provider.reconfigure(newCfg.baseUrl, configManager.getApiKey(), newCfg.model);
        onAgentRecreate();
        onSyncState();
        store.closeModal();
        store.notify(`Provider switched to: ${chosen.toUpperCase()}`, 'success');
        onProbeCtx().catch(() => {});
      },
    });
  }
}
