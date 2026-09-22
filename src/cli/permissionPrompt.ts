import prompts from 'prompts';
import chalk from 'chalk';
import { logSink } from '../core/logSink';
import type { PermissionPromptHandler } from '../safety/permissions';
import { InteractiveMenu } from './ui';

/** Creates the terminal-owned renderer for permission decisions. */
export function createCliPermissionPromptHandler(): PermissionPromptHandler {
  return async ({ toolName, details, riskLevel, requesterLabel }) => {
    const who = requesterLabel ? ` (${requesterLabel})` : '';

    if (riskLevel === 'RESTRICTED') {
      const isDelete = toolName === 'delete_file';
      const promptTitle = isDelete
        ? `\n🛡️  [Authorization Request]${who} The agent requests file deletion:`
        : `\n🛡️  [Authorization Request]${who} The agent requests modification tool:`;
      logSink.log(chalk.yellow(promptTitle));
      logSink.log(`   Tool: ${chalk.cyan(toolName)}`);
      logSink.log(`   Action: ${chalk.white(details)}`);

      const options = isDelete
        ? [
            { title: 'Approve deletion this time (y)', value: 'yes' as const },
            { title: 'Deny deletion this time (n)', value: 'no' as const },
          ]
        : [
            { title: 'Approve this time (y)', value: 'yes' as const },
            { title: 'Deny this time (n)', value: 'no' as const },
            { title: 'Always approve for this session (a)', value: 'always' as const },
          ];

      const decision = await InteractiveMenu.select<'yes' | 'no' | 'always'>(
        'Choose how to proceed:',
        options,
        isDelete ? 'no' : 'yes'
      );
      const resolvedDecision = decision ?? 'no';
      if (resolvedDecision === 'always') logSink.log(chalk.green('✔ Write permission granted for the rest of the session.'));
      if (resolvedDecision === 'no') logSink.log(chalk.red('✘ Operation denied by user.'));
      return resolvedDecision;
    }

    logSink.log(chalk.red.bold(`\n⚠️  [CRITICAL AUTHORIZATION REQUIRED]${who} The agent requests system command execution:`));
    logSink.log(`   Command: ${chalk.yellow(details)}`);
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: chalk.red('Do you want to allow execution?'),
      initial: false,
    });
    logSink.log(response.confirm ? chalk.green('✔ Command authorized.') : chalk.red('✘ Command rejected.'));
    return response.confirm ? 'yes' : 'no';
  };
}
