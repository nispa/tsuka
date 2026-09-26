/**
 * Main Application Orchestrator for TSUKA TUI.
 * Wires the double-buffered screen, the reactive store and the controllers together,
 * owns the agent lifecycle and dispatches input events to the interaction modules
 * (src/tui/interaction/) and rendering to the pure frame composer (layoutComposer.ts).
 */

import { TuiScreen, KeyPressEvent, TuiMouseEvent } from './screen';
import { TuiTabSpec, resolveTabShortcut } from './navigation';
import { completeTuiInput } from './inputCompletion';
import { TuiStore } from './store';
import { TuiBridge } from './bridge';
import { Agent, ToolRoundsAction, resolveReasoningEffort } from '../core/agent';
import { resolveToolSet } from '../core/toolSet';
import { ConfigManager } from '../core/config';
import { ILLMProvider, setTimeoutPromptHandler, TimeoutAction } from '../core/provider';
import { IToolRegistry } from '../tools/registry';
import { PermissionManager } from '../safety/permissions';
import { loadCharacter, loadRole, loadTrait, loadSystemPrompt } from '../cli/shared';
import { withEffortPin, describeEffortSource, setEffortPin } from '../core/effortControl';
import { detectContextWindow, scanProviders } from '../core/discovery';
import { LayoutConfigManager, TuiLayoutConfig } from './layoutConfig';
import { composeLayoutFrame, TuiFrame } from './layoutEngines';
import { ModalKeyHandler, PersonaModals, SystemModals, LayoutModals } from './modals';
import { FilesView } from './views/Files';
import {
  handleChatKey,
  handleFilesKey,
  handleInputKey,
  handleSidebarKey,
  handleToolsKey,
  openFileEntry as openFileEntryAction,
} from './interaction/keyHandlers';
import { routeMouseEvent } from './interaction/mouseRouter';
import { TuiFileItem, TuiFocus } from './types';
import { TuiCommandController, TuiTurnRunner } from './controllers';
import { setLogSink, resetLogSink } from '../core/logSink';
import { setProgressSink } from '../core/progressSink';
import type { ISubagentRunner } from '../core/types';

export interface TuiAppOptions {
  configManager: ConfigManager;
  provider: ILLMProvider;
  registry: IToolRegistry;
  permissionManager: PermissionManager;
  subagentRunner?: ISubagentRunner;
  onShutdown?: () => void | Promise<void>;
}

export class TuiApp {
  private screen: TuiScreen;
  private store: TuiStore;
  private bridge: TuiBridge;
  private configManager: ConfigManager;
  private provider: ILLMProvider;
  private registry: IToolRegistry;
  private permissionManager: PermissionManager;
  private subagentRunner?: ISubagentRunner;
  private agent: Agent;
  private activeTab: 'chat' | 'tools' = 'chat';
  private layoutConfig: TuiLayoutConfig;
  /** Frame last painted: mouse hit-testing and the focus cycle read its regions. */
  private lastFrame?: TuiFrame;
  private commandController: TuiCommandController;
  private turnRunner: TuiTurnRunner;
  private onShutdown?: () => void | Promise<void>;
  private stopPromise?: Promise<void>;

  constructor(options: TuiAppOptions) {
    this.configManager = options.configManager;
    this.provider = options.provider;
    this.registry = options.registry;
    this.permissionManager = options.permissionManager;
    this.subagentRunner = options.subagentRunner;
    this.onShutdown = options.onShutdown;
    this.layoutConfig = LayoutConfigManager.load();

    this.screen = new TuiScreen();
    this.store = new TuiStore();
    this.bridge = new TuiBridge(this.store, this.permissionManager);

    this.setupTimeoutPrompt();
    // Restore the last /effort choice persisted in tsuka.config.json as the startup pin,
    // BEFORE the first recreateAgent() bakes effort into the agent (same as cli/index.ts).
    const savedEffort = this.configManager.getDefaultReasoningEffort();
    if (savedEffort) setEffortPin(savedEffort);
    this.agent = this.recreateAgent();

    this.commandController = new TuiCommandController({
      store: this.store,
      configManager: this.configManager,
      provider: this.provider,
      registry: this.registry,
      permissionManager: this.permissionManager,
      subagentRunner: this.subagentRunner,
      layoutConfig: this.layoutConfig,
      getAgent: () => this.agent,
      setAgent: (a) => { this.agent = a; },
      recreateAgent: () => this.recreateAgent(),
      syncState: () => this.syncInitialState(),
      probeContextWindow: () => this.probeContextWindow(),
      setActiveTab: (t) => { this.activeTab = t; },
      getTurnRunner: () => this.turnRunner,
      workflowEvents: {
        onChunk: this.bridge.createChunkHandler(),
        onStats: this.bridge.createStatsHandler(),
        onEvent: this.bridge.createEventHandler(),
        onParallelStart: (agentNames) => this.bridge.setParallelAgents(agentNames),
        onParallelEnd: () => this.bridge.setParallelAgents([]),
        reset: () => this.bridge.resetCurrentTurn(),
      },
      stopApp: () => this.stop(),
    });

    this.turnRunner = new TuiTurnRunner({
      store: this.store,
      bridge: this.bridge,
      getAgent: () => this.agent,
      commandController: this.commandController,
    });

    this.syncInitialState();
    this.setupSubscriptions();
  }

