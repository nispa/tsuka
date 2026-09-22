import * as fs from 'fs';
import { Tool, ToolExecutionContext } from '../registry';
import { ReasoningEffort } from '../../core/provider';
import { PermissionManager } from '../../safety/permissions';
import { resolveSafePath } from './utils';
import { capForContext } from '../../core/contextBudget';
import { SUBAGENT_DEFAULTS } from '../../core/constants';
import { createSubagentRunner, ISubagentRunner } from '../../core/subagentRunner';

const VALID_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];

export const spawnAgentTool: Tool = {
  name: 'spawn_agent',
  riskLevel: 'SAFE',
  execute: async (
    args: {
      task?: string;
      briefingFile?: string;
      roleName?: string;
      traitName?: string;
      charName?: string;
      reasoningEffort?: string;
    },
    context?: ToolExecutionContext
  ) => {
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
      const briefingContent = fs.readFileSync(fullPath, 'utf-8').trim();
      if (!briefingContent) {
        throw new Error(`Briefing file '${briefingFileArg}' is empty.`);
      }
      if (briefingContent.length > SUBAGENT_DEFAULTS.maxBriefingFileLength) {
        throw new Error(
          `Briefing file '${briefingFileArg}' is too long: ${briefingContent.length} characters ` +
            `(limit ${SUBAGENT_DEFAULTS.maxBriefingFileLength}). Split into multiple spawn_agent calls with distinct briefings.`
        );
      }
      task = inlineTask ? `${inlineTask}\n\n${briefingContent}` : briefingContent;
    } else {
      task = inlineTask;
      if (!task) throw new Error("Please specify a task for the sub-agent ('task', or 'briefingFile' for a long briefing).");
      if (task.length > SUBAGENT_DEFAULTS.maxTaskLength) {
        throw new Error(
          `Task description too long: ${task.length} characters (limit ${SUBAGENT_DEFAULTS.maxTaskLength}). ` +
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

    const runner: ISubagentRunner =
      (context as any)?.subagentRunner ??
      createSubagentRunner({
        provider,
        registry,
        permissionManager,
      });

    const runResult = await runner.run(
      {
        task,
        roleName: args.roleName,
        traitName: args.traitName,
        charName: args.charName,
        reasoningEffort: reasoningEffortOverride,
        throwOnError: true,
      },
      {
        onChunk: context?.onChunk,
        onStats: context?.onStats,
        onEvent: context?.onEvent,
        signal: context?.signal,
      }
    );

    const output = `[SUB-AGENT: ${runResult.agentLabel}] Execution completed (full report saved in '${runResult.reportPath}'):\n\n${runResult.output}`;
    return capForContext(output, undefined, {
      label: `Subagent @${runResult.agentLabel} report`,
      recoveryHint: `Full output saved in '${runResult.reportPath}', readable via read_file.`,
    });
  },
};
