/**
 * Main Application Orchestrator for TSUKA TUI.
 * Composes double-buffered terminal layout, input event routing, controllers and views.
 */

import { TuiScreen, KeyPressEvent, TuiMouseEvent } from './screen';
import { TuiTabSpec, tabAtColumn, resolveTabShortcut } from './navigation';
import { listDirectory, enterDirectory, parentDirectory, entryPath, PARENT_ENTRY } from './fileExplorer';
import { TuiFileItem } from './types';
import { TuiStore } from './store';
import { TuiBridge } from './bridge';
import { HeaderView } from './views/Header';
import { SidebarView } from './views/Sidebar';
import { ChatView } from './views/Chat';
import { InputView } from './views/Input';
import { ToolsView } from './views/Tools';
import { FilesView } from './views/Files';
import { ModalView } from './views/Modal';
import { Agent, ToolRoundsAction } from '../core/agent';
import { resolveToolSet } from '../core/toolSet';
import { ConfigManager } from '../core/config';
import { ILLMProvider, setTimeoutPromptHandler, TimeoutAction } from '../core/provider';
import { ToolRegistry } from '../tools/registry';
import { PermissionManager } from '../safety/permissions';
import { loadCharacter, loadRole, loadTrait, loadSystemPrompt } from '../cli/shared';
import { resolveReasoningEffort } from '../core/agent';
import { withEffortPin, describeEffortSource } from '../core/effortControl';
import { detectContextWindow, probeProvider } from '../core/discovery';
import { LayoutConfigManager, TuiLayoutConfig } from './layoutConfig';
import { ModalKeyHandler, PersonaModals, SystemModals, LayoutModals, FileViewerModal } from './modals';
import { TuiCommandController, TuiTurnRunner } from './controllers';
import { setLogSink, resetLogSink } from '../core/logSink';
import { setProgressSink } from '../core/progressSink';
import { copyToClipboard } from '../core/platform';

export interface TuiAppOptions {
  configManager: ConfigManager;
  provider: ILLMProvider;
  registry: ToolRegistry;
  permissionManager: PermissionManager;
}

export class TuiApp {
  private screen: TuiScreen;
  private store: TuiStore;
  private bridge: TuiBridge;
  private configManager: ConfigManager;
  private provider: ILLMProvider;
  private registry: ToolRegistry;
  private permissionManager: PermissionManager;
  private agent: Agent;
  private activeTab: 'chat' | 'tools' = 'chat';
  private layoutConfig: TuiLayoutConfig;
  private commandController: TuiCommandController;
  private turnRunner: TuiTurnRunner;

