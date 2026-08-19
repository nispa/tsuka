import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Tool, ToolExecutionContext } from '../registry';
import { loadSystemPrompt, resolveCharacter, loadRole, loadTrait } from '../../cli/shared';
import { Agent } from '../../core/agent';
import { ReasoningEffort } from '../../core/provider';
import { ConfigManager } from '../../core/config';
import { PermissionManager } from '../../safety/permissions';
import { Blackboard } from '../../core/blackboard';
import { homePath } from '../../core/apphome';
import { withEffortPin, logEffortDivergence } from '../../core/effortControl';
import { resolveSafePath } from './utils';
import { MemoryStore } from '../../core/memory';
import { capForContext } from '../../core/contextBudget';
import { resolveToolSet } from '../../core/toolSet';

const MAX_TASK_LENGTH = 2000;
const MAX_BRIEFING_FILE_LENGTH = 12000;

const VALID_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'xhigh'];

export const spawnAgentTool: Tool = {
  name: 'spawn_agent',
  riskLevel: 'SAFE',
  execute: async (args: { task?: string; briefingFile?: string; roleName?: string; traitName?: string; charName?: string; reasoningEffort?: string }, context?: ToolExecutionContext) => {
    const inlineTask = (args.task || '').trim();
    const briefingFileArg = (args.briefingFile || '').trim();

    let task: string;
    if (briefingFileArg) {
      const fullPath = resolveSafePath(briefingFileArg);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Briefing file '${briefingFileArg}' does not exist. Write it first with 'write_file'.`);
      }
      if (fs.statSync(fullPath).isDirectory()) {
        throw new Error(`Path '${briefingFileArg}' is a directory, not a briefing file.`);
      }
      let briefingContent = fs.readFileSync(fullPath, 'utf-8').trim();
      if (!briefingContent) {
        throw new Error(`Briefing file '${briefingFileArg}' is empty.`);
      }
      if (briefingContent.length > MAX_BRIEFING_FILE_LENGTH) {
        throw new Error(
          `Briefing file '${briefingFileArg}' is too long: ${briefingContent.length} characters ` +
          `(limit ${MAX_BRIEFING_FILE_LENGTH}). Split into multiple spawn_agent calls with distinct briefings.`
        );
      }
      task = inlineTask ? `${inlineTask}\n\n${briefingContent}` : briefingContent;
    } else {
      task = inlineTask;
      if (!task) throw new Error("Please specify a task for the sub-agent ('task', or 'briefingFile' for a long briefing).");
      if (task.length > MAX_TASK_LENGTH) {
        throw new Error(
          `Task description too long: ${task.length} characters (limit ${MAX_TASK_LENGTH}). ` +
          `Do NOT truncate requirements silently. Either: ` +
          `(a) split into multiple focused spawn_agent calls; ` +
          `(b) write the full briefing with 'write_file' and pass its path via 'briefingFile'.`
        );
      }
    }

    let reasoningEffortOverride: ReasoningEffort | undefined;
    if (args.reasoningEffort !== undefined && args.reasoningEffort !== '') {
      const candidate = String(args.reasoningEffort).trim().toLowerCase();
      if (!VALID_REASONING_EFFORTS.includes(candidate as ReasoningEffort)) {
        throw new Error(
          `Invalid reasoningEffort: '${args.reasoningEffort}'. Allowed values: ${VALID_REASONING_EFFORTS.join(', ')}.`
        );
      }
      reasoningEffortOverride = candidate as ReasoningEffort;
    }

    const provider = context?.provider;
    if (!provider) throw new Error('Provider not available in execution context.');
    const registry = context?.registry;
    if (!registry) throw new Error('Registry not available in execution context.');
    const permissionManager = context?.permissionManager ?? new PermissionManager();

    const charName = (args.charName || '').trim().toLowerCase();
    const char = charName ? resolveCharacter(charName) : null;
    let roleName = (args.roleName || '').trim().toLowerCase() || 'developer';
    let traitName = (args.traitName || '').trim().toLowerCase() || 'professional';
    if (char) { roleName = char.role || char.activeRole || 'developer'; traitName = char.trait; }

    const roleObj = loadRole(roleName);
    const traitObj = loadTrait(traitName);
    const configManager = new ConfigManager();
    const label = char?.aiName || roleName;

    const blackboard = Blackboard.current();
    const memoryTools = ['save_memory', 'recall_memory'];
    const blackboardTools = blackboard ? ['post_note', 'read_notes'] : [];
    const toolSet = resolveToolSet(roleObj, { alwaysActive: [...memoryTools, ...blackboardTools] });

    const effectiveOverride = withEffortPin(reasoningEffortOverride);
    logEffortDivergence(label, effectiveOverride, configManager.getDefaultReasoningEffort());

    let sysPrompt = loadSystemPrompt(roleObj, traitObj, provider.getCurrentModel?.() || 'default', registry, char, task, effectiveOverride) +
      `\n\nThis is a subordinate sub-agent task. Complete the work and report results concisely.`;

    if (blackboard) {
      sysPrompt += `\n\nRUN BLACKBOARD: this task is part of an orchestrated workflow (/team or /goal). Use 'read_notes' to inspect previous notes or 'post_note' to record decisions/artifacts.`;
    }

    const subAgent = new Agent(
      provider, registry, permissionManager, sysPrompt, toolSet.active,
      configManager.getMaxHistoryMessages(), configManager.getMaxHistoryTokens(),
      label, undefined, undefined,
      configManager.getMaxToolRounds()
    );
    subAgent.setDeferredTools(toolSet.deferred);

    const onChunk = context?.onChunk;
    const onStats = context?.onStats;
    const onEvent = context?.onEvent;
    const signal = context?.signal;

    // Forward subagent chunks attributed to subagent label
    const subChunkHandler = onChunk
      ? (chunk: string, channel?: any) => {
          onChunk(chunk, channel, label);
        }
      : undefined;

    // Forward subagent token stats attributed to subagent label
    const subStatsHandler = onStats
      ? (stats: any) => {
          onStats(stats, label);
        }
      : undefined;

    // Forward subagent tool events tagged with subagent label
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
        task: task,
        agentLabel: label,
      });
    }

    let result: string;
    try {
      result = await subAgent.run(
        `Execute this task: ${task}`,
        subChunkHandler,
        subStatsHandler,
        subEventHandler,
        signal,
        effectiveOverride
      );

      if (onEvent) {
        onEvent({
          type: 'subagent_end',
          name: label,
          success: true,
          output: result,
          agentLabel: label,
        });
      }
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
      throw err;
    }

    const fullReport = result || '[no response]';

    const runKey = blackboard?.runId || crypto.randomUUID();
    const runDir = homePath('runs', runKey);
    fs.mkdirSync(runDir, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'subagent';
    const fileName = `${safeLabel}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.md`;
    const filePath = path.join(runDir, fileName);
    fs.writeFileSync(filePath, fullReport, 'utf-8');
    const relPath = path.join('runs', runKey, fileName);

    if (blackboard) {
      blackboard.post('artefatto-sub-agente', relPath, label);
    } else {
      try {
        const memStore = MemoryStore.getInstance();
        const summarySnippet = fullReport.length > 250 ? fullReport.slice(0, 245) + '…' : fullReport;
        memStore.addFact(`[Subagent @${label}] Task: "${task.slice(0, 120)}" -> Report: ${relPath}. Summary: ${summarySnippet}`, 'agent', {
          summary: `Subagent @${label}: ${task.slice(0, 50)}`,
        });
      } catch {}
    }

    const output = `[SUB-AGENT: ${label}] Execution completed (full report saved in '${relPath}'):\n\n${fullReport}`;
    return capForContext(output, undefined, {
      label: `Subagent @${label} report`,
      recoveryHint: `Full output saved in '${relPath}', readable via read_file.`
    });
  }
};
