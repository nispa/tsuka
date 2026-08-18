/**
 * Event and Safety Bridge for TSUKA TUI.
 * Connects AgentEvents, PermissionManager, and logSink directly to TuiStore.
 */

import { TuiStore } from './store';
import { TuiChatMessage } from './types';
import { AgentEvent, AgentEventHandler } from '../core/agentEvents';
import { StreamChannel } from '../core/thinkParser';
import { PermissionManager, PermissionPromptRequest } from '../safety/permissions';
import { setLogSink } from '../core/logSink';
import { ChatStats, InferenceTelemetryEvent, setInferenceTelemetrySink } from '../core/provider';

export class TuiBridge {
  private store: TuiStore;
  private permissionManager: PermissionManager;
  private currentAssistantMsgId?: string;
  private currentToolExecMap: Map<string, string> = new Map();
  private lastTtftMs?: number;
  /** Prompt ingestion speed measured on the last completed turn. */
  private lastPrefillTokensPerSec?: number;

  constructor(store: TuiStore, permissionManager: PermissionManager) {
    this.store = store;
    this.permissionManager = permissionManager;
    this.setupPermissionHandler();
    this.setupLogSink();
    this.setupInferenceTelemetry();
  }

  /**
   * Before the response arrives the exact prompt size is unknown: the context
   * occupancy is shown as an explicit estimate and replaced by the real
   * usage.prompt_tokens once the turn completes.
   */
  notifyTurnStart(promptTokensEstimate?: number): void {
    this.store.setState({
      telemetry: {
        phase: 'prefill',
        prefillTokens: promptTokensEstimate,
        prefillTokensEstimated: promptTokensEstimate !== undefined,
        prefillTokensPerSec: this.lastPrefillTokensPerSec,
        lastUpdated: Date.now(),
      },
    });
  }

  /**
   * Subscribes to the real telemetry emitted by the provider streaming loop (T14.9):
   * TTFT, decode speed and — only when the backend exposes logprobs — token
   * confidence and top candidates. The bridge never computes these values itself.
   */
  private setupInferenceTelemetry(): void {
    setInferenceTelemetrySink((ev) => this.handleInferenceTelemetry(ev));
  }

  handleInferenceTelemetry(ev: InferenceTelemetryEvent): void {
    const current = this.store.getState().telemetry;

    if (ev.type === 'first_token') {
      this.lastTtftMs = ev.ttftMs;
      this.store.setState({
        telemetry: {
          ...current,
          phase: 'decoding',
          ttftMs: ev.ttftMs,
          lastUpdated: Date.now(),
        },
      });
      return;
    }

    if (ev.type === 'decode') {
      const tokensPerSec = ev.decodeMs > 0
        ? Math.round((ev.tokens / (ev.decodeMs / 1000)) * 10) / 10
        : undefined;
      this.store.setState({
        telemetry: {
          ...current,
          phase: 'decoding',
          ttftMs: this.lastTtftMs,
          decodedTokens: ev.tokens,
          tokensPerSec,
          confidence: ev.confidence,
          topCandidates: ev.topCandidates,
          lastUpdated: Date.now(),
        },
      });
    }
  }

  private setupPermissionHandler(): void {
    this.permissionManager.setPromptHandler((req: PermissionPromptRequest): Promise<'yes' | 'no' | 'always'> => {
      return new Promise<'yes' | 'no' | 'always'>((resolve) => {
        let isResolved = false;
        const doResolve = (decision: 'yes' | 'no' | 'always') => {
          if (isResolved) return;
          isResolved = true;
          this.store.closeModal();
          resolve(decision);
        };

        this.store.showModal({
          type: 'permission',
          title: req.riskLevel === 'DANGEROUS' ? '⚠️ CRITICAL AUTHORIZATION' : '🛡️ TOOL PERMISSION REQUIRED',
          selectedIndex: 0,
          permissionReq: {
            id: `perm_${Date.now()}`,
            toolName: req.toolName,
            details: req.details,
            riskLevel: req.riskLevel,
            requesterLabel: req.requesterLabel,
            resolve: doResolve,
          },
          options: [
            { label: '✔ Approve this execution (y)', value: 'yes' },
            { label: '✘ Deny this execution (n)', value: 'no' },
            { label: '★ Always approve for this session (a)', value: 'always' },
          ],
          onSelect: (val) => {
            doResolve(val as 'yes' | 'no' | 'always');
          },
          onCancel: () => {
            doResolve('no');
          },
        });
      });
    });
  }

  private setupLogSink(): void {
    setLogSink({
      log: (message: string) => {},
      warn: (message: string) => this.store.notify(message, 'warn'),
      error: (message: string) => this.store.notify(message, 'error'),
    });
  }