  constructor(options: TuiAppOptions) {
    this.configManager = options.configManager;
    this.provider = options.provider;
    this.registry = options.registry;
    this.permissionManager = options.permissionManager;
    this.layoutConfig = LayoutConfigManager.load();

    this.screen = new TuiScreen();
    this.store = new TuiStore();
    this.bridge = new TuiBridge(this.store, this.permissionManager);

    this.setupTimeoutPrompt();
    this.agent = this.recreateAgent();

    this.commandController = new TuiCommandController({
      store: this.store,
      configManager: this.configManager,
      provider: this.provider,
      registry: this.registry,
      permissionManager: this.permissionManager,
      layoutConfig: this.layoutConfig,
      getAgent: () => this.agent,
      setAgent: (a) => { this.agent = a; },
      recreateAgent: () => this.recreateAgent(),
      syncState: () => this.syncInitialState(),
      probeContextWindow: () => this.probeContextWindow(),
      setActiveTab: (t) => { this.activeTab = t; },
      getTurnRunner: () => this.turnRunner,
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
      loadSystemPrompt(role, trait, model, this.registry, char, undefined, reasoningEffort),
      toolSet.active,
      this.configManager.getMaxHistoryMessages(),
      this.configManager.getMaxHistoryTokens(),
      undefined,
      reasoningEffort,
      undefined,
      this.configManager.getMaxToolRounds()
    );
    a.setDeferredTools(toolSet.deferred);

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

  stop(): void {
    delete process.env.TSUKA_TUI;
    this.screen.stop();
    resetLogSink();
    setProgressSink(null);
  }

  /**
   * Startup autodiscovery: what the CLI already does on `/provider` and `/models` (probeProvider,
   * see cli/commands/provider.ts) but unattended, run once when the TUI opens. tsuka.config.json
   * records a model name, but the server behind it can drift — restarted with a different model,
   * or the configured one no longer served — and nothing short of manually running `/provider`
   * used to notice. This reconciles config against what the server actually reports:
   *  - configured model missing from the server's list → fall back to the first one available
   *    (same auto-recovery `handleProvider` performs after a manual switch) and warn;
   *  - a different model is loaded in RAM → warn only, since forcing a swap would reload the
   *    server (same reasoning as `maybeWarmUp`'s opt-in prompt in the CLI);
   *  - either way, calibrate the context window from the same scan instead of a second round trip.
   * Silent on an unreachable server — `probeProvider` returning null just means "nothing to do".
   */
  async discoverModelAtStartup(): Promise<void> {
    try {
      const providerName = this.configManager.getActiveProviderName();
      const activeConfig = this.configManager.getActiveProviderConfig();
      const apiKey = this.configManager.getApiKey();
      const configuredModel = this.provider.getCurrentModel();

      const scan = await probeProvider(providerName, activeConfig, apiKey);
      if (!scan) return;

      if (scan.models.length > 0 && !scan.models.includes(configuredModel)) {
        const fallback = scan.models[0];
        this.provider.setCurrentModel(fallback);
        this.configManager.updateActiveModel(fallback);
        this.agent = this.recreateAgent();
        this.store.notify(`Model '${configuredModel}' not found on server — switched to '${fallback}'`, 'warn');
      } else if (scan.loadedModel && scan.loadedModel !== configuredModel) {
        this.store.notify(`Server has '${scan.loadedModel}' loaded in RAM (config expects '${configuredModel}')`, 'warn');
      }

      const dynamicCtx = scan.contextWindow;
      if (dynamicCtx && dynamicCtx >= 1024) {
        this.configManager.setRuntimeContextTokens(dynamicCtx);
        const usedTokens = this.store.getState().stats.usedTokens;
        this.store.updateStats({
          maxTokens: dynamicCtx,
          percentage: Math.min(100, Math.round((usedTokens / dynamicCtx) * 100)),
        });
        this.agent = this.recreateAgent();
        this.store.notify(`Context window calibrated: ${dynamicCtx.toLocaleString()} tokens (${this.provider.getCurrentModel()})`, 'info');
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
        this.configManager.setRuntimeContextTokens(dynamicCtx);
        const usedTokens = this.store.getState().stats.usedTokens;
        this.store.updateStats({
          maxTokens: dynamicCtx,
          percentage: Math.min(100, Math.round((usedTokens / dynamicCtx) * 100)),
        });
        this.agent = this.recreateAgent();
        this.store.notify(`Context window calibrated: ${dynamicCtx.toLocaleString()} tokens (${currentModel})`, 'info');
      }
    } catch {}
  }

  // ── Layout Frame Rendering ──

  private renderFrame(): string[] {
    const { width, height } = this.screen.getDimensions();
    const state = this.store.getState();
    const effectiveWidth = Math.max(20, width - 1);

    const headerLines = HeaderView.render(state, effectiveWidth, this.activeTab);
    const headerHeight = headerLines.length;
    const rawLineCount = state.inputText ? state.inputText.split(/\r?\n/).length : 1;
    const inputHeight = Math.min(6, Math.max(3, rawLineCount + 2));
    const mainHeight = Math.max(5, height - headerHeight - inputHeight);

    const layout = this.layoutConfig;
    const sidebarPos = layout.sidebarPosition;
    const showFiles = layout.showFilesExplorer;
    const widthPct = (layout.sidebarWidthPercent || 26) / 100;
    const filesPct = (layout.filesHeightPercent || 55) / 100;

    let sidebarWidth = 0;
    let mainWidth = effectiveWidth;

    if (sidebarPos !== 'hidden') {
      sidebarWidth = Math.min(42, Math.max(22, Math.floor(effectiveWidth * widthPct)));
      mainWidth = Math.max(10, effectiveWidth - sidebarWidth);
    }

    let sidebarColumnLines: string[] = [];
    if (sidebarPos !== 'hidden') {
      if (showFiles) {
        const filesHeight = Math.max(5, Math.floor(mainHeight * filesPct));
        const profileHeight = Math.max(6, mainHeight - filesHeight);
        const profileLines = SidebarView.render(state, sidebarWidth, profileHeight, layout.visibleWidgets);
        const filesLines = FilesView.render(state, sidebarWidth, filesHeight);
        sidebarColumnLines = [...profileLines, ...filesLines];
      } else {
        sidebarColumnLines = SidebarView.render(state, sidebarWidth, mainHeight, layout.visibleWidgets);
      }
    }

    const mainLines = this.activeTab === 'chat'
      ? ChatView.render(state, mainWidth, mainHeight)
      : ToolsView.render(state, mainWidth, mainHeight);

    const compositeBody: string[] = [];
    for (let i = 0; i < mainHeight; i++) {
      if (sidebarPos === 'hidden') {
        compositeBody.push(mainLines[i] || ' '.repeat(mainWidth));
      } else if (sidebarPos === 'right') {
        const mainPart = mainLines[i] || ' '.repeat(mainWidth);
        const sidePart = sidebarColumnLines[i] || ' '.repeat(sidebarWidth);
        compositeBody.push(mainPart + sidePart);
      } else {
        const sidePart = sidebarColumnLines[i] || ' '.repeat(sidebarWidth);
        const mainPart = mainLines[i] || ' '.repeat(mainWidth);
        compositeBody.push(sidePart + mainPart);
      }
    }

    const inputLines = InputView.render(state, effectiveWidth, inputHeight);
    let screenBuffer = [...headerLines, ...compositeBody, ...inputLines];

    if (state.activeModal) {
      screenBuffer = ModalView.renderOverlay(state.activeModal, screenBuffer, effectiveWidth, height);
    }

    return screenBuffer;
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
      this.stop();
      process.exit(0);
    }

    // Navigation: F1..F7 and F12 come from the tab table, plus '?' where it cannot be a
    // typed character (T14.10). Ctrl+T is deliberately not a tab alias: it belongs to the
    // reasoning toggle below, which is the binding the chat advertises (T18.5).
    const tab = resolveTabShortcut(key, state.focus, !!state.activeModal);
    if (tab) {
      this.activateTab(tab, true);
      return;
    }

    if (state.activeModal) {
      ModalKeyHandler.handleKey(key, state.activeModal, this.store);
      return;
    }

    if (key.name === 'escape' || (key.ctrl && key.name === 'x')) {
      this.turnRunner.interrupt();
      return;
    }

    if (key.ctrl && key.name === 't') {
      const isExpanded = this.store.toggleThinkingExpansion();
      this.store.notify(`Reasoning trace: ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
      return;
    }

    if (key.name === 'tab') {
      this.store.cycleFocus();
      return;
    }

    switch (state.focus) {
      case 'input': this.handleInputKey(key); break;
      case 'chat': this.handleChatKey(key); break;
      case 'sidebar': this.handleSidebarKey(key); break;
      case 'files': this.handleFilesKey(key); break;
      case 'tools': this.handleToolsKey(key); break;
    }
  }

  private handleInputKey(key: KeyPressEvent): void {
    if (key.name === 'linefeed' || (key.name === 'return' && (key.shift || key.meta || key.ctrl))) {
      this.store.insertInputChar('\n');
      return;
    }
    if (key.name === 'return') {
      const prompt = this.store.commitInput();
      if (prompt) this.turnRunner.handleUserPrompt(prompt);
      return;
    }
    if (key.name === 'backspace') { this.store.deleteInputCharBefore(); return; }
    if (key.name === 'delete') { this.store.deleteInputCharAfter(); return; }
    if (key.name === 'left') { this.store.moveInputCursor(-1); return; }
    if (key.name === 'right') { this.store.moveInputCursor(1); return; }
    if (key.name === 'up') { this.store.navigateHistory('up'); return; }
    if (key.name === 'down') { this.store.navigateHistory('down'); return; }
    if (key.char && !key.ctrl && !key.meta) this.store.insertInputChar(key.char);
  }

  private handleChatKey(key: KeyPressEvent): void {
    if (key.name === 'up') this.store.scroll('chat', 2);
    else if (key.name === 'down') this.store.scroll('chat', -2);
    else if (key.name === 'pageup') this.store.scroll('chat', 10);
    else if (key.name === 'pagedown') this.store.scroll('chat', -10);
    else if (key.name === 'c' || key.name === 'y') {
      const state = this.store.getState();
      const lastAssistantMsg = [...state.messages].reverse().find((m) => m.role === 'assistant' && m.content);
      if (lastAssistantMsg) {
        const ok = copyToClipboard(lastAssistantMsg.content);
        if (ok) this.store.notify('Copied last response to clipboard!', 'success');
        else this.store.notify('Clipboard copy failed', 'error');
      } else {
        this.store.notify('No message content to copy', 'warn');
      }
    } else if (key.name === 't' || key.name === 'return' || key.name === 'space') {
      const state = this.store.getState();
      const lastWithThinking = [...state.messages].reverse().find((m) => m.thinkingContent);
      if (lastWithThinking) {
        const isExpanded = this.store.toggleMessageThinking(lastWithThinking.id);
        this.store.notify(`Reasoning (${lastWithThinking.authorName || 'Tsuka'}): ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
      } else {
        const isExpanded = this.store.toggleThinkingExpansion();
        this.store.notify(`Reasoning traces: ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
      }
    }
  }

  private handleSidebarKey(key: KeyPressEvent): void {
    if (key.name === 'up') this.store.scroll('sidebar', -1);
    else if (key.name === 'down') this.store.scroll('sidebar', 1);
  }

  private handleToolsKey(key: KeyPressEvent): void {
    if (key.name === 'up') this.store.scroll('tools', -2);
    else if (key.name === 'down') this.store.scroll('tools', 2);
    else if (key.name === 'pageup') this.store.scroll('tools', -10);
    else if (key.name === 'pagedown') this.store.scroll('tools', 10);
    else if (key.name === 'escape') {
      const current = this.store.getState().toolsFilter;
      if (current) {
        this.store.setState({ toolsFilter: '' });
      } else {
        this.store.setFocus('input');
      }
    } else if (key.name === 'backspace') {
      const current = this.store.getState().toolsFilter || '';
      this.store.setState({ toolsFilter: current.slice(0, -1), toolsScrollOffset: 0 });
    } else if (key.char && !key.ctrl && !key.meta) {
      const current = this.store.getState().toolsFilter || '';
      this.store.setState({ toolsFilter: current + key.char, toolsScrollOffset: 0 });
    }
  }

  /** Files currently listed in the explorer panel. */
  private currentFiles(): TuiFileItem[] {
    const state = this.store.getState();
    return state.workspaceFiles.length > 0 ? state.workspaceFiles : listDirectory(state.filesCwd || '');
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

  /** Enter on a directory browses it; on a file it opens the preview. */
  private openFileEntry(item: TuiFileItem): void {
    const state = this.store.getState();
    if (item.isDir) {
      this.browseDirectory(enterDirectory(state.filesCwd || '', item.name));
      return;
    }
    FileViewerModal.openFileModal(this.store, entryPath(state.filesCwd || '', item.name));
  }

  private handleFilesKey(key: KeyPressEvent): void {
    const state = this.store.getState();
    const files = this.currentFiles();

    // Left works even on an empty folder: it is the way back out of it.
    if (key.name === 'left') {
      if (!this.browseDirectory(parentDirectory(state.filesCwd || ''))) {
        this.store.notify('Already at the workspace root', 'info');
      }
      return;
    }
    if (files.length === 0) return;

    const selected = files[state.selectedFileIndex];

    if (key.name === 'up') {
      const next = Math.max(0, state.selectedFileIndex - 1);
      const scroll = next < state.filesScrollOffset ? next : state.filesScrollOffset;
      this.store.setState({ selectedFileIndex: next, filesScrollOffset: scroll });
    } else if (key.name === 'down') {
      const next = Math.min(files.length - 1, state.selectedFileIndex + 1);
      const innerHeight = 6;
      const scroll = next >= state.filesScrollOffset + innerHeight ? next - innerHeight + 1 : state.filesScrollOffset;
      this.store.setState({ selectedFileIndex: next, filesScrollOffset: scroll });
    } else if (key.name === 'right') {
      // Right only descends: on a file there is nothing to enter.
      if (selected?.isDir) this.browseDirectory(enterDirectory(state.filesCwd || '', selected.name));
    } else if (key.name === 'return') {
      if (selected) this.openFileEntry(selected);
    } else if (key.name === 'i' || key.name === 'space') {
      if (selected && selected.name !== PARENT_ENTRY) {
        const insertPath = entryPath(state.filesCwd || '', selected.name);
        const currentInput = this.store.getState().inputText;
        this.store.setInputText((currentInput ? currentInput + ' ' : '') + insertPath);
        this.store.setFocus('input');
        this.store.notify(`Inserted '${insertPath}' into input prompt`, 'info');
      }
    } else if (key.name === 'escape') {
      this.store.setFocus('input');
    }
  }

  private handleMouseEvent(mouse: TuiMouseEvent): void {
    const state = this.store.getState();
    const { width, height } = this.screen.getDimensions();
    const effectiveWidth = Math.max(20, width - 1);
    const headerHeight = 3;
    const inputHeight = 3;
    const mainHeight = Math.max(5, height - headerHeight - inputHeight);

    const layout = this.layoutConfig;
    const sidebarPos = layout.sidebarPosition;
    const showFiles = layout.showFilesExplorer;
    const widthPct = (layout.sidebarWidthPercent || 26) / 100;
    const filesPct = (layout.filesHeightPercent || 55) / 100;

    let sidebarWidth = 0;
    if (sidebarPos !== 'hidden') {
      sidebarWidth = Math.min(42, Math.max(22, Math.floor(effectiveWidth * widthPct)));
    }

    const filesHeight = showFiles ? Math.max(5, Math.floor(mainHeight * filesPct)) : 0;
    const profileHeight = Math.max(6, mainHeight - filesHeight);

    // 1. Mouse Wheel Scrolling
    if (mouse.button === 'wheelup') {
      const inSidebar = (sidebarPos === 'left' && mouse.col <= sidebarWidth) ||
                        (sidebarPos === 'right' && mouse.col >= effectiveWidth - sidebarWidth);
      if (inSidebar) {
        if (showFiles && mouse.row > headerHeight + profileHeight) this.store.scroll('files', -2);
        else this.store.scroll('sidebar', -2);
      } else {
        if (this.activeTab === 'chat') this.store.scroll('chat', 3);
        else this.store.scroll('tools', -3);
      }
      return;
    }
    if (mouse.button === 'wheeldown') {
      const inSidebar = (sidebarPos === 'left' && mouse.col <= sidebarWidth) ||
                        (sidebarPos === 'right' && mouse.col >= effectiveWidth - sidebarWidth);
      if (inSidebar) {
        if (showFiles && mouse.row > headerHeight + profileHeight) this.store.scroll('files', 2);
        else this.store.scroll('sidebar', 2);
      } else {
        if (this.activeTab === 'chat') this.store.scroll('chat', -3);
        else this.store.scroll('tools', 3);
      }
      return;
    }

    // 2. Left Click handling
    if (mouse.button === 'left' && (mouse.action === 'down' || mouse.action === 'move')) {
      if (state.activeModal) {
        if (mouse.action === 'down' && (mouse.row <= 2 || mouse.row >= height - 2)) this.store.closeModal();
        return;
      }

      // Top Header Click Tabs: zones are computed from the same table the header
      // draws, so a relabelled tab keeps a click zone that matches what is shown.
      if (mouse.row <= headerHeight) {
        if (mouse.action !== 'down') return;
        const clicked = tabAtColumn(effectiveWidth, this.activeTab, mouse.col);
        if (clicked) this.activateTab(clicked);
        return;
      }

      // Bottom Input Click
      if (mouse.row >= height - inputHeight) {
        this.store.setFocus('input');
        return;
      }

      // Middle Body Click
      const isSidebarClick = sidebarPos !== 'hidden' && (
        (sidebarPos === 'left' && mouse.col <= sidebarWidth) ||
        (sidebarPos === 'right' && mouse.col >= effectiveWidth - sidebarWidth)
      );

      if (isSidebarClick) {
        if (!showFiles || mouse.row <= headerHeight + profileHeight) {
          this.store.setFocus('sidebar');
        } else {
          this.store.setFocus('files');
          const files = this.currentFiles();
          const clickedRow = mouse.row - headerHeight - profileHeight - 1;
          const targetIndex = state.filesScrollOffset + clickedRow;
          if (targetIndex >= 0 && targetIndex < files.length) {
            const isAlreadySelected = state.selectedFileIndex === targetIndex;
            this.store.setState({ selectedFileIndex: targetIndex });
            const file = files[targetIndex];
            if (file) {
              // First click selects, second click acts: enter the directory or preview the file.
              if (isAlreadySelected) {
                this.openFileEntry(file);
              } else if (file.isDir) {
                this.store.notify(`Click again to open '${file.name}'`, 'info');
              } else {
                const insertPath = entryPath(state.filesCwd || '', file.name);
                const currentInput = this.store.getState().inputText;
                this.store.setInputText((currentInput ? currentInput + ' ' : '') + insertPath);
                this.store.notify(`Selected '${insertPath}' (Click again to preview)`, 'info');
              }
            }
          }
        }
      } else {
        this.store.setFocus(this.activeTab === 'chat' ? 'chat' : 'tools');
        if (mouse.col >= effectiveWidth - 2) {
          const trackY = Math.max(0, Math.min(mainHeight - 1, mouse.row - headerHeight - 1));
          const scrollRatio = 1 - (trackY / (mainHeight - 1));
          const totalMsgs = state.messages.length * 4;
          const targetOffset = Math.round(scrollRatio * Math.max(0, totalMsgs));
          this.store.setState({ chatScrollOffset: Math.max(0, targetOffset) });
        } else if (mouse.action === 'down' && this.activeTab === 'chat') {
          const chatWidth = effectiveWidth - sidebarWidth;
          const clickedRow = Math.max(0, mouse.row - headerHeight - 1);
          const thinkTarget = ChatView.getThinkingHeaderAtRow(state, chatWidth, mainHeight, clickedRow);
          if (thinkTarget) {
            const isExpanded = this.store.toggleMessageThinking(thinkTarget.id);
            this.store.notify(`Reasoning (${thinkTarget.authorName || 'Tsuka'}): ${isExpanded ? 'Expanded' : 'Collapsed'}`, 'info');
          }
        }
      }
    }
  }
}
