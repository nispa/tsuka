import * as fs from 'fs';
import { homePath } from '../../core/apphome';
import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import chalk from 'chalk';
import { RoleConfig, TraitConfig } from '../index';

export async function handleCharacter(ctx: CommandCtx, _arg: string): Promise<void> {
  const availableChars = ctx.listAvailableCharacters();

  const menuOptions = [
    ...availableChars.map((c) => ({
      title: `${c.displayName} [Ruolo: ${c.role} | Stile: ${c.trait}] - ${c.description}`,
      value: c.name
    })),
    { title: '⚙️ Modalità Personalizzata (Usa ruolo e attitudine impostati singolarmente)', value: 'custom' }
  ];

  const currentCharName = ctx.configManager.getActiveCharacter();
  console.log();
  const selected = await InteractiveMenu.select<string>(
    'Seleziona il personaggio da attivare (usa le frecce):',
    menuOptions,
    currentCharName
  );

  if (selected) {
    ctx.configManager.setActiveCharacter(selected);
    ctx.agent.current = ctx.recreateAgent();

    if (selected === 'custom') {
      CLITheme.success('Passato a modalità personalizzata (ruolo e attitudine slegati).');
    } else {
      const selectedCharObj = ctx.loadCharacter(selected);
      if (selectedCharObj) {
        CLITheme.success(`Personaggio attivo cambiato a: ${chalk.green(selectedCharObj.displayName)} (${chalk.yellow(selectedCharObj.aiName)})`);
      }
    }
  }
}

export async function handleRenameChar(ctx: CommandCtx, arg: string): Promise<void> {
  const charName = ctx.configManager.getActiveCharacter();
  if (charName === 'custom') {
    CLITheme.error('Impossibile rinominare in modalità personalizzata (seleziona prima un personaggio con /character).');
    return;
  }
  if (!arg) {
    CLITheme.error('Specificare il nuovo nome per il personaggio. Es: /rename-char Carlo');
    return;
  }

  try {
    const charPath = homePath('characters', `${charName}.json`);
    if (fs.existsSync(charPath)) {
      const raw = fs.readFileSync(charPath, 'utf-8');
      const data = JSON.parse(raw) as any;
      const oldName = data.aiName;
      data.aiName = arg;
      fs.writeFileSync(charPath, JSON.stringify(data, null, 2), 'utf-8');
      ctx.agent.current = ctx.recreateAgent();
      CLITheme.success(`Personaggio '${data.displayName}' rinominato da '${oldName}' a '${chalk.green(arg)}'!`);
    }
  } catch (err: any) {
    CLITheme.error(`Errore nel rinominare il personaggio: ${err.message}`);
  }
}

export async function handleRole(ctx: CommandCtx, _arg: string): Promise<void> {
  const availableRoles = ctx.listAvailableItems<RoleConfig>('roles', ctx.loadRole);

  if (availableRoles.length === 0) {
    CLITheme.warning('Nessun ruolo configurato trovato nella cartella roles/.');
    return;
  }

  const currentRoleName = ctx.configManager.getActiveRole();
  console.log();
  const selectedRoleName = await InteractiveMenu.select<string>(
    "Seleziona il ruolo attivo dell'agente (usa le frecce):",
    availableRoles.map((r) => ({
      title: `${r.displayName} - ${r.description}${r.name === currentRoleName ? ' (selezionato)' : ''}`,
      value: r.name,
    })),
    currentRoleName
  );

  if (selectedRoleName) {
    ctx.configManager.setActiveCharacter('custom');
    ctx.configManager.setActiveRole(selectedRoleName);
    ctx.agent.current = ctx.recreateAgent();
    const roleObj = ctx.loadRole(selectedRoleName);
    CLITheme.success(`Ruolo dell'agente cambiato a: ${chalk.green(roleObj.displayName)} (Selezionato stile manuale)`);
    CLITheme.info(`Tool abilitati per questo ruolo: ${chalk.cyan(roleObj.allowedTools.join(', '))}`);
  }
}

export async function handleTrait(ctx: CommandCtx, _arg: string): Promise<void> {
  const availableTraits = ctx.listAvailableItems<TraitConfig>('traits', ctx.loadTrait);

  if (availableTraits.length === 0) {
    CLITheme.warning('Nessun tratto caratteriale trovato nella cartella traits/.');
    return;
  }

  const currentTraitName = ctx.configManager.getActiveTrait();
  console.log();
  const selectedTraitName = await InteractiveMenu.select<string>(
    "Seleziona il tratto caratteriale / attitudine dell'agente (usa le frecce):",
    availableTraits.map((t) => ({
      title: `${t.displayName} - ${t.description}${t.name === currentTraitName ? ' (selezionato)' : ''}`,
      value: t.name,
    })),
    currentTraitName
  );

  if (selectedTraitName) {
    ctx.configManager.setActiveCharacter('custom');
    ctx.configManager.setActiveTrait(selectedTraitName);
    ctx.agent.current = ctx.recreateAgent();
    const traitObj = ctx.loadTrait(selectedTraitName);
    CLITheme.success(`Attitudine dell'agente cambiata a: ${chalk.green(traitObj.displayName)} (Selezionato stile manuale)`);
  }
}
