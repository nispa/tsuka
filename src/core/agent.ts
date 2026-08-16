import { ILLMProvider, ChatOptions, ReasoningEffort } from './provider';
import { ToolRegistry } from '../tools/registry';
import { PermissionManager } from '../safety/permissions';
import { AgentEvent, AgentEventHandler } from './agentEvents';
import { StreamChannel } from './thinkParser';
import chalk from 'chalk';
import { MemoryStore } from './memory';
import { logSink } from './logSink';
import { ChatMessage } from './types';
import { calculateReasoningBudget, sumMessageChars } from './contextBudget';
import * as fs from 'fs';
import * as path from 'path';
import { homePath } from './apphome';

/**
 * Minimal interface shape for reasoning effort cascade resolution (T8.10).
 */
export interface ReasoningEffortSource {
  reasoningEffort?: ReasoningEffort;
}

/**
 * 4-level cascade to resolve effective reasoning effort (T8.10):
 * caller override -> character -> role -> config default.
 * First level specifying a value wins.
 */
export function resolveReasoningEffort(
  callerOverride: ReasoningEffort | undefined,
  character: object | null | undefined,
  role: object | null | undefined,
  configDefault: ReasoningEffort | undefined
): ReasoningEffort | undefined {
  return (
    callerOverride ??
    (character as ReasoningEffortSource | undefined)?.reasoningEffort ??
    (role as ReasoningEffortSource | undefined)?.reasoningEffort ??
    configDefault
  );
}

/**
 * Minimal fallback event renderer used when caller provides no event handler (tests/programmatic use).
 */
function plainEventRenderer(ev: AgentEvent): void {
  switch (ev.type) {
    case 'tool_start':
      console.log(chalk.cyan(`[tool] ${ev.name}...`));
      break;
    case 'tool_end':
      console.log(chalk.gray(`[tool] ${ev.name} ${ev.success ? 'completed' : 'failed/rejected'}`));
      break;
    case 'max_rounds':
      console.log(chalk.yellow(`[Interrupted: reached limit of ${ev.limit} tool rounds]`));
      break;
  }
}

import { sanitizeToolCallArguments } from '../tools/jsonRepair';

/**
 * Backward compatibility wrapper for tool arguments sanitization.
 */
export function sanitizeAndParseToolArgs(rawArguments: string | undefined): {
  parsedArgs: any;
  sanitizedJsonString: string;
  isMalformed: boolean;
} {
  const result = sanitizeToolCallArguments(rawArguments);
  return {
    parsedArgs: result.parsed,
    sanitizedJsonString: result.repairedJson,
    isMalformed: result.isMalformed
  };
}

export class Agent {
  private static readonly DEFAULT_MAX_TOOL_ROUNDS = 15;

  private provider: ILLMProvider;
  private registry: ToolRegistry;
  private permissionManager: PermissionManager;
  private messages: ChatMessage[] = [];
  private allowedTools?: string[];
  private maxHistoryMessages: number;
  private maxHistoryTokens: number;
  private maxToolRounds: number;
  private charsPerToken = 3.5;
  private static readonly RATIO_SMOOTHING = 0.2;
  private agentLabel?: string;
  private reasoningEffort?: ReasoningEffort;
  private acceptTextOnlyIf?: (content: string) => boolean;
  private toolsChars = 0;

  constructor(
    provider: ILLMProvider,
    registry: ToolRegistry,
    permissionManager: PermissionManager,
    systemPrompt: string,
    allowedTools?: string[],
    maxHistoryMessages: number = 40,
    maxHistoryTokens: number = 65536,
    agentLabel?: string,
    reasoningEffort?: ReasoningEffort,
    acceptTextOnlyIf?: (content: string) => boolean,
    maxToolRounds: number = Agent.DEFAULT_MAX_TOOL_ROUNDS
  ) {
    this.provider = provider;
    this.registry = registry;
    this.permissionManager = permissionManager;
    this.allowedTools = allowedTools;
    this.maxHistoryMessages = Math.max(4, maxHistoryMessages);
    this.maxHistoryTokens = Math.max(0, maxHistoryTokens);
    this.agentLabel = agentLabel;
    this.reasoningEffort = reasoningEffort;
    this.acceptTextOnlyIf = acceptTextOnlyIf;
    this.maxToolRounds = Math.max(1, maxToolRounds);
    this.clearHistory(systemPrompt);
  }

  private commandCtx?: any;

  /** Sets CLI command context (used by escalation tools like request_goal/team/call). */
  setCommandCtx(ctx: any): void {
    this.commandCtx = ctx;
  }

  getReasoningEffort(): ReasoningEffort | undefined {
    return this.reasoningEffort;
  }

