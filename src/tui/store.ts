/**
 * Reactive State Store for TSUKA TUI.
 */

import { TuiState, TuiChatMessage, TuiToolExecution, TuiPermissionRequest, TuiModalState, TuiFocus, TuiSpawnedAgent } from './types';

export type StoreListener = (state: TuiState) => void;

export class TuiStore {
  private state: TuiState;
  private listeners: Set<StoreListener> = new Set();

  constructor(initialState?: Partial<TuiState>) {
    this.state = {
      activeCharacterName: 'tsuka',
      activeCharacterRole: 'developer',
      activeCharacterTrait: 'helpful',
      activeAiName: 'Tsuka',
      activeProvider: 'ollama',
      activeModel: 'llama3',
      activeSpawnedAgent: null,
      spawnedAgentsHistory: [],
      stats: {
        usedTokens: 0,
        subagentUsedTokens: 0,
        totalSessionTokens: 0,
        maxTokens: 8192,
        percentage: 0,
        turnCount: 0,
        toolCallsCount: 0,
      },
      messages: [],
      activeTools: [],
      activeModal: null,
      focus: 'input',
      inputText: '',
      inputCursor: 0,
      inputHistory: [],
      historyIndex: -1,
      chatScrollOffset: 0,
      sidebarScrollOffset: 0,
      filesScrollOffset: 0,
      selectedFileIndex: 0,
      toolsScrollOffset: 0,
      isGenerating: false,
      expandAllThinking: false,
      isRawModeLocked: false,
      workspaceFiles: [],
      notifications: [],
      ...initialState,
    };
  }

  getState(): TuiState {
    return this.state;
  }

