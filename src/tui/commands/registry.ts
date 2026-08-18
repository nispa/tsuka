/**
 * The TUI slash command table.
 *
 * Adding a command means adding one entry to a list — the dispatcher
 * (`TuiCommandController.handleCommand`) never needs to change. Aliases live
 * with their command instead of being scattered across conditions, so the
 * slash menu (`commands/menu.json`) can be checked against this table
 * (see `assertMenuCoverage`).
 */

import menuData from './menu.json';
import { TuiCommandSpec } from './types';
import { SESSION_COMMANDS } from './sessionCommands';
import { WORKFLOW_COMMANDS } from './workflowCommands';
import { CONFIG_COMMANDS } from './configCommands';

export const TUI_COMMANDS: TuiCommandSpec[] = [
  ...SESSION_COMMANDS,
  ...WORKFLOW_COMMANDS,
  ...CONFIG_COMMANDS,
];

/** Every accepted spelling — canonical names and aliases — pointing at its command. */
const BY_NAME: Map<string, TuiCommandSpec> = new Map(
  TUI_COMMANDS.flatMap((spec) => [spec.name, ...(spec.aliases || [])].map((n) => [n, spec] as [string, TuiCommandSpec]))
);

export function findCommand(name: string): TuiCommandSpec | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** Splits '/team devs "ship it"' into its command name and its argument. */
export function parseCommandLine(commandStr: string): { cmd: string; arg: string } {
  const trimmed = commandStr.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) return { cmd: trimmed.toLowerCase(), arg: '' };
  return {
    cmd: trimmed.slice(0, firstSpace).toLowerCase(),
    arg: trimmed.slice(firstSpace + 1).trim(),
  };
}

/**
 * Consistency between the menu shown to the user (`commands/menu.json`) and the
 * commands that actually run. Returns the mismatches instead of throwing, so a
 * test can report them all at once.
 */
export function assertMenuCoverage(): { menuWithoutHandler: string[]; handlerWithoutMenu: string[] } {
  const menuNames = (menuData as Array<{ command: string }>).map((e) => e.command.trim().toLowerCase());
  const menuSet = new Set(menuNames);

  return {
    menuWithoutHandler: menuNames.filter((name) => !BY_NAME.has(name)),
    handlerWithoutMenu: TUI_COMMANDS.filter((s) => !s.hidden && !menuSet.has(s.name)).map((s) => s.name),
  };
}
