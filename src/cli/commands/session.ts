import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import chalk from 'chalk';

export async function handleExit(_ctx: CommandCtx, _arg: string): Promise<void> {
  console.log(chalk.yellow('Uscita in corso... Arrivederci!'));
  process.exit(0);
}

export async function handleInfo(ctx: CommandCtx, _arg: string): Promise<void> {
  const charName = ctx.configManager.getActiveCharacter();
  const char = ctx.loadCharacter(charName);
  console.log(chalk.bold('\nInformazioni di Sessione:'));
  console.log(`- Provider Attivo: ${chalk.green(ctx.configManager.getActiveProviderName().toUpperCase())}`);
  console.log(`- Endpoint Server: ${chalk.cyan(ctx.provider.getBaseUrl())}`);
  console.log(`- Modello Attivo:  ${chalk.green(ctx.provider.getCurrentModel())}`);
  if (char) {
    console.log(`- Personaggio:     ${chalk.green(char.displayName)} (${chalk.yellow(char.aiName)})`);
    console.log(`  └─ Ruolo collegato:  ${char.role}`);
    console.log(`  └─ Tratto collegato: ${char.trait}`);
  } else {
    console.log(`- Ruolo Agente:    ${chalk.green(ctx.loadRole(ctx.configManager.getActiveRole()).displayName)}`);
    console.log(`- Attitudine:      ${chalk.green(ctx.loadTrait(ctx.configManager.getActiveTrait()).displayName)}`);
  }
  console.log();
}

export async function handleReset(ctx: CommandCtx, _arg: string): Promise<void> {
  ctx.agent.current = ctx.recreateAgent();
  ctx.permissionManager.resetSession();
  CLITheme.success('Sessione resettata con successo (cronologia e autorizzazioni azzerate).');
}
