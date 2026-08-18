/**
 * Slash command dispatcher for the TUI.
 * Parses the line, looks the command up in the registry (`src/tui/commands/`)
 * and runs it: the behaviour of each command lives with its entry in the table,
 * never here.
 */

import { findCommand, parseCommandLine } from '../commands/registry';
import { CommandControllerContext } from '../commands/types';

export { CommandControllerContext };

export class TuiCommandController {
  constructor(private ctx: CommandControllerContext) {}

  /**
   * Builds the CommandCtx the CLI implementations (/goal, /team, /call, …)
   * expect, so a TUI command can reuse them unchanged.
   */
  private getCommandCtx(): any {
    const { configManager, provider } = this.ctx;
    const { listAvailableCharacters, loadCharacter, loadRole, loadTrait, loadTeam, listAvailableItems } = require('../../cli/shared');
    return {
      configManager,
      provider,
      registry: this.ctx.registry || (this.ctx.getAgent() as any).registry,
      permissionManager: this.ctx.permissionManager || (this.ctx.getAgent() as any).permissionManager,
      listAvailableCharacters,
      loadCharacter,
      loadRole,
      loadTrait,
      loadTeam,
      listAvailableItems,
      isTui: true,
      agent: { current: this.ctx.getAgent() },
      availableModels: { current: [] },
      recreateAgent: () => this.ctx.recreateAgent(),
    };
  }

  async handleCommand(commandStr: string): Promise<void> {
    const { cmd, arg } = parseCommandLine(commandStr);
    const spec = findCommand(cmd);

    if (!spec) {
      this.ctx.store.addMessage({
        role: 'system',
        content: `Unknown command: \`${cmd}\`. Type \`/help\` or press F12 to see all commands.`,
      });
      return;
    }

    await spec.run({
      ...this.ctx,
      cmd,
      arg,
      run: (next: string) => this.handleCommand(next),
      cliContext: () => this.getCommandCtx(),
    });
  }
}