  getMaxToolRounds(): number {
    return this.maxToolRounds;
  }

  private static messageChars(m: Pick<ChatMessage, 'content' | 'tool_calls'>): number {
    return sumMessageChars([m]);
  }

  private estimateTokens(m: Pick<ChatMessage, 'content' | 'tool_calls'>): number {
    return Math.ceil(Agent.messageChars(m) / this.charsPerToken);
  }

  private calibrateCharsPerToken(sentMessages: Array<Pick<ChatMessage, 'content' | 'tool_calls'>>, promptTokens?: number): void {
    if (!promptTokens || promptTokens <= 0) return;
    const chars = sentMessages.reduce((sum, m) => sum + Agent.messageChars(m), 0) + this.toolsChars;
    const observed = chars / promptTokens;
    if (!Number.isFinite(observed) || observed <= 0) return;
    this.charsPerToken = this.charsPerToken * (1 - Agent.RATIO_SMOOTHING) + observed * Agent.RATIO_SMOOTHING;
  }

  private updateToolsSize(toolsForRequest: unknown[] | undefined): void {
    if (!toolsForRequest || toolsForRequest.length === 0) {
      this.toolsChars = 0;
      return;
    }
    try {
      this.toolsChars = JSON.stringify(toolsForRequest).length;
    } catch {
      this.toolsChars = 0;
    }
  }

  private estimateToolsTokens(): number {
    return this.toolsChars > 0 ? Math.ceil(this.toolsChars / this.charsPerToken) : 0;
  }

  getMessages() {
    return this.messages;
  }

  clearHistory(systemPrompt: string): void {
    this.messages = [
      { role: 'system', content: systemPrompt }
    ];
  }

