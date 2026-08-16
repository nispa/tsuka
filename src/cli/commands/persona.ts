import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import chalk from 'chalk';
import { logSink } from '../../core/logSink';

/**
 * Comando `/agent`: gestore unificato dell'agente attivo.
 * Permette di selezionare o commutare il profilo agente/personaggio attivo.
 */
export async function handleAgent(ctx: CommandCtx, arg: string): Promise<void> {
  const availableChars = ctx.listAvailableCharacters();

  if (arg) {
    const target = arg.trim().toLowerCase().replace(/^@/, '');
    const found = availableChars.find(
      (c) => c.name.toLowerCase() === target || c.aiName.toLowerCase() === target || c.displayName.toLowerCase() === target
    );

    if (!found) {
      CLITheme.error(`Personaggio/Agente '${arg}' non trovato.`);
      logSink.log(chalk.gray(`Disponibili: ${availableChars.map((c) => c.displayName).join(', ')}`));
      return;
    }

    ctx.configManager.setActiveCharacter(found.name);
    ctx.agent.current = ctx.recreateAgent();
    CLITheme.success(`Agente attivo: ${chalk.green(found.displayName)} (${chalk.yellow(found.aiName)})`);
    CLITheme.info(`Ruolo: ${chalk.cyan(found.role)} · Stile: ${chalk.gray(found.trait)}`);
    return;
  }

  const currentCharName = ctx.configManager.getActiveCharacter();
  const currentChar = ctx.loadCharacter(currentCharName);

  logSink.log(chalk.bold('\n👤 Configurazione Agente'));
  if (currentChar) {
    logSink.log(`  • Attivo:      ${chalk.green(currentChar.displayName)} (${chalk.yellow(currentChar.aiName)})`);
    logSink.log(`  • Ruolo:       ${chalk.cyan(currentChar.role)}`);
    logSink.log(`  • Stile:       ${chalk.gray(currentChar.trait)}`);
    logSink.log(`  • Descrizione: ${chalk.white(currentChar.description)}`);
  }
  logSink.log('');

  const menuOptions = availableChars.map((c) => ({
    title: `${c.displayName.padEnd(16)} [${c.role}] - ${c.description}`,
    value: c.name
  }));

  const selected = await InteractiveMenu.select<string>(
    'Seleziona l\'agente da attivare (usa le frecce):',
    menuOptions,
    currentCharName
  );

  if (selected) {
    ctx.configManager.setActiveCharacter(selected);
    ctx.agent.current = ctx.recreateAgent();
    const selectedCharObj = ctx.loadCharacter(selected);
    if (selectedCharObj) {
      CLITheme.success(`Agente attivo cambiato a: ${chalk.green(selectedCharObj.displayName)} (${chalk.yellow(selectedCharObj.aiName)})`);
    }
  }
}
