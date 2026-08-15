/**
 * Costruisce un CommandCtx minimo per testare team.ts/goal.ts senza REPL interattiva
 * (T1.2, PLANNING-QUALITA.md). Usa i loader reali di shared.ts (roles/traits/
 * characters/teams sono asset di progetto statici, non serve fingerli) e un
 * MockLLMProvider al posto del provider reale. Possibile solo perché CommandCtx.provider
 * è tipato su ILLMProvider (T1.1): LLMProvider non è strutturalmente compatibile
 * (membri privati), un MockLLMProvider sì.
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
  // Tool di protocollo (T2.1/T6.2): registrati sempre, come nella registry reale
  // (auto-discovery su src/tools/impl/). Servono a runMemberTurn/runOrchestrated/
  // runDiscussionRound per offrire report_status/route_next/cast_vote/post_note/
  // read_notes al modello.
  registry.register(reportStatusTool);
  registry.register(routeNextTool);
  registry.register(castVoteTool);
  registry.register(postNoteTool);
  registry.register(readNotesTool);
  const permissionManager = new PermissionManager();
  const configManager = new ConfigManager();
  // Non invocato dalle funzioni di modalità testate (solo dagli entry point
  // handleTeam/handleGoal a fine workflow): basta che soddisfi il tipo.
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
