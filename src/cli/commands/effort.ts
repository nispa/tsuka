import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import { getModelTier } from '../../tools/registry';
import { ReasoningEffort } from '../../core/provider';
import {
  getEffortPin, setEffortPin, isAskModeEnabled, setAskMode,
  describeEffortSource, describeToolDiff
} from '../../core/effortControl';

/**
 * `/effort` command: runtime control of reasoning effort.
 */

const VALID_LEVELS: ReasoningEffort[] = ['none', 'low', 'medium', 'xhigh'];

function activeRoleAndCharacter(ctx: CommandCtx) {
  const charName = ctx.configManager.getActiveCharacter();
  const char = ctx.loadCharacter(charName);
  const roleName = char ? char.role : ctx.configManager.getActiveRole();
  const role = ctx.loadRole(roleName);
  return { char, role };
}

function toolNamesAt(ctx: CommandCtx, allowedTools: string[] | undefined, effort: ReasoningEffort | undefined): string[] {
  return ctx.registry.listForLLM(ctx.provider.getCurrentModel(), allowedTools, effort)
    .map((t) => t.function.name)
    .sort();
}

function printStatus(ctx: CommandCtx): void {
  const { char, role } = activeRoleAndCharacter(ctx);
  const configDefault = ctx.configManager.getDefaultReasoningEffort();
  const { effort, source } = describeEffortSource(char, role, configDefault);
  const tier = getModelTier(ctx.provider.getCurrentModel(), effort);
  const tierColor = tier === 'large' ? chalk.green : tier === 'medium' ? chalk.yellow : chalk.red;

  const sourceLabel: Record<string, string> = {
    pin: 'global pin (/effort)',
    personaggio: `character (${char?.displayName ?? char?.name ?? '—'})`,
    ruolo: `role (${role.displayName})`,
    default: 'config default (tsuka.config.json)',
    nessuno: 'none — model default'
  };

  console.log(chalk.bold('\n🎚️  REASONING EFFORT'));
  console.log(`  Active level:   ${chalk.magenta(effort ?? 'none (model default)')}`);
  console.log(`  Source:         ${chalk.cyan(sourceLabel[source])}`);
  console.log(`  Tool tier:      ${tierColor(tier.toUpperCase())} (for model '${ctx.provider.getCurrentModel()}')`);
  console.log(`  Global pin:     ${getEffortPin() ? chalk.magenta(getEffortPin()) : chalk.gray('none')}`);
  console.log(`  Ask mode:       ${isAskModeEnabled() ? chalk.green('enabled') : chalk.gray('disabled')} ${chalk.gray('(interactive chat only)')}`);
  console.log(chalk.gray('  Usage: /effort <none|low|medium|xhigh> · /effort auto · /effort ask'));
  console.log();
}

function applyPinAndAnnounce(ctx: CommandCtx, newPin: ReasoningEffort | undefined, label: string): void {
  const { role } = activeRoleAndCharacter(ctx);
  const before = toolNamesAt(ctx, role.allowedTools, ctx.agent.current.getReasoningEffort());

  setEffortPin(newPin);
  ctx.agent.current = ctx.recreateAgent();

  const after = toolNamesAt(ctx, role.allowedTools, ctx.agent.current.getReasoningEffort());
  const diff = describeToolDiff(before, after);

  CLITheme.success(label);
  if (diff) {
    CLITheme.warning(`Visible tools changed: ${diff}`);
  } else {
    CLITheme.info('No changes in visible tools.');
  }
}

export async function handleEffort(ctx: CommandCtx, arg: string): Promise<void> {
  const normalized = arg.trim().toLowerCase();

  if (!normalized) {
    printStatus(ctx);
    return;
  }

  if (normalized === 'auto') {
    if (getEffortPin() === undefined) {
      CLITheme.info('No pin active: already in automatic cascade mode.');
      return;
    }
    applyPinAndAnnounce(ctx, undefined, 'Pin removed: restored automatic cascade.');
    return;
  }

  if (normalized === 'ask') {
    const nowEnabled = !isAskModeEnabled();
    setAskMode(nowEnabled);
    if (nowEnabled) {
      CLITheme.success('Ask mode enabled: chat will request confirmation when turn diverges from default effort.');
      CLITheme.info('Does not block /team or /goal (logs divergence without prompting).');
    } else {
      CLITheme.success('Ask mode disabled: divergences will only be logged.');
    }
    return;
  }

  if (!VALID_LEVELS.includes(normalized as ReasoningEffort)) {
    CLITheme.error(`Invalid effort level: '${arg}'. Allowed values: ${VALID_LEVELS.join(', ')}, 'auto', or 'ask'.`);
    return;
  }

  const level = normalized as ReasoningEffort;
  applyPinAndAnnounce(ctx, level, `Reasoning effort pinned to '${level}' for this session.`);
}
