import { TuiStore } from '../store';
import { TuiBridge } from '../bridge';
import { Agent } from '../../core/agent';
import { GenerationInterrupt } from '../../cli/interrupt';
import { TuiCommandController } from './commandController';

export interface TurnRunnerContext {
  store: TuiStore;
  bridge: TuiBridge;
  getAgent: () => Agent;
  commandController: TuiCommandController;
}

export class TuiTurnRunner {
  private currentInterrupt?: GenerationInterrupt;

  constructor(private ctx: TurnRunnerContext) {}

  async handleUserPrompt(prompt: string): Promise<void> {
    // 1. Slash command routing
    if (prompt.startsWith('/')) {
      await this.ctx.commandController.handleCommand(prompt);
      return;
    }

    const { store, bridge } = this.ctx;

    // 2. Add user message
    store.addMessage({
      role: 'user',
      content: prompt,
    });

    store.setState({
      isGenerating: true,
      stats: {
        ...store.getState().stats,
        turnCount: store.getState().stats.turnCount + 1,
      },
    });

    this.currentInterrupt = new GenerationInterrupt();

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
      store.addMessage({
        role: 'system',
        content: `Error during execution: ${err.message}`,
      });
    } finally {
      bridge.resetCurrentTurn();
      store.setState({ isGenerating: false });
      this.currentInterrupt = undefined;
    }
  }

  interrupt(): void {
    const { store } = this.ctx;
    const state = store.getState();

    if (state.isGenerating && this.currentInterrupt) {
      this.currentInterrupt.abort();
      store.notify('Generation interrupted by user', 'warn');
      store.finishStreaming(state.messages[state.messages.length - 1]?.id || '');
    }
  }
}
