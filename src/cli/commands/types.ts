import { ConfigManager } from '../../core/config';
import { ChatStats, ILLMProvider } from '../../core/provider';
import { IToolRegistry } from '../../tools/registry';
import { PermissionManager } from '../../safety/permissions';
import { Agent } from '../../core/agent';
import { AgentEventHandler } from '../../core/agentEvents';
import { StreamChannel } from '../../core/thinkParser';
import { RoleConfig, TraitConfig, CharacterConfig } from '../../core/personas';
import { TeamConfig } from '../../core/types';
import { GenerationInterrupt } from '../interrupt';

/** Optional presentation sink used when CLI workflows run inside another UI. */
export interface WorkflowEventSink {
  onChunk: (chunk: string, channel?: StreamChannel, authorName?: string) => void;
  onStats: (stats: ChatStats, agentLabel?: string) => void;
  onEvent: AgentEventHandler;
  /** Announces the agents concurrently active in a workflow group. */
  onParallelStart?: (agentNames: string[]) => void;
  /** Clears the concurrent-workflow presentation state after the group settles. */
  onParallelEnd?: () => void;
  reset: () => void;
}

/**
 * Shared context passed to every slash command handler.
 */
export interface CommandCtx {
  configManager: ConfigManager;
  provider: ILLMProvider;
  registry: IToolRegistry;
  permissionManager: PermissionManager;
  agent: { current: Agent };
  availableModels: { current: string[] };
  recreateAgent: () => Agent;
  loadRole: (name?: string) => RoleConfig;
  loadTrait: (name?: string) => TraitConfig;
  loadCharacter: (name: string) => CharacterConfig | null;
  loadTeam: (name: string) => TeamConfig | null;
  listAvailableCharacters: () => CharacterConfig[];
  listAvailableItems: <T>(dirName: string, loadFn: (name: string) => T | null) => T[];
  workflowEvents?: WorkflowEventSink;
  /** Optional presentation-owned interrupt shared with a long-running workflow. */
  interrupt?: GenerationInterrupt;
}

export type CommandHandler = (
  ctx: CommandCtx,
  arg: string
) => Promise<void>;
