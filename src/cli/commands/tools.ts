import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import { loadToolSchema, getModelTier } from '../../tools/registry';
import { RiskLevel } from '../../safety/permissions';
import { logSink } from '../../core/logSink';

/**
 * `/tools` command: lists all registered tools and displays active visibility based on:
 *  - Agent role (allowedTools)
 *  - Active model tier (small, medium, large)
 *  - Active reasoning effort
 *  - Risk level (SAFE, RESTRICTED, DANGEROUS)
 */
export async function handleTools(ctx: CommandCtx, _arg: string): Promise<void> {
  const charName = ctx.configManager.getActiveCharacter();
  const char = ctx.loadCharacter(charName);
  const roleName = char ? char.role : ctx.configManager.getActiveRole();
  const role = ctx.loadRole(roleName);

  const model = ctx.provider.getCurrentModel();
  const effort = ctx.agent.current.getReasoningEffort();
  const tier = getModelTier(model, effort);

  const allRegisteredTools = ctx.registry.getAllTools();
  if (allRegisteredTools.length === 0) {
    CLITheme.warning('No tools registered in system.');
    return;
  }

  const query = _arg ? _arg.trim().toLowerCase() : '';
  const candidateTools = query
    ? allRegisteredTools.filter((t) => {
        const schema = loadToolSchema(t.name);
        return (
          t.name.toLowerCase().includes(query) ||
          t.riskLevel.toLowerCase() === query ||
          schema.requiredTier.toLowerCase() === query ||
          (schema.description && schema.description.toLowerCase().includes(query))
        );
      })
    : allRegisteredTools;

  if (candidateTools.length === 0) {
    CLITheme.warning(`No tools matching filter "${query}". Use /tools without arguments to list all.`);
    return;
  }

  const visibleForLlm = ctx.registry.listForLLM(model, role.allowedTools, effort);
  const visibleNames = new Set(visibleForLlm.map((t) => t.function.name));

  logSink.log(chalk.bold(`\n🛠️  Agent Toolbox — ${char ? `${char.displayName} (${char.aiName})` : role.displayName}`));
  logSink.log(chalk.gray(`   Model: ${chalk.green(model)} · Detected Tier: ${chalk.yellow(tier.toUpperCase())} · Reasoning Effort: ${chalk.magenta(effort || 'standard')}`));
  const filterLabel = query ? ` · Filter: "${chalk.cyan(query)}"` : '';
  logSink.log(chalk.gray(`   Tools enabled for this turn: ${chalk.green(visibleNames.size)} of ${allRegisteredTools.length} total (showing ${candidateTools.length})${filterLabel}\n`));

  const formatRisk = (risk: RiskLevel) => {
    switch (risk) {
      case 'SAFE':
        return chalk.green('SAFE');
      case 'RESTRICTED':
        return chalk.yellow('RESTRICTED');
      case 'DANGEROUS':
        return chalk.red.bold('DANGEROUS');
      default:
        return chalk.gray('UNKNOWN');
    }
  };

  const sortedTools = [...candidateTools].sort((a, b) => {
    const aVis = visibleNames.has(a.name) ? 0 : 1;
    const bVis = visibleNames.has(b.name) ? 0 : 1;
    if (aVis !== bVis) return aVis - bVis;
    return a.name.localeCompare(b.name);
  });

  for (const t of sortedTools) {
    const schema = loadToolSchema(t.name);
    const isVisible = visibleNames.has(t.name);
    const statusIcon = isVisible ? chalk.green('✔') : chalk.gray('✖');
    const nameStr = isVisible ? chalk.bold.white(t.name) : chalk.gray(t.name);
    const tierBadge = chalk.gray(`[tier:${schema.requiredTier}]`);
    const riskBadge = `[${formatRisk(t.riskLevel)}]`;

    let reason = '';
    if (!isVisible) {
      const roleAllowed = !role.allowedTools || role.allowedTools.includes(t.name);
      if (!roleAllowed) {
        reason = chalk.gray('(excluded by role)');
      } else {
        reason = chalk.gray(`(requires tier ${schema.requiredTier})`);
      }
    }

    const namePad = ' '.repeat(Math.max(0, 26 - CLITheme.cleanLen(t.name)));
    const riskPad = ' '.repeat(Math.max(0, 20 - CLITheme.cleanLen(`[${t.riskLevel}]`)));
    const tierPad = ' '.repeat(Math.max(0, 16 - CLITheme.cleanLen(`[tier:${schema.requiredTier}]`)));
    logSink.log(`  ${statusIcon} ${nameStr}${namePad} ${riskBadge}${riskPad} ${tierBadge}${tierPad} ${reason}`);
    if (isVisible && schema.description) {
      const descSnippet = schema.description.split('\n')[0];
      const truncated = descSnippet.length > 85 ? descSnippet.slice(0, 85) + '…' : descSnippet;
      logSink.log(chalk.gray(`     └─ ${truncated}`));
    }
  }
  logSink.log('');
}
