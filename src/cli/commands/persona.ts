import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import chalk from 'chalk';
import { logSink } from '../../core/logSink';

/**
 * `/agent` command: character and active persona switcher.
 */
export async function handleAgent(ctx: CommandCtx, arg: string): Promise<void> {
  const availableChars = ctx.listAvailableCharacters();

  if (arg) {
    const target = arg.trim().toLowerCase().replace(/^@/, '');
    const found = availableChars.find(
      (c) => c.name.toLowerCase() === target || c.aiName.toLowerCase() === target || c.displayName.toLowerCase() === target
    );

    if (!found) {
      CLITheme.error(`Character/Agent '${arg}' not found.`);
      logSink.log(chalk.gray(`Available: ${availableChars.map((c) => c.displayName).join(', ')}`));
      return;
    }

    ctx.configManager.setActiveCharacter(found.name);
    ctx.agent.current = ctx.recreateAgent();
    CLITheme.success(`Active agent: ${chalk.green(found.displayName)} (${chalk.yellow(found.aiName)})`);
    CLITheme.info(`Role: ${chalk.cyan(found.role)} · Style: ${chalk.gray(found.trait)}`);
    return;
  }

  const currentCharName = ctx.configManager.getActiveCharacter();
  const currentChar = ctx.loadCharacter(currentCharName);

  logSink.log(chalk.bold('\n👤 Agent Configuration'));
  if (currentChar) {
    logSink.log(`  • Active:      ${chalk.green(currentChar.displayName)} (${chalk.yellow(currentChar.aiName)})`);
    logSink.log(`  • Role:        ${chalk.cyan(currentChar.role)}`);
    logSink.log(`  • Style:       ${chalk.gray(currentChar.trait)}`);
    logSink.log(`  • Description: ${chalk.white(currentChar.description)}`);
  }
  logSink.log('');

  const menuOptions = availableChars.map((c) => ({
    title: `${c.displayName.padEnd(16)} [${c.role}] - ${c.description}`,
    value: c.name
  }));

  const selected = await InteractiveMenu.select<string>(
    'Select agent to activate (use arrow keys):',
    menuOptions,
    currentCharName
  );

  if (selected) {
    ctx.configManager.setActiveCharacter(selected);
    ctx.agent.current = ctx.recreateAgent();
    const selectedCharObj = ctx.loadCharacter(selected);
    if (selectedCharObj) {
      CLITheme.success(`Active agent switched to: ${chalk.green(selectedCharObj.displayName)} (${chalk.yellow(selectedCharObj.aiName)})`);
    }
  }
}