  toggleThinkingExpansion(): boolean {
    const next = !this.state.expandAllThinking;
    this.setState({ expandAllThinking: next });
    return next;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifySubscribers(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        // Prevent subscriber errors from halting store
      }
    }
  }

  setState(partial: Partial<TuiState>): void {
    this.state = { ...this.state, ...partial };
    this.notifySubscribers();
  }

  // ── Focus & Input ──

  setFocus(focus: TuiFocus): void {
    this.setState({ focus });
  }

  cycleFocus(): void {
    const focusOrder: TuiFocus[] = ['input', 'chat', 'sidebar', 'files', 'tools'];
    const currentIndex = focusOrder.indexOf(this.state.focus);
    const nextIndex = (currentIndex + 1) % focusOrder.length;
    this.setFocus(focusOrder[nextIndex]);
  }

  setInputText(text: string, cursor?: number): void {
    this.setState({
      inputText: text,
      inputCursor: cursor !== undefined ? cursor : text.length,
    });
  }

  insertInputChar(char: string): void {
    const { inputText, inputCursor } = this.state;
    const newText = inputText.slice(0, inputCursor) + char + inputText.slice(inputCursor);
    this.setInputText(newText, inputCursor + char.length);
  }

  deleteInputCharBefore(): void {
    const { inputText, inputCursor } = this.state;
    if (inputCursor <= 0) return;
    const newText = inputText.slice(0, inputCursor - 1) + inputText.slice(inputCursor);
    this.setInputText(newText, inputCursor - 1);
  }

  deleteInputCharAfter(): void {
    const { inputText, inputCursor } = this.state;
    if (inputCursor >= inputText.length) return;
    const newText = inputText.slice(0, inputCursor) + inputText.slice(inputCursor + 1);
    this.setInputText(newText, inputCursor);
  }

  moveInputCursor(delta: number): void {
    const { inputText, inputCursor } = this.state;
    const next = Math.max(0, Math.min(inputText.length, inputCursor + delta));
    this.setState({ inputCursor: next });
  }

  commitInput(): string {
    const trimmed = this.state.inputText.trim();
    if (trimmed) {
      const history = [...this.state.inputHistory, trimmed];
      this.setState({
        inputText: '',
        inputCursor: 0,
        inputHistory: history,
        historyIndex: -1,
      });
    } else {
      this.setState({ inputText: '', inputCursor: 0 });
    }
    return trimmed;
  }

  navigateHistory(direction: 'up' | 'down'): void {
    const { inputHistory, historyIndex, inputText } = this.state;
    if (inputHistory.length === 0) return;

    if (direction === 'up') {
      const nextIndex = historyIndex === -1 ? inputHistory.length - 1 : Math.max(0, historyIndex - 1);
      this.setState({
        historyIndex: nextIndex,
        inputText: inputHistory[nextIndex],
        inputCursor: inputHistory[nextIndex].length,
      });
    } else {
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= inputHistory.length) {
        this.setState({
          historyIndex: -1,
          inputText: '',
          inputCursor: 0,
        });
      } else {
        this.setState({
          historyIndex: nextIndex,
          inputText: inputHistory[nextIndex],
          inputCursor: inputHistory[nextIndex].length,
        });
      }
    }
  }

  // ── Messages & Streaming ──

  addMessage(msg: Omit<TuiChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: Date }): string {
    const id = msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const fullMsg: TuiChatMessage = {
      id,
      timestamp: msg.timestamp || new Date(),
      role: msg.role,
      authorName: msg.authorName,
      content: msg.content,
      isStreaming: msg.isStreaming,
      thinkingContent: msg.thinkingContent,
      thinkingTokens: msg.thinkingTokens || (msg.thinkingContent ? Math.max(1, Math.round(msg.thinkingContent.length / 3.8)) : 0),
      isThinkingExpanded: msg.isThinkingExpanded,
      isQueued: msg.isQueued,
      queuePosition: msg.queuePosition,
      toolCalls: msg.toolCalls || [],
    };
    this.setState({
      messages: [...this.state.messages, fullMsg],
      chatScrollOffset: 0, // Auto-scroll to bottom
    });
    return id;
  }

  updateMessage(id: string, partial: Partial<TuiChatMessage>): void {
    const messages = this.state.messages.map((m) => (m.id === id ? { ...m, ...partial } : m));
    this.setState({ messages });
  }

  toggleMessageThinking(id: string): boolean {
    const msg = this.state.messages.find((m) => m.id === id);
    if (!msg) return false;
    const current = msg.isThinkingExpanded !== undefined ? msg.isThinkingExpanded : !!this.state.expandAllThinking;
    const next = !current;
    this.updateMessage(id, { isThinkingExpanded: next });
    return next;
  }

  appendStreamingChunk(id: string, chunk: string, isThinking: boolean = false): void {
    const msg = this.state.messages.find((m) => m.id === id);
    if (!msg) return;

    if (isThinking) {
      const thinking = (msg.thinkingContent || '') + chunk;
      const tokens = (msg.thinkingTokens || 0) + Math.max(1, Math.round(chunk.length / 3.8));
      this.updateMessage(id, { thinkingContent: thinking, thinkingTokens: tokens, isStreaming: true });
    } else {
      const content = (msg.content || '') + chunk;
      this.updateMessage(id, { content, isStreaming: true });
    }
  }

  finishStreaming(id: string): void {
    this.updateMessage(id, { isStreaming: false });
  }

  // ── Tool Executions ──

  startTool(name: string, args: string, riskLevel?: any): string {
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const toolExec: TuiToolExecution = {
      id,
      name,
      args,
      status: 'running',
      startedAt: Date.now(),
      riskLevel,
    };
    this.setState({
      activeTools: [toolExec, ...this.state.activeTools].slice(0, 50),
      stats: {
        ...this.state.stats,
        toolCallsCount: this.state.stats.toolCallsCount + 1,
      },
    });
    return id;
  }

  finishTool(id: string, output: string, success: boolean): void {
    const activeTools = this.state.activeTools.map((t) =>
      t.id === id
        ? {
            ...t,
            output,
            status: success ? ('completed' as const) : ('failed' as const),
            completedAt: Date.now(),
          }
        : t
    );
    this.setState({ activeTools });
  }

  // ── Stats & Context ──

  updateStats(stats: Partial<TuiState['stats']>): void {
    this.setState({
      stats: { ...this.state.stats, ...stats },
    });
  }

  // ── Spawned Subagents ──

  setSpawnedAgent(agent: TuiSpawnedAgent | null): void {
    if (agent) {
      const history = this.state.spawnedAgentsHistory.filter((a) => a.id !== agent.id);
      this.setState({
        activeSpawnedAgent: agent,
        spawnedAgentsHistory: [agent, ...history].slice(0, 50),
      });
    } else {
      this.setState({ activeSpawnedAgent: null });
    }
  }

  updateSpawnedAgent(partial: Partial<TuiSpawnedAgent>): void {
    if (!this.state.activeSpawnedAgent) return;
    const updated = { ...this.state.activeSpawnedAgent, ...partial };
    const history = this.state.spawnedAgentsHistory.map((a) => (a.id === updated.id ? updated : a));
    this.setState({
      activeSpawnedAgent: updated,
      spawnedAgentsHistory: history,
    });
  }

  // ── Modals & Permissions ──

  showModal(modal: TuiModalState): void {
    this.setState({ activeModal: modal });
  }

  closeModal(): void {
    const modal = this.state.activeModal;
    this.setState({ activeModal: null });
    if (modal?.onCancel) {
      modal.onCancel();
    }
  }

  // ── Notifications ──

  notify(text: string, type: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    const notif = {
      id: `notif_${Date.now()}`,
      text,
      type,
      timestamp: Date.now(),
    };
    this.setState({
      notifications: [notif, ...this.state.notifications].slice(0, 5),
    });
    setTimeout(() => {
      this.setState({
        notifications: this.state.notifications.filter((n) => n.id !== notif.id),
      });
    }, 4000);
  }

  // ── Scrolling ──

  scroll(target: 'chat' | 'sidebar' | 'files' | 'tools', delta: number): void {
    if (target === 'chat') {
      const next = Math.max(0, this.state.chatScrollOffset + delta);
      this.setState({ chatScrollOffset: next });
    } else if (target === 'sidebar') {
      const next = Math.max(0, this.state.sidebarScrollOffset + delta);
      this.setState({ sidebarScrollOffset: next });
    } else if (target === 'files') {
      const next = Math.max(0, this.state.filesScrollOffset + delta);
      this.setState({ filesScrollOffset: next });
    } else if (target === 'tools') {
      const next = Math.max(0, this.state.toolsScrollOffset + delta);
      this.setState({ toolsScrollOffset: next });
    }
  }
}
