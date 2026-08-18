/**
 * Contract of a TUI slash command.
 * The dispatcher owns the parsing and the lookup; every command is a plain
 * function over a context, so the command list stays a data table
 * (see `registry.ts`) instead of a chain of conditionals.
 */

import { TuiStore } from '../store';
import { ConfigManager } from '../../core/config';
import { ILLMProvider } from '../../core/provider';
import { Agent } from '../../core/agent';
import { TuiLayoutConfig } from '../layoutConfig';
import { ToolRegistry } from '../../tools/registry';
import { PermissionManager } from '../../safety/permissions';

/**
 * Everything a command may need from the application.
 * Declared here (and not in the controller) so the command table does not
 * depend on its dispatcher.
 */
export interface CommandControllerContext {
  store: TuiStore;
  configManager: ConfigManager;
  provider: ILLMProvider;
  registry?: ToolRegistry;
  permissionManager?: PermissionManager;
  layoutConfig: TuiLayoutConfig;
  getAgent: () => Agent;
  setAgent: (a: Agent) => void;
  recreateAgent: () => Agent;
  syncState: () => void;
  probeContextWindow: () => Promise<void>;
  setActiveTab: (tab: 'chat' | 'tools') => void;
  getTurnRunner?: () => any;
  stopApp: () => void;
}

export interface TuiCommandContext extends CommandControllerContext {
  /** Command name as typed, alias included (e.g. '/save' for '/export'). */
  cmd: string;
  /** Everything after the command name, already trimmed of the leading space. */
  arg: string;
  /** Re-runs the dispatcher: used by menus that pick another command. */
  run: (commandStr: string) => Promise<void>;
  /** Builds the CommandCtx expected by the CLI command implementations. */
  cliContext: () => any;
}

export interface TuiCommandSpec {
  /** Canonical name, with the leading slash (e.g. '/export'). */
  name: string;
  /** Alternative spellings accepted for the same behaviour. */
  aliases?: string[];
  /** One-line description, used by the coverage test and by future help renderers. */
  description: string;
  /** Commands kept out of the slash menu (aliases, power-user commands). */
  hidden?: boolean;
  run: (c: TuiCommandContext) => void | Promise<void>;
}