  private recreateAgent(): Agent {
    const charName = this.configManager.getActiveCharacter();
    const char = loadCharacter(charName);
    const roleName = char ? (char.role || (char.roles && char.roles[0]) || 'developer') : this.configManager.getActiveRole();
    const traitName = char ? char.trait : this.configManager.getActiveTrait();

    const role = loadRole(roleName);
    const trait = loadTrait(traitName);
    const model = this.provider.getCurrentModel();

    const cascadedEffort = resolveReasoningEffort(undefined, char, role, this.configManager.getDefaultReasoningEffort());
    const reasoningEffort = withEffortPin(cascadedEffort);

    const toolSet = resolveToolSet(role);

    const a = new Agent(
      this.provider,
      this.registry,
      this.permissionManager,
      loadSystemPrompt(
        role,
        trait,
        model,
        this.registry,
        char,
        undefined,
        reasoningEffort,
        this.provider.getBaseUrl(),
        this.provider.getProviderClass?.()
      ),
      toolSet.active,
      this.configManager.getMaxHistoryMessages(),
      this.configManager.getMaxHistoryTokens(),
      char?.aiName || role.name,
      reasoningEffort,
      undefined,
      this.configManager.getMaxToolRounds()
    );
    a.setDeferredTools(toolSet.deferred);
    a.setRoleName(role.name);
    if (char) a.setCharName(char.aiName);
    a.setSubagentRunner(this.subagentRunner);
    if (this.configManager.isContextSchedulerEnabled()) {
      a.setContextScheduler({
        enabled: true,
        ...this.configManager.getContextSchedulerConfig(),
      });
    }

    a.setToolRoundsPromptHandler((info) => {
      return new Promise<ToolRoundsAction>((resolve) => {
        this.store.showModal({
          type: 'slash_menu',
          title: `⚙️ Tool Rounds Limit Reached (${info.currentRounds} rounds)`,
          selectedIndex: 0,
          options: [
            { label: '➕ Grant 15 more tool rounds (Continue)', value: 'extend', hint: 'Allow agent to continue executing tools' },
            { label: '📝 Request final answer conclusion', value: 'conclude', hint: 'Ask agent to summarize and finish response' },
            { label: '🛑 Abort execution now', value: 'abort', hint: 'Immediately stop active turn' },
          ],
          onSelect: (chosen) => {
            this.store.closeModal();
            resolve((chosen as ToolRoundsAction) || 'extend');
          },
        });
      });
    });

    return a;
  }

  private setupTimeoutPrompt(): void {
    setTimeoutPromptHandler((info) => {
      return new Promise<TimeoutAction>((resolve) => {
        const minutes = Math.max(1, Math.round(info.elapsedMs / 60000));
        this.store.showModal({
          type: 'slash_menu',
          title: `⏳ Waiting for LLM / Reasoning (${minutes} min elapsed)`,
          selectedIndex: 0,
          options: [
            { label: `➕ Grant ${minutes} more min (Continue)`, value: 'extend', hint: 'Reset timer and let model continue generating' },
            { label: '★ Wait indefinitely for this turn', value: 'unlimited', hint: 'Wait until completion without timeouts' },
            { label: '🛑 Stop generation here', value: 'abort', hint: 'Stop generation and return partial output' },
          ],
          onSelect: (chosen) => {
            this.store.closeModal();
            resolve((chosen as TimeoutAction) || 'extend');
          },
        });
      });
    });
  }