  /**
   * Creates a live streaming chunk handler for Agent.run().
   */
  createChunkHandler(): (chunk: string, channel?: StreamChannel, authorName?: string) => void {
    return (chunk: string, channel?: StreamChannel, authorName?: string) => {
      const isReasoning = channel === 'reasoning';
      const effectiveAuthor = authorName || this.store.getState().activeAiName;

      // Telemetry values come from the provider sink. Here we only leave the prefill
      // phase, so the LEDs stay right even with a provider that emits no telemetry.
      const telemetry = this.store.getState().telemetry;
      if (telemetry?.phase === 'prefill') {
        this.store.setState({
          telemetry: { ...telemetry, phase: 'decoding', lastUpdated: Date.now() },
        });
      }

      // If switching authors (e.g. subagent vs parent), or if switching from content to reasoning,
      // finalize previous message so the new reasoning / author block starts fresh.
      if (this.currentAssistantMsgId) {
        const state = this.store.getState();
        const currentMsg = state.messages.find((m) => m.id === this.currentAssistantMsgId);
        if (currentMsg && (currentMsg.authorName !== effectiveAuthor || (isReasoning && currentMsg.content && currentMsg.content.trim()))) {
          this.store.finishStreaming(this.currentAssistantMsgId);
          this.currentAssistantMsgId = undefined;
        }
      }

      if (!this.currentAssistantMsgId) {
        this.currentAssistantMsgId = this.store.addMessage({
          role: 'assistant',
          authorName: effectiveAuthor,
          content: !isReasoning ? chunk : '',
          thinkingContent: isReasoning ? chunk : '',
          isStreaming: true,
        });
      } else {
        this.store.appendStreamingChunk(this.currentAssistantMsgId, chunk, isReasoning);
      }

      const currentGen = this.store.getState().generationStatus;
      const nextPhase = isReasoning ? 'reasoning' : 'streaming';
      if (!currentGen || currentGen.phase !== nextPhase || currentGen.agentName !== effectiveAuthor) {
        this.store.setState({
          generationStatus: {
            phase: nextPhase,
            agentName: effectiveAuthor,
          },
        });
      }
    };
  }

  /**
   * Creates a live stats update handler for Agent.run().
   */
  createStatsHandler(): (stats: ChatStats, agentLabel?: string) => void {
    return (stats, agentLabel) => {
      const currentState = this.store.getState();
      const maxTokens = currentState.stats.maxTokens || 8192;
      const addedTokens = stats.tokenCount || stats.totalTokens || 0;
      const prevTotalSession = currentState.stats.totalSessionTokens || 0;
      const newTotalSession = prevTotalSession + addedTokens;

      if (stats.ttftMs !== undefined) this.lastTtftMs = stats.ttftMs;
      if (stats.prefillTokensPerSecond !== undefined) this.lastPrefillTokensPerSec = stats.prefillTokensPerSecond;

      // End of turn: figures become exact (usage from the backend). Confidence and
      // candidates belong to the token being generated, so they are cleared here.
      this.store.setState({
        telemetry: {
          phase: 'idle',
          ttftMs: this.lastTtftMs,
          tokensPerSec: stats.tokensPerSecond || currentState.telemetry?.tokensPerSec,
          decodedTokens: stats.tokenCount || currentState.telemetry?.decodedTokens,
          prefillTokens: stats.promptTokens || currentState.telemetry?.prefillTokens,
          prefillTokensEstimated: stats.promptTokens ? false : currentState.telemetry?.prefillTokensEstimated,
          prefillTokensPerSec: this.lastPrefillTokensPerSec,
          lastUpdated: Date.now(),
        },
      });

      if (agentLabel) {
        // Subagent tokens (active in-flight ephemeral context)
        const prevSubTokens = currentState.stats.subagentUsedTokens || 0;
        const currentSubTokens = prevSubTokens + addedTokens;
        const mainUsedTokens = currentState.stats.usedTokens || 0;
        const combined = mainUsedTokens + currentSubTokens;
        const percentage = Math.min(100, Math.round((combined / maxTokens) * 100));

        this.store.updateStats({
          subagentUsedTokens: currentSubTokens,
          totalSessionTokens: newTotalSession,
          percentage,
        });
        this.store.updateSpawnedAgent({
          usedTokens: currentSubTokens,
        });
      } else {
        // Main agent tokens
        const subTokens = currentState.stats.subagentUsedTokens || 0;
        const combined = stats.totalTokens + subTokens;
        const percentage = Math.min(100, Math.round((combined / maxTokens) * 100));

        this.store.updateStats({
          usedTokens: stats.totalTokens,
          totalSessionTokens: newTotalSession,
          percentage,
        });
      }
    };
  }

