import { TuiStore } from '../store';
import { TuiBridge } from '../bridge';
import { Agent } from '../../core/agent';
import { GenerationInterrupt } from '../../cli/interrupt';
import { logSink } from '../../core/logSink';
import { TuiCommandController } from './commandController';

export interface TurnRunnerContext {
  store: TuiStore;
  bridge: TuiBridge;
  getAgent: () => Agent;
  commandController: TuiCommandController;
}

interface QueuedPromptItem {
  prompt: string;
  msgId?: string;
}

export class TuiTurnRunner {
  private currentInterrupt?: GenerationInterrupt;
  private promptQueue: QueuedPromptItem[] = [];
  private isProcessing: boolean = false;

  constructor(private ctx: TurnRunnerContext) {}

  async handleUserPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // If already processing a turn, add message with [IN QUEUE] badge to chat immediately and queue
    if (this.isProcessing) {
      const position = this.promptQueue.length + 1;
      let msgId: string | undefined;
      if (!trimmed.startsWith('/')) {
        msgId = this.ctx.store.addMessage({
          role: 'user',
          content: trimmed,
          isQueued: true,
          queuePosition: position,
        });
      }
      this.promptQueue.push({ prompt: trimmed, msgId });
      this.ctx.store.notify(`⏳ Prompt #${position} queued. Will execute when active turn finishes.`, 'info');
      return;
    }

    this.isProcessing = true;
    await this.executeTurn({ prompt: trimmed });
  }

  private async executeTurn(item: QueuedPromptItem): Promise<void> {
    const { prompt, msgId } = item;
    const { store, bridge } = this.ctx;

    // 1. Slash command routing
    if (prompt.startsWith('/')) {
      try {
        await this.ctx.commandController.handleCommand(prompt);
      } finally {
        this.processNextInQueue();
      }
      return;
    }

    bridge.resetCurrentTurn();

    // 2. Transition queued message to active, or create new user message if direct
    if (msgId) {
      store.updateMessage(msgId, { isQueued: false });
    } else {
      store.addMessage({
        role: 'user',
        content: prompt,
      });
    }

    const state = store.getState();
    const isNoEffort = state.activeReasoningEffort === 'none';

    store.setState({
      isGenerating: true,
      generationStatus: {
        phase: isNoEffort ? 'streaming' : 'reasoning',
        agentName: state.activeAiName,
      },
      stats: {
        ...state.stats,
        subagentUsedTokens: 0,
        turnCount: state.stats.turnCount + 1,
      },
    });

    this.currentInterrupt = new GenerationInterrupt();
    bridge.notifyTurnStart(state.stats.usedTokens);

    try {
      const onChunk = bridge.createChunkHandler();
      const onStats = bridge.createStatsHandler();
      const onEvent = bridge.createEventHandler();

      const agent = this.ctx.getAgent();
      await agent.run(
        prompt,
        onChunk,
        onStats,
        onEvent,
        this.currentInterrupt.signal
      );
    } catch (err: any) {
      logSink.error(`[TurnRunner] Error during execution: ${err.message}${err.stack ? '\n' + err.stack : ''}`);
      store.addMessage({
        role: 'system',
        content: `Error during execution: ${err.message}`,
      });
    } finally {
      bridge.resetCurrentTurn();
      store.setState({
        isGenerating: false,
        generationStatus: { phase: 'idle' },
      });
      this.currentInterrupt = undefined;
      this.processNextInQueue();
    }
  }

  private processNextInQueue(): void {
    if (this.promptQueue.length > 0) {
      const next = this.promptQueue.shift()!;
      setTimeout(() => {
        this.executeTurn(next).catch(() => {});
      }, 50);
    } else {
      this.isProcessing = false;
    }
  }

  interrupt(): void {
    const { store, bridge } = this.ctx;
    const state = store.getState();

    // Cancel queued prompts on user interrupt and update chat messages
    if (this.promptQueue.length > 0) {
      const count = this.promptQueue.length;
      for (const q of this.promptQueue) {
        if (q.msgId) {
          store.updateMessage(q.msgId, {
            isQueued: false,
            content: q.prompt + '\n\n*(Canceled by user stop)*',
          });
        }
      }
      this.promptQueue = [];
      store.notify(`Canceled ${count} queued prompt(s)`, 'warn');
    }

    if (this.isProcessing && this.currentInterrupt) {
      this.currentInterrupt.abort();
      store.notify('Generation interrupted by user', 'warn');
      bridge.resetCurrentTurn();
      store.finishStreaming(state.messages[state.messages.length - 1]?.id || '');
      this.isProcessing = false;
    }
  }
}
