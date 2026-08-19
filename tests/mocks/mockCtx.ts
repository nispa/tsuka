/**
 * Builds a minimal CommandCtx to test team.ts/goal.ts without the interactive REPL
 * (T1.2, PLANNING-QUALITA.md). Uses shared.ts's real loaders (roles/traits/
 * characters/teams are static project assets, no need to fake them) and a
 * MockLLMProvider in place of the real provider. Possible only because CommandCtx.provider
 * is typed on ILLMProvider (T1.1): LLMProvider is not structurally compatible
 * (private members), a MockLLMProvider is.
 */
import { ConfigManager } from '../../src/core/config';
import { ToolRegistry } from '../../src/tools/registry';
import { PermissionManager } from '../../src/safety/permissions';
import { Agent } from '../../src/core/agent';
import { CommandCtx } from '../../src/cli/commands/types';
import {
  loadRole,
  loadTrait,
  loadCharacter,
  loadTeam,
  listAvailableCharacters,
  listAvailableItems
} from '../../src/cli/shared';
import { MockLLMProvider } from './mockProvider';
import { reportStatusTool } from '../../src/tools/impl/reportStatus';
import { routeNextTool } from '../../src/tools/impl/routeNext';
import { castVoteTool } from '../../src/tools/impl/castVote';
import { postNoteTool } from '../../src/tools/impl/postNote';
import { readNotesTool } from '../../src/tools/impl/readNotes';

export function buildMockCtx(provider: MockLLMProvider): CommandCtx {
  const registry = new ToolRegistry();
  // Protocol tools (T2.1/T6.2): always registered, same as the real registry
  // (auto-discovery over src/tools/impl/). Needed by runMemberTurn/runOrchestrated/
  // runDiscussionRound to offer report_status/route_next/cast_vote/post_note/
  // read_notes to the model.
  registry.register(reportStatusTool);
  registry.register(routeNextTool);
  registry.register(castVoteTool);
  registry.register(postNoteTool);
  registry.register(readNotesTool);
  const permissionManager = new PermissionManager();
  const configManager = new ConfigManager();
  // Not invoked by the mode functions under test (only by the handleTeam/handleGoal
  // entry points at the end of a workflow): just needs to satisfy the type.
  const placeholderAgent = new Agent(provider, registry, permissionManager, 'placeholder');

  return {
    configManager,
    provider,
    registry,
    permissionManager,
    agent: { current: placeholderAgent },
    availableModels: { current: [] },
    recreateAgent: () => placeholderAgent,
    loadRole,
    loadTrait,
    loadCharacter,
    loadTeam,
    listAvailableCharacters,
    listAvailableItems
  };
}