  /**
   * Updates agent skill/role and allowed tools dynamically without clearing conversation history.
   */
  setActiveSkill(systemPrompt: string, allowedTools?: string[]): void {
    this.allowedTools = allowedTools;
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = systemPrompt;
    } else {
      this.messages.unshift({ role: 'system', content: systemPrompt });
    }
  }

  getAllowedTools(): string[] | undefined {
    return this.allowedTools;
  }

  /**
   * Prunes history to stay within message count and estimated token budgets.
   */
  pruneHistory(): number {
    let start = 1;
    if (this.messages.length > this.maxHistoryMessages) {
      start = this.messages.length - (this.maxHistoryMessages - 1);
    }

    if (this.maxHistoryTokens > 0) {
      let total = this.estimateToolsTokens() + this.estimateTokens(this.messages[0]);
      for (let i = start; i < this.messages.length; i++) {
        total += this.estimateTokens(this.messages[i]);
      }
      while (total > this.maxHistoryTokens && start < this.messages.length - 3) {
        total -= this.estimateTokens(this.messages[start]);
        start++;
      }
    }

    while (start < this.messages.length - 1 && this.messages[start].role === 'tool') {
      start++;
    }

    const removed = start - 1;
    if (removed <= 0) {
      return 0;
    }

    this.messages = [this.messages[0], ...this.messages.slice(start)];
    logSink.log(
      chalk.gray(`[History: pruned ${removed} older messages to stay within context window (~${this.maxHistoryTokens} tokens)]`)
    );
    return removed;
  }

  estimateMessagesTokens(msgs: Array<Pick<ChatMessage, 'content' | 'tool_calls'>>): number {
    return Math.ceil(sumMessageChars(msgs) / this.charsPerToken);
  }

  getCharsPerTokenRatio(): number {
    return this.charsPerToken;
  }

  estimateTotalContextTokens(): number {
    return this.estimateMessagesTokens(this.messages) + this.estimateToolsTokens();
  }

  /**
   * Automatic conversation history compaction when context exceeds threshold.
   */
  async compressHistory(threshold: number = 0.75): Promise<{ saved: number; compressedCount: number }> {
    if (this.maxHistoryTokens <= 0 || this.messages.length < 6) return { saved: 0, compressedCount: 0 };

    const total = this.estimateTotalContextTokens();
    if (total < this.maxHistoryTokens * threshold) return { saved: 0, compressedCount: 0 };

    const keepRecent = 4;
    const maxCompressEnd = this.messages.length - keepRecent - 1;
    if (maxCompressEnd < 1) return { saved: 0, compressedCount: 0 };

    let compressEnd = maxCompressEnd;
    while (compressEnd > 0 && this.messages[compressEnd]?.role === 'tool') {
      compressEnd--;
    }
    if (compressEnd < 1) return { saved: 0, compressedCount: 0 };

    const toCompress = this.messages.slice(1, compressEnd + 1);
    const compressTok = this.estimateMessagesTokens(toCompress);
    if (compressTok < 3000) return { saved: 0, compressedCount: 0 };

    const summaryInput = toCompress
      .filter((m) => m.role !== 'tool' && m.content)
      .map((m) => {
        const label = m.role === 'user' ? 'User' : 'Assistant';
        const content = (m.content || '').slice(0, 600);
        return `${label}: ${content}`;
      })
      .join('\n\n');

    let summary = '';
    try {
      const response = await this.provider.chatWithTools(
        [
          { role: 'system', content: 'You summarize technical conversations concisely and objectively in 3-5 sentences: key points, decisions, files created, results. Max 200 words.' },
          { role: 'user', content: `Summarize this conversation:\n\n${summaryInput}` }
        ],
        undefined,
        undefined,
        undefined,
        this.reasoningEffort ? { reasoningEffort: this.reasoningEffort } : undefined
      );
      summary = response.content?.trim() || '';
    } catch {
      summary = toCompress
        .filter((m) => m.role === 'assistant' && m.content)
        .map((m) => (m.content || '').slice(0, 300))
        .join('\n')
        .slice(0, 1500);
    }

    if (summary) {
      MemoryStore.getInstance().addFact(
        `[Compressed history] ${summary.replace(/\s+/g, ' ').slice(0, 500)}`,
        'system',
        { kind: 'run' }
      );
    }

    const summaryMsg = {
      role: 'user' as const,
      content: `[Previous conversation summary]: ${summary.slice(0, 2000)}`
    };

    this.messages = [
      this.messages[0],
      summaryMsg,
      ...this.messages.slice(compressEnd + 1)
    ];

    const afterTotal = this.estimateTotalContextTokens();
    const saved = total - afterTotal;
    const savedStr = saved >= 1000 ? `${(saved / 1000).toFixed(1)}k` : `${saved}`;
    logSink.log(chalk.gray(`[Auto-compression: compressed ${toCompress.length} messages, saved ~${savedStr} tokens (now ~${Math.round(afterTotal / 1000)}k)]`));

    return { saved, compressedCount: toCompress.length };
  }

  private static readonly MIN_REASONING_TO_PERSIST = 300;

  /**
   * Persists long reasoning chains to disk under `memory/thinking/` and adds an index pointer to MemoryStore.
   */
  private persistReasoningTrace(text: string, taskExcerpt: string, interrupted: boolean): void {
    const trimmed = (text || '').trim();
    if (trimmed.length < Agent.MIN_REASONING_TO_PERSIST) return;
    try {
      const dir = homePath('memory', 'thinking');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const label = (this.agentLabel || 'agent').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 30) || 'agent';
      const filename = `${stamp}-${label}${interrupted ? '-interrupted' : ''}.md`;
      fs.writeFileSync(path.join(dir, filename), trimmed, 'utf-8');

      const shortTask = (taskExcerpt || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const status = interrupted ? 'interrupted' : 'complete';
      const pointer =
        `Reasoning trace ${status} (${trimmed.length} chars) on "${shortTask}" saved in ` +
        `memory/thinking/${filename} — read with read_file before re-evaluating the task from scratch.`;
      MemoryStore.getInstance().addFact(pointer.slice(0, 500), this.agentLabel || 'agent', { kind: 'run' });
    } catch (error: any) {
      logSink.error(chalk.gray(`[Unable to save reasoning trace: ${error.message}]`));
    }
  }

  /**
   * Runs the agentic ReAct loop for a user message.
   */
  async run(
    userMessage: string,
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    onStats?: (stats: { durationMs: number; tokenCount: number; tokensPerSecond: number; promptTokens: number; totalTokens: number }) => void,
    onEvent?: AgentEventHandler,
    signal?: AbortSignal,
    reasoningEffortOverride?: ReasoningEffort
  ): Promise<string> {
    const emit = onEvent ?? plainEventRenderer;
    this.messages.push({ role: 'user', content: userMessage });
    let currentRoundEffortOverride = reasoningEffortOverride;

    let isDone = false;
    let finalAnswer = '';
    let toolRounds = 0;
    let cumStats = { durationMs: 0, tokenCount: 0, promptTokens: 0, totalTokens: 0 };
    let everCalledTool = false;
    let noToolNudgeUsed = false;

    while (!isDone) {
      if (signal?.aborted) break;

      const promptTokensEst = Math.ceil(this.estimateMessagesTokens(this.messages) + this.toolsChars / this.charsPerToken);
      const baseEffort = currentRoundEffortOverride ?? this.reasoningEffort;
      const budget = calculateReasoningBudget(promptTokensEst, this.maxHistoryTokens, baseEffort);
      const effectiveEffort = (budget.effectiveEffort as ReasoningEffort) ?? baseEffort;
      const chatOptions: ChatOptions | undefined = effectiveEffort ? { reasoningEffort: effectiveEffort } : undefined;

      const tools = this.registry.listForLLM(this.provider.getCurrentModel(), this.allowedTools, effectiveEffort);
      const toolsForRequest = tools.length > 0 ? tools : undefined;

      this.updateToolsSize(toolsForRequest);
      this.pruneHistory();

      try {
        const response = await this.provider.chatWithTools(
          this.messages,
          toolsForRequest,
          onChunk,
          signal,
          chatOptions
        );

        const { content, toolCalls, stats, reasoningText } = response;

        if (reasoningText) {
          this.persistReasoningTrace(reasoningText, userMessage, false);
        }

        this.calibrateCharsPerToken(this.messages, (stats as any)?.promptTokens);

        const parsedArgsList: any[] = [];
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            const { parsedArgs, sanitizedJsonString } = sanitizeAndParseToolArgs(tc.function.arguments);
            tc.function.arguments = sanitizedJsonString;
            parsedArgsList.push(parsedArgs);
          }
        }

        const assistantMessage: ChatMessage = { role: 'assistant', content: content || null };
        if (toolCalls && toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }
        this.messages.push(assistantMessage);

        if (content) {
          finalAnswer = content;
        }

        if (stats && onStats) {
          cumStats.durationMs += stats.durationMs;
          cumStats.tokenCount += stats.tokenCount;
          cumStats.promptTokens = Math.max(cumStats.promptTokens, (stats as any).promptTokens ?? 0);
          cumStats.totalTokens = Math.max(cumStats.totalTokens, (stats as any).totalTokens ?? 0);
          const tps = cumStats.durationMs > 0
            ? parseFloat((cumStats.tokenCount / (cumStats.durationMs / 1000)).toFixed(1))
            : 0;
          onStats({
            durationMs: cumStats.durationMs,
            tokenCount: cumStats.tokenCount,
            tokensPerSecond: tps,
            promptTokens: cumStats.promptTokens,
            totalTokens: cumStats.totalTokens
          });
        }

        if (!toolCalls || toolCalls.length === 0) {
          const textIsAcceptable = everCalledTool || !this.acceptTextOnlyIf || this.acceptTextOnlyIf(content || '');
          if (!textIsAcceptable && !noToolNudgeUsed) {
            noToolNudgeUsed = true;
            currentRoundEffortOverride = 'none';
            const closingHint = this.allowedTools?.includes('report_status')
              ? "call 'report_status' with the appropriate status to explicitly complete your turn"
              : 'write a clear summary of what you did (or why progress could not be made) to complete the turn';
            this.messages.push({
              role: 'user',
              content: 'You did not call any tools in this response. If you were planning, ACT NOW: call the appropriate ' +
                'tool (e.g. write_file, edit_file, execute_command). If the task is already completed or cannot proceed further, ' +
                `${closingHint}.`
            });
            continue;
          }
          isDone = true;
          break;
        }
        everCalledTool = true;

        for (let i = 0; i < toolCalls.length; i++) {
          const toolCall = toolCalls[i];
          const toolName = toolCall.function.name;
          const toolArgs: any = parsedArgsList[i] ?? {};

          if (signal?.aborted) {
            this.messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: '[Execution cancelled: generation interrupted by user]'
            });
            continue;
          }

          emit({ type: 'tool_start', name: toolName, args: toolArgs });

          const result = await this.registry.executeTool(toolName, toolArgs, this.permissionManager, this.provider, this.agentLabel, this.commandCtx);

          this.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result.output
          });

          emit({ type: 'tool_end', name: toolName, args: toolArgs, success: result.success, output: result.output });
        }

        if (signal?.aborted) break;

        toolRounds++;
        if (toolRounds >= this.maxToolRounds) {
          const stopMessage =
            `[Safety limit reached] Reached maximum of ${this.maxToolRounds} ` +
            `consecutive tool execution rounds for this request. Process stopped to avoid infinite loops.`;
          emit({ type: 'max_rounds', limit: this.maxToolRounds });
          this.messages.push({ role: 'assistant', content: stopMessage });
          finalAnswer = stopMessage;
          break;
        }

        emit({ type: 'round_continue', round: toolRounds });

      } catch (error: any) {
        if (signal?.aborted) break;
        if ((error as any)?.partialReasoning) {
          this.persistReasoningTrace((error as any).partialReasoning, userMessage, true);
        }
        throw new Error(`Error in agentic loop: ${error.message}`);
      }
    }

    return finalAnswer;
  }
}
