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
  createChunkHandler(): (chunk: string, channel?: StreamChannel) => void {
    return (chunk: string, channel?: StreamChannel) => {
      const isReasoning = channel === 'reasoning';
      if (!this.currentAssistantMsgId) {
        this.currentAssistantMsgId = this.store.addMessage({
          role: 'assistant',
          authorName: this.store.getState().activeAiName,
          content: !isReasoning ? chunk : '',
          thinkingContent: isReasoning ? chunk : '',
          isStreaming: true,
        });
      } else {
        this.store.appendStreamingChunk(this.currentAssistantMsgId, chunk, isReasoning);
      }
    };
  }

  /**
   * Creates a live stats update handler for Agent.run().
   */
  createStatsHandler(): (stats: { durationMs: number; tokenCount: number; tokensPerSecond: number; promptTokens: number; totalTokens: number }) => void {
    return (stats) => {
      const maxTokens = this.store.getState().stats.maxTokens || 8192;
      const percentage = Math.min(100, Math.round((stats.totalTokens / maxTokens) * 100));
      this.store.updateStats({
        usedTokens: stats.totalTokens,
        percentage,
      });
    };
  }

  /**
   * Creates an AgentEvent handler for lifecycle events (tool_start, tool_end, max_rounds).
   */
  createEventHandler(): AgentEventHandler {
    return (ev: AgentEvent) => {
      switch (ev.type) {
        case 'tool_start': {
          const toolId = this.store.startTool(ev.name, JSON.stringify(ev.args || {}));
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
