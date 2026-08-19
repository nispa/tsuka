import { ConfigManager } from './config';

/**
 * Deferred tools (T14.14).
 *
 * Almost all of the fixed prompt cost lives in the tool schemas: for the
 * `developer` role that is ~3.8k of ~4.3k tokens, resent on EVERY round of the
 * ReAct loop (`Agent.run`). Most of those schemas describe tools a typical
 * session never calls.
 *
 * A role may therefore declare `coreTools`: the subset of `allowedTools` whose
 * full schema is always sent. Everything else becomes "deferred" — the model
 * only sees its NAME in the system prompt and activates it through `load_tools`
 * when it is actually needed. The security perimeter is unchanged: only what the
 * role already allowed can ever be activated.
 *
 * A role without `coreTools` behaves exactly as before (nothing deferred, no
 * `load_tools` offered).
 */

/** Name of the meta-tool that promotes deferred tools to active ones. */
export const LOAD_TOOLS_TOOL = 'load_tools';

/** The part of RoleConfig needed to compute the split. */
export interface ToolSetSource {
  allowedTools?: string[];
  coreTools?: string[];
}

export interface ResolveToolSetOptions {
  /**
   * Tools the calling context grants on top of the role and never defers, because the
   * context itself depends on them (coordination protocol in /team, blackboard in a
   * workflow, memory for sub-agents). Deferring these would mean asking the model to
   * load a tool it is being ordered to call.
   */
  alwaysActive?: string[];
  /** Overrides the `deferredToolsEnabled` config flag (tests). */
  enabled?: boolean;
}

export interface ResolvedToolSet {
  /** Tools sent to the model on every round (full schema). */
  active: string[];
  /** Tools available on demand via `load_tools` (name only in the prompt). */
  deferred: string[];
}

function unique(names: string[]): string[] {
  return Array.from(new Set(names));
}

/**
 * Splits the tools a context grants into an active set and a deferred one.
 * Always returns fresh arrays: callers may mutate them without touching the role.
 */
export function resolveToolSet(
  role: ToolSetSource | null | undefined,
  options: ResolveToolSetOptions = {}
): ResolvedToolSet {
  const alwaysActive = options.alwaysActive || [];
  const granted = unique([...(role?.allowedTools || []), ...alwaysActive]);
  const isEnabled =
    typeof options.enabled === 'boolean' ? options.enabled : new ConfigManager().getDeferredToolsEnabled();

  if (!isEnabled) {
    return { active: granted, deferred: [] };
  }

  // A `coreTools` entry naming a tool outside allowedTools must not widen the perimeter.
  const core = unique([...(role?.coreTools || []).filter((name) => granted.includes(name)), ...alwaysActive]);
  if ((role?.coreTools || []).length === 0) {
    return { active: granted, deferred: [] };
  }

  const deferred = granted.filter((name) => !core.includes(name));
  if (deferred.length === 0) {
    return { active: granted, deferred: [] };
  }

  return { active: [...core, LOAD_TOOLS_TOOL], deferred };
}
