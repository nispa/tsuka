import { ConfigManager } from '../../core/config';
import { ILLMProvider } from '../../core/provider';
import { ToolRegistry } from '../../tools/registry';
import { PermissionManager } from '../../safety/permissions';
import { Agent } from '../../core/agent';
import { RoleConfig, TraitConfig, CharacterConfig, TeamConfig } from '../index';

/**
 * Contesto condiviso passato a ogni handler dei comandi slash.
 * provider è tipato sull'interfaccia minima ILLMProvider (non sulla classe concreta
 * LLMProvider) proprio per permettere di iniettare un MockLLMProvider nei test di
 * team.ts/goal.ts senza toccare il comportamento reale (vedi tests/mocks/).
 */
export interface CommandCtx {
  configManager: ConfigManager;
  provider: ILLMProvider;
  registry: ToolRegistry;
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
}

export type CommandHandler = (
  ctx: CommandCtx,
  arg: string
) => Promise<void>;
