import { getModelProfile } from '../core/modelProfile';
import type { ProviderClass } from '../core/cloudProvider';
import type { ReasoningEffort } from '../core/provider';
import type { ModelCapabilityTier, Tool, ToolSchemaData } from './types';
import { WorkflowScope } from '../core/workflowScope';

export const TIER_HIERARCHY: Record<ModelCapabilityTier, number> = {
  small: 1,
  medium: 2,
  large: 3,
};

export const LARGE_MODEL_PATTERNS = ['gpt-', 'claude-', 'gemini-', 'meta-llama/llama-3.3-70b', 'deepseek-'];

export const WORKFLOW_ESCALATION_TOOLS = new Set(['request_goal', 'request_team', 'request_call']);

export const NATIVE_FUNCTION_CALLING_THRESHOLD = 0.9;

/**
 * CLOUD providers receive the full tool tier without a local capability sweep.
 * The classification comes from providers.json, never URL or model-name heuristics.
 */

/**
 * Resolves the model capability tier (small, medium, large).
 * Uses measured benchmark capability fingerprinting if available;
 * otherwise falls back to model name heuristics.
 */
export function getModelTier(
  modelName: string,
  effort?: ReasoningEffort,
  _providerBaseUrl?: string,
  providerClass: ProviderClass = 'LOCAL'
): ModelCapabilityTier {
  if (providerClass === 'CLOUD') {
    return 'large';
  }

  const profile = getModelProfile(modelName, effort);
  if (profile) {
    return profile.tier;
  }

  const lower = modelName.toLowerCase();
  if (LARGE_MODEL_PATTERNS.some((p) => lower.includes(p))) {
    return 'large';
  }

  const match = lower.match(/(\d+)b/);
  if (match) {
    const size = parseInt(match[1], 10);
    return size <= 12 ? 'small' : size <= 35 ? 'medium' : 'large';
  }

  return 'small';
}

/**
 * Checks whether the model possesses reliably measured native function calling capability (T8.9).
 */
export function hasNativeFunctionCalling(modelName: string, effort?: ReasoningEffort): boolean {
  const profile = getModelProfile(modelName, effort);
  return !!profile && profile.scores.toolCalling >= NATIVE_FUNCTION_CALLING_THRESHOLD;
}

/**
 * Evaluates whether a given tool is permitted and capable of being listed for the LLM.
 */
export function isToolEligibleForLLM(
  tool: Tool,
  schemaData: ToolSchemaData,
  currentTierLevel: number,
  allowedTools?: string[],
  alwaysAllow?: Set<string>
): boolean {
  if (allowedTools && !allowedTools.includes(tool.name) && !alwaysAllow?.has(tool.name)) {
    return false;
  }

  const requiredTierLevel = TIER_HIERARCHY[schemaData.requiredTier || 'small'];
  if (currentTierLevel < requiredTierLevel) {
    return false;
  }

  if (WorkflowScope.isInsideWorkflow() && WORKFLOW_ESCALATION_TOOLS.has(tool.name)) {
    return false;
  }

  return true;
}
