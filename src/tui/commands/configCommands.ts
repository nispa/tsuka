/**
 * Commands changing the active configuration: persona, provider, model,
 * memory, reasoning effort, layout, web search engine.
 *
 * Each command opens its modal when called without an argument and applies the
 * value directly when called with one; the accepted values are tables, so
 * adding a provider or an effort level does not mean adding a branch.
 */

import { MemoryStore } from '../../core/memory';
import { setEffortPin } from '../../core/effortControl';
import { ConfigManager } from '../../core/config';
import { syncModelOnServer } from '../../cli/commands/provider';
import { PersonaModals, SystemModals, LayoutModals } from '../modals';
import { TuiCommandContext, TuiCommandSpec } from './types';

/** Rebuilds the agent and refreshes the header after a configuration change. */
function applyAndSync(c: TuiCommandContext): void {
  c.setAgent(c.recreateAgent());
  c.syncState();
}

/** Persona pickers: same behaviour, different setter. */
const PERSONA_SETTERS: Record<string, (cfg: ConfigManager, value: string) => void> = {
  '/agent': (cfg, value) => cfg.setActiveCharacter(value),
  '/role': (cfg, value) => cfg.setActiveRole(value),
  '/trait': (cfg, value) => cfg.setActiveTrait(value),
};

function personaCommand(name: string, description: string): TuiCommandSpec {
  return {
    name,
    description,
    run: (c) => {
      if (!c.arg) {
        PersonaModals.openPersonaModal(c.store, c.configManager, () => c.setAgent(c.recreateAgent()), () => c.syncState());
        return;
      }
      PERSONA_SETTERS[name](c.configManager, c.arg);
      applyAndSync(c);
      c.store.notify(`Switched ${name.slice(1)} to: ${c.arg}`, 'success');
    },
  };
}

const SUPPORTED_PROVIDERS = ['ollama', 'openrouter', 'unsloth'] as const;

const SEARCH_ENGINES = [
  { value: 'duckduckgo', label: 'DuckDuckGo', hint: 'Free, no API key required' },
  { value: 'google', label: 'Google Search', hint: 'Requires GOOGLE_SEARCH_API_KEY in .env' },
  { value: 'tavily', label: 'Tavily API', hint: 'Requires TAVILY_API_KEY in .env' },
] as const;

/** Effort levels accepted by /effort: pin value and the toast that confirms it. */
const EFFORT_LEVELS: Record<string, { pin: string | undefined; message: string; tone: 'info' | 'success' }> = {
  none: { pin: 'none', message: 'Reasoning effort set to: none', tone: 'info' },
  low: { pin: 'low', message: 'Reasoning effort set to: low', tone: 'success' },
  medium: { pin: 'medium', message: 'Reasoning effort set to: medium', tone: 'success' },
  high: { pin: 'high', message: 'Reasoning effort set to: high', tone: 'success' },
  xhigh: { pin: 'xhigh', message: 'Reasoning effort set to: xhigh', tone: 'success' },
  auto: { pin: undefined, message: 'Reasoning effort reset to auto cascade', tone: 'info' },
};

