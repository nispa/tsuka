/**
 * Core Subagent Runner (T22.7).
 *
 * Encapsulates the execution lifecycle of child subagents:
 * - Persona and tool set resolution
 * - Task preparation (string briefings or structured TaskPackets)
 * - Reasoning effort propagation and divergence logging
 * - Child Agent construction and event / stream forwarding
 * - Execution lifecycle events (subagent_start / subagent_end)
 * - Report persistence under runs/<runId>/
 * - Blackboard or MemoryStore artifact recording
 * - Structured AgentResult parsing when requested
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ILLMProvider, ChatStats, ReasoningEffort } from './provider';
import type { IToolRegistry } from '../tools/registry';
import { PermissionManager } from '../safety/permissions';
import { Agent } from './agent';
import { Blackboard } from './blackboard';
import { MemoryStore } from './memory';
import { ConfigManager } from './config';
import { SUBAGENT_DEFAULTS } from './constants';
import { homePath } from './apphome';
import { loadSystemPrompt, resolveCharacter, loadRole, loadTrait } from './personas';
import { resolveToolSet } from './toolSet';
import { withEffortPin, logEffortDivergence } from './effortControl';
import type { StreamChannel } from './thinkParser';
import type { AgentEventHandler } from './agentEvents';
import { TaskPacket, validateTaskPacket, formatTaskPacketBriefing } from './taskPacket';
import { AgentResult, safeParseAgentResult, createFailedFallback } from './agentResult';
import type {
  ISubagentRunner,
  SubagentRunRequest,
  SubagentExecutionContext,
  SubagentRunResult,
} from './types';

export type {
  ISubagentRunner,
  SubagentRunRequest,
  SubagentExecutionContext,
  SubagentRunResult,
};

export interface SubagentRunnerDependencies {
  provider: ILLMProvider;
  registry: IToolRegistry;
  permissionManager?: PermissionManager;
  configManager?: ConfigManager;
  memoryStore?: MemoryStore | null;
}

export class DefaultSubagentRunner implements ISubagentRunner {
  constructor(private readonly dependencies: SubagentRunnerDependencies) {
    if (!dependencies.provider) {
      throw new Error('SubagentRunner requires an ILLMProvider dependency.');
    }
    if (!dependencies.registry) {
      throw new Error('SubagentRunner requires an IToolRegistry dependency.');
    }
  }

  async run(request: SubagentRunRequest, context?: SubagentExecutionContext): Promise<SubagentRunResult> {
    const { provider, registry } = this.dependencies;
    const permissionManager = this.dependencies.permissionManager ?? new PermissionManager();
    const configManager = this.dependencies.configManager ?? new ConfigManager();

    // 1. Resolve task briefing content
    let taskText: string;
    if (typeof request.task === 'string') {
      taskText = request.task.trim();
    } else {
      const validatedPacket = validateTaskPacket(request.task);
      taskText = formatTaskPacketBriefing(validatedPacket);
    }

    if (request.expectAgentResult) {
      taskText +=
        `\n\n## Output Format Requirement\n` +
        `You MUST return your final response as a single, valid JSON object matching the AgentResult schema:\n` +
        `{\n` +
        `  "status": "done" | "blocked" | "failed",\n` +
        `  "summary": "Concise summary of actions and findings",\n` +
        `  "changes": ["Modified file or entity 1"],\n` +
        `  "decisions": ["Architectural decision 1"],\n` +
        `  "unresolved": ["Remaining open issue 1"],\n` +
        `  "evidence": { "files": ["src/example.ts"], "tests": ["test_suite"] }\n` +
        `}\n` +
        `Do not wrap the JSON object in conversational prose before or after.`;
    }

    // 2. Resolve persona (Character / Role / Trait)
    const charName = (request.charName || '').trim().toLowerCase();
    const char = charName ? resolveCharacter(charName) : null;
    let roleName = (request.roleName || '').trim().toLowerCase() || SUBAGENT_DEFAULTS.defaultRole;
    let traitName = (request.traitName || '').trim().toLowerCase() || SUBAGENT_DEFAULTS.defaultTrait;
    if (char) {
      roleName = char.role || char.activeRole || SUBAGENT_DEFAULTS.defaultRole;
      traitName = char.trait || SUBAGENT_DEFAULTS.defaultTrait;
    }

    const roleObj = loadRole(roleName);
    const traitObj = loadTrait(traitName);
    const label = char?.aiName || roleName;

    // 3. Resolve tool set (including blackboard and memory tools)
    const blackboard = Blackboard.current();
    const memoryTools = ['save_memory', 'recall_memory', 'update_memory', 'forget_memory'];
    const blackboardTools = blackboard ? ['post_note', 'read_notes'] : [];
    const toolSet = resolveToolSet(roleObj, { alwaysActive: [...memoryTools, ...blackboardTools] });

    // 4. Resolve reasoning effort
    const effectiveOverride = withEffortPin(request.reasoningEffort as ReasoningEffort | undefined);
    logEffortDivergence(label, effectiveOverride, configManager.getDefaultReasoningEffort());

    // 5. Assemble system prompt
    let sysPrompt =
      loadSystemPrompt(
        roleObj,
        traitObj,
        provider.getCurrentModel?.() || 'default',
        registry,
        char,
        taskText,
        effectiveOverride,
        provider.getBaseUrl?.(),
        provider.getProviderClass?.()
      ) +
      `\n\nThis is a subordinate sub-agent task. Complete the work and report results concisely.`;

    if (blackboard) {
      sysPrompt +=
        `\n\nRUN BLACKBOARD: this task is part of an orchestrated workflow (/team or /goal). ` +
        `Use 'read_notes' to inspect previous notes or 'post_note' to record decisions/artifacts.`;
    }

    // 6. Instantiate child Agent
    const subAgent = new Agent(
      provider,
      registry,
      permissionManager,
      sysPrompt,
      toolSet.active,
      configManager.getMaxHistoryMessages(),
      configManager.getMaxHistoryTokens(),
      label,
      undefined,
      undefined,
      configManager.getMaxToolRounds()
    );
    subAgent.setDeferredTools(toolSet.deferred);
    subAgent.setSubagentRunner(this);
    subAgent.setContextScheduler({ enabled: false });

    // 7. Setup forwarding handlers attributed to subagent label
    const onChunk = context?.onChunk;
    const onStats = context?.onStats;
    const onEvent = context?.onEvent;
    const signal = context?.signal;

    let capturedStats: ChatStats | undefined;

    const subChunkHandler = onChunk
      ? (chunk: string, channel?: StreamChannel) => {
          onChunk(chunk, channel, label);
        }
      : undefined;

    const subStatsHandler = (stats: ChatStats) => {
      capturedStats = stats;
      if (onStats) {
        onStats(stats, label);
      }
    };

    const subEventHandler = onEvent
      ? (ev: any) => {
          onEvent({
            ...ev,
            agentLabel: label,
          });
        }
      : undefined;

    if (onEvent) {
      onEvent({
        type: 'subagent_start',
        name: label,
        role: roleName,
        task: taskText,
        agentLabel: label,
      });
    }

    // 8. Execute child agent turn & persist artifacts atomically
    try {
      const result = await subAgent.run(
        `Execute this task: ${taskText}`,
        subChunkHandler,
        subStatsHandler,
        subEventHandler,
        signal,
        effectiveOverride
      );

      // 9. Persist full report artifact to disk under runs/<runId>/
      const fullReport = result || '[no response]';
      const runKey = request.runId || blackboard?.runId || crypto.randomUUID();
      const runDir = homePath('runs', runKey);
      fs.mkdirSync(runDir, { recursive: true });
      const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'subagent';
      const fileName = `${safeLabel}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.md`;
      const filePath = path.join(runDir, fileName);
      fs.writeFileSync(filePath, fullReport, 'utf-8');
      const relPath = path.join('runs', runKey, fileName);

      // 10. Record artifact to blackboard or memory
      if (blackboard) {
        blackboard.post('artefatto-sub-agente', relPath, label);
      } else if (request.persistMemory !== false) {
        try {
          const memStore =
            this.dependencies.memoryStore !== undefined
              ? this.dependencies.memoryStore
              : MemoryStore.getInstance();
          if (memStore) {
            const summarySnippet = fullReport.length > 250 ? fullReport.slice(0, 245) + '…' : fullReport;
            const taskSnippet = taskText.slice(0, 120);
            memStore.addFact(
              `[Subagent @${label}] Task: "${taskSnippet}" -> Report: ${relPath}. Summary: ${summarySnippet}`,
              'agent',
              { summary: `Subagent @${label}: ${taskText.slice(0, 50)}` }
            );
          }
        } catch {
          // Memory logging failures must not fail subagent execution
        }
      }

      // 11. Optional AgentResult parsing when requested
      let agentResult: AgentResult | undefined;
      if (request.expectAgentResult) {
        agentResult = safeParseAgentResult(result);
      }

      if (onEvent) {
        onEvent({
          type: 'subagent_end',
          name: label,
          success: true,
          output: result,
          agentLabel: label,
        });
      }

      return {
        success: true,
        output: result,
        agentLabel: label,
        roleName,
        reportPath: relPath,
        stats: capturedStats,
        agentResult,
      };
    } catch (err: any) {
      if (onEvent) {
        onEvent({
          type: 'subagent_end',
          name: label,
          success: false,
          output: err.message,
          agentLabel: label,
        });
      }

      if (request.throwOnError) {
        throw err;
      }

      let failedAgentResult: AgentResult | undefined;
      if (request.expectAgentResult) {
        failedAgentResult = createFailedFallback(
          `Child agent execution failed: ${err.message}`,
          [`Execution error: ${err.message}`]
        );
      }

      return {
        success: false,
        output: err.message,
        agentLabel: label,
        roleName,
        reportPath: '',
        stats: capturedStats,
        agentResult: failedAgentResult,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}

/** Factory to create a subagent runner with the given dependencies. */
export function createSubagentRunner(dependencies: SubagentRunnerDependencies): ISubagentRunner {
  return new DefaultSubagentRunner(dependencies);
}