  private syncInitialState(): void {
    const charName = this.configManager.getActiveCharacter();
    const char = loadCharacter(charName);
    const roleName = char ? (char.role || (char.roles && char.roles[0]) || 'developer') : this.configManager.getActiveRole();
    const traitName = char ? char.trait : this.configManager.getActiveTrait();
    const aiName = char ? (char.aiName || char.displayName) : 'Tsuka';
    const role = loadRole(roleName);
    const configDefault = this.configManager.getDefaultReasoningEffort();
    const { effort, source } = describeEffortSource(char, role, configDefault);
    const sourceLabel = source === 'personaggio' ? 'persona' : source === 'ruolo' ? 'role' : source === 'pin' ? 'pin' : source === 'default' ? 'config' : 'model';

    this.store.setState({
      activeCharacterName: charName,
      activeCharacterRole: roleName,
      activeCharacterTrait: traitName,
      activeAiName: aiName,
      activeProvider: this.configManager.getActiveProviderName(),
      activeModel: this.provider.getCurrentModel(),
      activeReasoningEffort: effort ?? 'none',
      activeEffortSource: sourceLabel,
      characterRecommendedEffort: char?.reasoningEffort,
      stats: {
        usedTokens: 0,
        maxTokens: this.configManager.getMaxHistoryTokens() || 8192,
        percentage: 0,
        turnCount: 0,
        toolCallsCount: 0,
        reasoningEffort: effort,
      },
    });
  }

  private setupSubscriptions(): void {
    this.store.subscribe(() => this.screen.requestRender());
    this.screen.setRenderer(() => this.renderFrame());
    this.screen.onKey((key) => this.handleKeyPress(key));
    this.screen.onMouse((mouse) => this.handleMouseEvent(mouse));
  }

