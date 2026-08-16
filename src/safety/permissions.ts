import prompts from 'prompts';
import chalk from 'chalk';
import { InteractiveMenu } from '../cli/ui';

export type RiskLevel = 'SAFE' | 'RESTRICTED' | 'DANGEROUS';

export class PermissionManager {
  private allowAllWrite: boolean = false;
  // Internal promise chain (T3.1): requests triggering interactive prompts
  // (RESTRICTED/DANGEROUS) are queued sequentially rather than colliding on stdin.
  private promptQueue: Promise<void> = Promise.resolve();

  constructor() {}

  /** Resets permission state for a new session. */
  resetSession(): void {
    this.allowAllWrite = false;
  }

  /**
   * Toggles auto-approval of file modifications/writes (RESTRICTED).
   * Useful for autonomous /goal or /team workflows within the workspace jail.
   */
  setAllowAllWrite(allow: boolean): void {
    this.allowAllWrite = allow;
  }

  isAllowAllWrite(): boolean {
    return this.allowAllWrite;
  }

  /**
   * Enqueues `task` after any ongoing interactive prompt.
   * Ensures prompt order is preserved and subsequent requests are not blocked by a single rejection.
   */
  private enqueuePrompt<T>(task: () => Promise<T>): Promise<T> {
    const result = this.promptQueue.then(task, task);
    this.promptQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Verifies if the agent has permission to execute a tool.
   * @param toolName Name of requested tool
   * @param details Operation details (e.g. target path or command)
   * @param riskLevel Risk classification of tool
   * @param requesterLabel Requesting agent label displayed in interactive prompts
   * @returns Boolean indicating authorization
   */
  async checkPermission(toolName: string, details: string, riskLevel: RiskLevel, requesterLabel?: string): Promise<boolean> {
    if (riskLevel === 'SAFE') {
      return true;
    }
    return this.enqueuePrompt(() => this.promptForDecision(toolName, details, riskLevel, requesterLabel));
  }

  private async promptForDecision(toolName: string, details: string, riskLevel: RiskLevel, requesterLabel?: string): Promise<boolean> {
    const who = requesterLabel ? ` (${requesterLabel})` : '';

    if (riskLevel === 'RESTRICTED') {
      if (this.allowAllWrite) {
        return true;
      }

      console.log(chalk.yellow(`\n🛡️  [Authorization Request]${who} The agent requests modification tool:`));
      console.log(`   Tool: ${chalk.cyan(toolName)}`);
      console.log(`   Action: ${chalk.white(details)}`);

      const decision = await InteractiveMenu.select<string>(
        'Choose how to proceed:',
        [
          { title: 'Approve this time (y)', value: 'yes' },
          { title: 'Deny this time (n)', value: 'no' },
          { title: 'Always approve for this session (a)', value: 'always' }
        ],
        'yes'
      );

      if (decision === 'yes') {
        return true;
      } else if (decision === 'always') {
        this.allowAllWrite = true;
        console.log(chalk.green('✔ Write permission granted for the rest of the session.'));
        return true;
      } else {
        console.log(chalk.red('✘ Operation denied by user.'));
        return false;
      }
    }

    if (riskLevel === 'DANGEROUS') {
      console.log(chalk.red.bold(`\n⚠️  [CRITICAL AUTHORIZATION REQUIRED]${who} The agent requests system command execution:`));
      console.log(`   Command: ${chalk.yellow(details)}`);

      const response = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: chalk.red('Do you want to allow execution?'),
        initial: false
      });

      if (response.confirm) {
        console.log(chalk.green('✔ Command authorized.'));
        return true;
      } else {
        console.log(chalk.red('✘ Command rejected.'));
        return false;
      }
    }

    return false;
  }
}
