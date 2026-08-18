/**
 * Event and Safety Bridge for TSUKA TUI.
 * Connects AgentEvents, PermissionManager, and logSink directly to TuiStore.
 */

import { TuiStore } from './store';
import { AgentEvent, AgentEventHandler } from '../core/agentEvents';
import { StreamChannel } from '../core/thinkParser';
import { PermissionManager, PermissionPromptRequest } from '../safety/permissions';
import { setLogSink } from '../core/logSink';

export class TuiBridge {
  private store: TuiStore;
  private permissionManager: PermissionManager;
  private currentAssistantMsgId?: string;
  private currentToolExecMap: Map<string, string> = new Map();

  constructor(store: TuiStore, permissionManager: PermissionManager) {
    this.store = store;
    this.permissionManager = permissionManager;
    this.setupPermissionHandler();
    this.setupLogSink();
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
  createStatsHandler(): (stats: { durationMs: number; tokenCount: number; tokensPerSecond: number; promptTokens: number; totalTokens: number }, agentLabel?: string) => void {
    return (stats, agentLabel) => {
      const currentState = this.store.getState();
      const maxTokens = currentState.stats.maxTokens || 8192;

      if (agentLabel) {
        // Subagent tokens
        const prevSubTokens = currentState.stats.subagentUsedTokens || 0;
        const addedTokens = stats.tokenCount || stats.totalTokens || 0;
        const currentSubTokens = prevSubTokens + addedTokens;
        const mainUsedTokens = currentState.stats.usedTokens || 0;
        const combined = mainUsedTokens + currentSubTokens;
        const percentage = Math.min(100, Math.round((combined / maxTokens) * 100));

        this.store.updateStats({
          subagentUsedTokens: currentSubTokens,
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
          percentage,
        });
      }
    };
  }

  /**
   * Creates an AgentEvent handler for lifecycle events (tool_start, tool_end, subagent_start, subagent_end, round_continue, max_rounds).
   */
  createEventHandler(): AgentEventHandler {
    return (ev: AgentEvent) => {
      switch (ev.type) {
        case 'subagent_start': {
          this.store.setSpawnedAgent({
            id: `sub_${Date.now()}`,
            name: ev.name,
            role: ev.role,
            task: ev.task,
            status: 'running',
            usedTokens: 0,
            startedAt: Date.now(),
          });
          this.store.setState({
            generationStatus: {
              phase: 'reasoning',
              agentName: ev.name,
            },
          });
          break;
        }

        case 'subagent_end': {
          this.store.updateSpawnedAgent({
            status: ev.success ? 'completed' : 'failed',
            currentTool: undefined,
            completedAt: Date.now(),
          });
          const isNoEffortEnd = this.store.getState().activeReasoningEffort === 'none';
          this.store.setState({
            generationStatus: {
              phase: isNoEffortEnd ? 'streaming' : 'reasoning',
              agentName: this.store.getState().activeAiName,
            },
          });
          break;
        }

        case 'tool_start': {
          if (ev.agentLabel) {
            this.store.updateSpawnedAgent({ currentTool: ev.name });
          }
          this.store.setState({
            generationStatus: {
              phase: 'tool',
              agentName: ev.agentLabel,
              toolName: ev.name,
            },
          });
          const displayToolName = ev.agentLabel ? `${ev.name} (@${ev.agentLabel})` : ev.name;
          const toolId = this.store.startTool(displayToolName, JSON.stringify(ev.args || {}));
          this.currentToolExecMap.set(ev.name, toolId);

          if (this.currentAssistantMsgId) {
            const state = this.store.getState();
            const msg = state.messages.find((m) => m.id === this.currentAssistantMsgId);
            if (msg) {
              const toolCalls = [
                ...(msg.toolCalls || []),
                {
                  id: toolId,
                  name: ev.name,
                  args: JSON.stringify(ev.args || {}),
                  status: 'running' as const,
                },
              ];
              this.store.updateMessage(this.currentAssistantMsgId, { toolCalls });
            }
          }
          break;
        }

        case 'tool_end': {
          if (ev.agentLabel) {
            this.store.updateSpawnedAgent({ currentTool: undefined });
          }
          const isNoEffortTool = this.store.getState().activeReasoningEffort === 'none';
          this.store.setState({
            generationStatus: {
              phase: isNoEffortTool ? 'streaming' : 'reasoning',
              agentName: ev.agentLabel || this.store.getState().activeAiName,
            },
          });
          const toolId = this.currentToolExecMap.get(ev.name);
          if (toolId) {
            this.store.finishTool(toolId, ev.output || '', ev.success);
            this.currentToolExecMap.delete(ev.name);
          }

          if (this.currentAssistantMsgId) {
            const state = this.store.getState();
            const msg = state.messages.find((m) => m.id === this.currentAssistantMsgId);
            if (msg && msg.toolCalls) {
              const updated = msg.toolCalls.map((tc) =>
                tc.name === ev.name && tc.status === 'running'
                  ? { ...tc, status: ev.success ? ('completed' as const) : ('failed' as const), output: ev.output }
                  : tc
              );
              this.store.updateMessage(this.currentAssistantMsgId, { toolCalls: updated });
            }
          }
          break;
        }

        case 'round_continue': {
          // Finalize current message so the next ReAct round gets a fresh message & thinking block
          if (this.currentAssistantMsgId) {
            this.store.finishStreaming(this.currentAssistantMsgId);
            this.currentAssistantMsgId = undefined;
          }
          const isNoEffortContinue = this.store.getState().activeReasoningEffort === 'none';
          this.store.setState({
            isGenerating: true,
            generationStatus: {
              phase: isNoEffortContinue ? 'streaming' : 'reasoning',
              agentName: this.store.getState().activeAiName,
            },
          });
          break;
        }

        case 'max_rounds': {
          this.store.notify(`Execution interrupted: reached limit of ${ev.limit} tool rounds`, 'warn');
          break;
        }
      }
    };
  }

  resetCurrentTurn(): void {
    if (this.currentAssistantMsgId) {
      this.store.finishStreaming(this.currentAssistantMsgId);
      this.currentAssistantMsgId = undefined;
    }
    this.currentToolExecMap.clear();
  }
}