  start(): void {
    process.env.TSUKA_TUI = '1';
    setLogSink({
      log: (msg: string) => {
        if (msg && msg.trim()) {
          const stripped = msg.replace(/\x1b\[[0-9;]*m/g, '').trim();
          if (stripped.length > 0 && !stripped.startsWith('[Out:')) {
            this.store.addMessage({ role: 'system', content: stripped });
          }
        }
      },
      warn: (msg: string) => this.store.notify(msg, 'warn'),
      error: (msg: string) => this.store.notify(msg, 'error'),
      // Command output is attached to the tool event on completion. Writing chunks
      // independently would flood the chat while the TUI owns the terminal buffer.
      write: () => {},
    });
    setProgressSink((text: string) => {
      const stripped = text.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (!stripped) return;
      const gen = this.store.getState().generationStatus;
      this.store.setState({
        generationStatus: { phase: gen?.phase ?? 'reasoning', agentName: gen?.agentName, toolName: gen?.toolName, detail: stripped },
      });
    });
    this.screen.start();
    this.screen.requestRender();
    this.discoverModelAtStartup().catch(() => {});
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = (async () => {
      delete process.env.TSUKA_TUI;
      this.screen.stop();
      try {
        await this.onShutdown?.();
      } finally {
        resetLogSink();
        setProgressSink(null);
      }
    })();
    return this.stopPromise;
  }

  /**
   * Startup autodiscovery: what the CLI already does on `/provider` and `/models` (probeProvider,
   * see cli/commands/provider.ts) but unattended, run once when the TUI opens. tsuka.config.json
   * records a model name, but the server behind it can drift — restarted with a different model,
   * or the configured one no longer served — and nothing short of manually running `/provider`
   * used to notice. This reconciles config against what the server actually reports,
   * with the SAME precedence as the CLI startup (cli/index.ts):
   *  - configured provider unreachable → fail over to the first reachable local server,
   *    or an authenticated remote provider such as OpenRouter;
   *  - a model already loaded in server RAM wins: attaching to it avoids forcing a slow
   *    reload of the server;
   *  - otherwise keep the configured model if still served, else fall back to the first
   *    available (same auto-recovery `handleProvider` performs after a manual switch);
   *  - either way, calibrate the context window from the same scan instead of a second round trip.
   * Silent on an unreachable server — scanProviders returning null just means "nothing to do".
   */
  async discoverModelAtStartup(): Promise<void> {
    try {
      const providerName = this.configManager.getActiveProviderName();
      const candidates = this.configManager.getProviderNames().map((name) => ({
        name,
        config: this.configManager.getProviderConfig(name)!,
        apiKey: this.configManager.getApiKeyFor(name),
      }));
      const scan = await scanProviders(candidates, providerName);
      if (!scan) return;

      // Provider failover: same recovery as the CLI startup path.
      if (scan.name !== providerName) {
        this.configManager.setActiveProvider(scan.name);
        const newCfg = this.configManager.getActiveProviderConfig();
        this.provider.reconfigure(newCfg.baseUrl, this.configManager.getApiKey(), newCfg.model, newCfg.class);
        this.agent = this.recreateAgent();
        this.store.notify(`Configured provider '${providerName}' unreachable — switched to '${scan.name}'`, 'warn');
      }
      const configuredModel = this.provider.getCurrentModel();

      // RAM-loaded model beats config (same precedence as cli/index.ts startup).
      const chosen = scan.loadedModel ?? (scan.models.includes(configuredModel) ? configuredModel : (scan.models[0] ?? ''));
      if (chosen && chosen !== configuredModel) {
        this.provider.setCurrentModel(chosen);
        this.configManager.updateActiveModel(chosen);
        this.agent = this.recreateAgent();
        if (scan.loadedModel === chosen) {
          this.store.notify(`Attached to model already loaded in server RAM: '${chosen}'`, 'success');
        } else {
          this.store.notify(`Model '${configuredModel}' not found on server — switched to '${chosen}'`, 'warn');
        }
      }

      const dynamicCtx = scan.contextWindow;
      if (dynamicCtx && dynamicCtx >= 1024) {
        this.applyContextWindow(dynamicCtx);
      }
    } catch {}
  }

  async probeContextWindow(): Promise<void> {
    try {
      const activeConfig = this.configManager.getActiveProviderConfig();
      const apiKey = this.configManager.getApiKey();
      const currentModel = this.provider.getCurrentModel();
      const dynamicCtx = await detectContextWindow(activeConfig.baseUrl, apiKey, currentModel);
      if (dynamicCtx && dynamicCtx >= 1024) {
        this.applyContextWindow(dynamicCtx);
      }
    } catch {}
  }

  /** Shared tail of both discovery paths: persist, reflect in stats, rebuild the agent. */
  private applyContextWindow(dynamicCtx: number): void {
    this.configManager.setRuntimeContextTokens(dynamicCtx);
    const usedTokens = this.store.getState().stats.usedTokens;
    this.store.updateStats({
      maxTokens: dynamicCtx,
      percentage: Math.min(100, Math.round((usedTokens / dynamicCtx) * 100)),
    });
    this.agent = this.recreateAgent();
    this.store.notify(`Context window calibrated: ${dynamicCtx.toLocaleString()} tokens (${this.provider.getCurrentModel()})`, 'info');
  }

  // ── Layout Frame Rendering ──

  private renderFrame(): string[] {
    const { width, height } = this.screen.getDimensions();
    const state = this.store.getState();
    const frame = composeLayoutFrame({ state, width, height, activeTab: this.activeTab, layout: this.layoutConfig });
    this.lastFrame = frame;
    // A layout change can hide the focused pane (e.g. files under the console layout):
    // hand focus back to the prompt after this paint, never during it.
    if (!frame.panes[state.focus]) {
      queueMicrotask(() => {
        if (this.lastFrame && !this.lastFrame.panes[this.store.getState().focus]) this.store.setFocus('input');
      });
    }
    return frame.lines;
  }

  // ── Keyboard & Mouse Event Dispatchers ──

  /**
   * Modal opener of each tab that owns one. Tabs that merely switch the main
   * view are absent here: `activateTab` handles them without a lookup.
   */
  private tabOpeners(): Record<string, () => void> {
    return {
      personas: () => PersonaModals.openPersonaModal(this.store, this.configManager, () => { this.agent = this.recreateAgent(); }, () => this.syncInitialState()),
      teams: () => PersonaModals.openTeamModal(this.store),
      memory: () => SystemModals.openMemoryModal(this.store),
      models: () => { SystemModals.openModelModal(this.store, this.provider, this.configManager, () => { this.agent = this.recreateAgent(); }, () => this.syncInitialState(), () => this.probeContextWindow()); },
      layout: () => LayoutModals.openLayoutModal(this.store, this.layoutConfig),
      help: () => SystemModals.openHelpModal(this.store, (cmd: string) => this.commandController.handleCommand(cmd)),
    };
  }

  /**
   * Single entry point for the navigation, shared by function keys and by
   * clicks on the header tabs.
   */
  private activateTab(spec: TuiTabSpec, fromKeyboard: boolean = false): void {
    const state = this.store.getState();

    if (spec.modalTitle) {
      // A tab owning a modal toggles it: its key closes what it opened.
      if (state.activeModal?.title?.includes(spec.modalTitle)) this.store.closeModal();
      else this.tabOpeners()[spec.id]?.();
      return;
    }

    if (state.activeModal) this.store.closeModal();
    // F2 toggles back to the chat, while clicking a tab always selects it.
    const showTools = spec.id === 'tools' && !(fromKeyboard && this.activeTab === 'tools');
    this.activeTab = showTools ? 'tools' : 'chat';
    this.store.notify(`Active tab: ${showTools ? 'Tools Inspector' : 'Chat Feed'}`, 'info');
  }

  private handleKeyPress(key: KeyPressEvent): void {
    const state = this.store.getState();

    if (key.ctrl && key.name === 'c') {
      void this.stop().finally(() => process.exit(0));
      return;
    }

    // Navigation: F1..F7 and F12 come from the tab table, plus '?' where it cannot be a
    // typed character (T14.10). Ctrl+T is deliberately not a tab alias: it belongs to the
    // reasoning toggle below, which is the binding the chat advertises (T18.5).
    const tab = resolveTabShortcut(key, state.focus, !!state.activeModal);
    if (tab) {
      this.activateTab(tab, true);
      return;
    }

    if (key.name === 'escape' || (key.ctrl && key.name === 'x')) {
      // During processing Escape always means "request interruption". If another
      // modal owns the screen, cancel it first so its pending promise is resolved.
      if (state.isGenerating && state.activeModal?.type !== 'confirm') {
        this.store.closeModal();
        this.turnRunner.interrupt();
        return;
      }
      if (state.activeModal) {
        ModalKeyHandler.handleKey(key, state.activeModal, this.store);
        return;
      }
      this.turnRunner.interrupt();
      return;
    }

    if (state.activeModal) {
      ModalKeyHandler.handleKey(key, state.activeModal, this.store);
      return;
    }

    if (key.ctrl && key.name === 't') {
      const isExpanded = this.store.toggleThinkingExpansion();
      this.store.notify(`Reasoning trace: ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
      return;
    }

    // A paste is text, not a run of key presses: it lands in the prompt whatever pane
    // has focus, newlines included (T18.7).
    if (key.name === 'paste') {
      if (key.char) {
        this.store.setFocus('input');
        this.store.insertInputText(key.char);
      }
      return;
    }

    if (key.name === 'tab') {
      if (state.focus === 'input' && state.inputText) {
        const completion = completeTuiInput(state.inputText, state.inputCursor);
        if (completion.changed) {
          this.store.setInputText(completion.text, completion.cursor);
          return;
        }
        if (completion.candidates.length > 1) {
          this.store.notify(`Matches: ${completion.candidates.join(', ')}`, 'info');
          return;
        }
      }
      this.store.cycleFocus(this.lastFrame ? (Object.keys(this.lastFrame.panes) as TuiFocus[]) : undefined);
      return;
    }

    const deps = { store: this.store, submitPrompt: (prompt: string) => this.turnRunner.handleUserPrompt(prompt) };

    switch (state.focus) {
      case 'input': handleInputKey(deps, key); break;
      case 'chat': handleChatKey(deps, key); break;
      case 'sidebar': handleSidebarKey(deps, key); break;
      case 'files':
        handleFilesKey({ ...deps, browseTo: (cwd) => this.browseDirectory(cwd) }, key);
        break;
      case 'tools': handleToolsKey(deps, key); break;
    }
  }

  /** Files currently listed in the explorer panel. */
  private currentFiles(): TuiFileItem[] {
    return FilesView.visibleFiles(this.store.getState());
  }

  /**
   * Moves the explorer into another directory of the workspace (T14.12),
   * reloading the listing and putting the selection back at the top.
   */
  private browseDirectory(targetCwd: string): boolean {
    const current = this.store.getState().filesCwd || '';
    if (targetCwd === current) return false;

    // Only the path is stored: the listing is read at render time, so files
    // created or deleted while browsing show up without an explicit refresh.
    this.store.setState({
      filesCwd: targetCwd,
      workspaceFiles: [],
      selectedFileIndex: 0,
      filesScrollOffset: 0,
    });
    this.store.notify(`📁 ${targetCwd || 'workspace root'}`, 'info');
    return true;
  }

  private handleMouseEvent(mouse: TuiMouseEvent): void {
    routeMouseEvent(
      {
        store: this.store,
        getFrame: () => this.lastFrame,
        getActiveTab: () => this.activeTab,
        dimensions: () => this.screen.getDimensions(),
        currentFiles: () => this.currentFiles(),
        openFileEntry: (item) => openFileEntryAction(this.store, (cwd) => this.browseDirectory(cwd), item),
        activateTab: (spec) => this.activateTab(spec),
      },
      mouse
    );
  }
}