  /**
   * Creates an AgentEvent handler for lifecycle events (tool_start, tool_end, subagent_start, subagent_end, round_continue, max_rounds).
   */
  createEventHandler(): AgentEventHandler {
    // One handler per event type: the union of AgentEvent drives the table, so a
    // new event cannot be forgotten here — the compiler asks for its entry.
    const handlers: { [K in AgentEvent['type']]: (ev: Extract<AgentEvent, { type: K }>) => void } = {
      subagent_start: (ev) => {
        this.store.setSpawnedAgent({
          id: `sub_${Date.now()}`,
          name: ev.name,
          role: ev.role,
          task: ev.task,
          status: 'running',
          usedTokens: 0,
          startedAt: Date.now(),
        });
        this.store.setState({ generationStatus: { phase: 'reasoning', agentName: ev.name } });
      },

      subagent_end: (ev) => {
        this.store.updateSpawnedAgent({
          status: ev.success ? 'completed' : 'failed',
          currentTool: undefined,
          completedAt: Date.now(),
        });

        // The ephemeral subagent context is gone: its tokens leave the active gauge.
        const state = this.store.getState();
        const maxTokens = state.stats.maxTokens || 8192;
        const mainUsedTokens = state.stats.usedTokens || 0;
        this.store.updateStats({
          subagentUsedTokens: 0,
          percentage: Math.min(100, Math.round((mainUsedTokens / maxTokens) * 100)),
        });
        this.store.setSpawnedAgent(null);
        this.backToThinking();
      },

      tool_start: (ev) => {
        if (ev.agentLabel) this.store.updateSpawnedAgent({ currentTool: ev.name });
        this.store.setState({
          generationStatus: { phase: 'tool', agentName: ev.agentLabel, toolName: ev.name },
        });

        const displayToolName = ev.agentLabel ? `${ev.name} (@${ev.agentLabel})` : ev.name;
        const args = JSON.stringify(ev.args || {});
        const toolId = this.store.startTool(displayToolName, args);
        this.currentToolExecMap.set(ev.name, toolId);

        this.patchCurrentToolCalls((toolCalls) => [
          ...toolCalls,
          { id: toolId, name: ev.name, args, status: 'running' as const },
        ]);
      },

      tool_end: (ev) => {
        if (ev.agentLabel) this.store.updateSpawnedAgent({ currentTool: undefined });
        this.backToThinking(ev.agentLabel);

        const toolId = this.currentToolExecMap.get(ev.name);
        if (toolId) {
          this.store.finishTool(toolId, ev.output || '', ev.success);
          this.currentToolExecMap.delete(ev.name);
        }

        this.patchCurrentToolCalls((toolCalls) =>
          toolCalls.map((tc) =>
            tc.name === ev.name && tc.status === 'running'
              ? { ...tc, status: ev.success ? ('completed' as const) : ('failed' as const), output: ev.output }
              : tc
          )
        );
      },

      round_continue: () => {
        // Close the current message so the next ReAct round starts a fresh one.
        if (this.currentAssistantMsgId) {
          this.store.finishStreaming(this.currentAssistantMsgId);
          this.currentAssistantMsgId = undefined;
        }
        this.store.setState({ isGenerating: true });
        this.backToThinking();
      },

      max_rounds: (ev) => {
        this.store.notify(`Execution interrupted: reached limit of ${ev.limit} tool rounds`, 'warn');
      },
    };

    return (ev: AgentEvent) => (handlers[ev.type] as (e: AgentEvent) => void)(ev);
  }

  /**
   * Returns the header to the "model is working" state after a tool or a
   * subagent. With reasoning disabled there is no thinking phase to go back to,
   * so the turn resumes as plain streaming.
   */
  private backToThinking(agentName?: string): void {
    const state = this.store.getState();
    this.store.setState({
      generationStatus: {
        phase: state.activeReasoningEffort === 'none' ? 'streaming' : 'reasoning',
        agentName: agentName || state.activeAiName,
      },
    });
  }

  /** Rewrites the tool calls attached to the message being streamed, if any. */
  private patchCurrentToolCalls(
    update: (toolCalls: NonNullable<TuiChatMessage['toolCalls']>) => NonNullable<TuiChatMessage['toolCalls']>
  ): void {
    if (!this.currentAssistantMsgId) return;
    const msg = this.store.getState().messages.find((m) => m.id === this.currentAssistantMsgId);
    if (!msg) return;
    this.store.updateMessage(this.currentAssistantMsgId, { toolCalls: update(msg.toolCalls || []) });
  }

  resetCurrentTurn(): void {
    if (this.currentAssistantMsgId) {
      this.store.finishStreaming(this.currentAssistantMsgId);
      this.currentAssistantMsgId = undefined;
    }
    this.currentToolExecMap.clear();

    // An interrupted turn produces no final stats: confidence and candidates refer
    // to a token that is no longer being generated, so they must not stay on screen.
    const telemetry = this.store.getState().telemetry;
    if (telemetry && telemetry.phase !== 'idle') {
      this.store.setState({
        telemetry: { ...telemetry, phase: 'idle', confidence: undefined, topCandidates: undefined, lastUpdated: Date.now() },
      });
    }
  }
}