export const CONFIG_COMMANDS: TuiCommandSpec[] = [
  personaCommand('/agent', 'Choose or switch the agent persona'),
  personaCommand('/role', 'Set the operational role'),
  personaCommand('/trait', 'Set the communication style'),

  {
    name: '/provider',
    description: 'Switch LLM provider (Ollama, OpenRouter, Unsloth)',
    run: (c) => {
      if (!c.arg) {
        SystemModals.openProviderModal(
          c.store,
          c.configManager,
          c.provider,
          () => c.setAgent(c.recreateAgent()),
          () => c.syncState(),
          () => c.probeContextWindow()
        );
        return;
      }

      const target = c.arg.toLowerCase().trim() as (typeof SUPPORTED_PROVIDERS)[number];
      if (!SUPPORTED_PROVIDERS.includes(target)) {
        c.store.notify(`Supported providers: ${SUPPORTED_PROVIDERS.map((p) => `/provider ${p}`).join(', ')}`, 'warn');
        return;
      }

      c.configManager.setActiveProvider(target as any);
      const newCfg = c.configManager.getActiveProviderConfig();
      c.provider.reconfigure(newCfg.baseUrl, c.configManager.getApiKey(), newCfg.model);
      applyAndSync(c);
      c.store.notify(`Provider switched to: ${target.toUpperCase()}`, 'success');
      c.probeContextWindow().catch(() => {});
    },
  },

  {
    name: '/models',
    aliases: ['/model'],
    description: 'Select or switch the backend LLM model',
    run: async (c) => {
      if (!c.arg) {
        await SystemModals.openModelModal(
          c.store,
          c.provider,
          c.configManager,
          () => c.setAgent(c.recreateAgent()),
          () => c.syncState(),
          () => c.probeContextWindow()
        );
        return;
      }

      c.configManager.updateActiveModel(c.arg);
      c.provider.setCurrentModel(c.arg);
      applyAndSync(c);
      c.store.notify(`Active model switched to: ${c.arg}`, 'success');
      c.probeContextWindow().catch(() => {});
      // Points TSUKA at the new model; doesn't by itself ask the server to load it — T14.19
      // sends that request too, with header progress if nothing else is already running
      // (never steals the "generating" flag from a real, unrelated turn already in flight).
      const wasIdle = !c.store.getState().isGenerating;
      if (wasIdle) c.store.setState({ isGenerating: true, generationStatus: { phase: 'reasoning', agentName: 'Model Warm-Up' } });
      syncModelOnServer(c.configManager, c.arg)
        .catch(() => {})
        .finally(() => { if (wasIdle) c.store.setState({ isGenerating: false, generationStatus: { phase: 'idle' } }); });
    },
  },

  {
    name: '/memory',
    description: 'Manage and search the shared persistent memory',
    run: ({ store, arg }) => {
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
        store.addMessage({ role: 'system', content: `🧠 No memories matching "${arg}".` });
        return;
      }

      const formatted = results.map((r, i) => `• [#${i + 1}] (${r.source}): ${r.content}`).join('\n');
      store.addMessage({ role: 'system', content: `🧠 **Memories matching "${arg}":**\n\n${formatted}` });
    },
  },

  {
    name: '/effort',
    description: 'Reasoning effort: none, low, medium, xhigh, auto',
    run: (c) => {
      const level = EFFORT_LEVELS[c.arg.toLowerCase().trim()];
      if (!level) {
        // No argument, or an unknown level: let the user pick from the modal.
        SystemModals.openEffortModal(c.store, () => c.setAgent(c.recreateAgent()), () => c.syncState());
        return;
      }

      setEffortPin(level.pin as any);
      applyAndSync(c);
      c.store.notify(level.message, level.tone);
    },
  },

  {
    name: '/layout',
    description: 'TUI layout editor: presets, themes, widths, files explorer',
    run: ({ store, layoutConfig }) => LayoutModals.openLayoutModal(store, layoutConfig),
  },

  {
    name: '/search-engine',
    description: 'Configure the web search provider',
    run: ({ store, configManager, arg }) => {
      const requested = arg.toLowerCase().trim();

      if (requested) {
        if (!SEARCH_ENGINES.some((e) => e.value === requested)) {
          store.notify(`Supported engines: ${SEARCH_ENGINES.map((e) => e.value).join(', ')}`, 'warn');
          return;
        }
        configManager.setWebSearchProvider(requested as any);
        store.notify(`Web search provider updated to: ${requested.toUpperCase()}`, 'success');
        return;
      }

      const current = configManager.getWebSearchProvider();
      const options = SEARCH_ENGINES.map((e) => ({
        label: `${current === e.value ? '● ' : '  '}${e.label}`,
        value: e.value,
        hint: e.hint,
      }));

      store.showModal({
        type: 'slash_menu',
        title: 'Select Web Search Provider',
        selectedIndex: Math.max(0, options.findIndex((o) => o.value === current)),
        options,
        onSelect: (chosen) => {
          configManager.setWebSearchProvider(chosen as any);
          store.closeModal();
          store.notify(`Web search provider set to: ${chosen.toUpperCase()}`, 'success');
        },
      });
    },
  },
];
