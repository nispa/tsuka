import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import chalk from 'chalk';
import { ContextTracker } from '../../core/contextTracker';
import { getRecommendedEffort } from '../../core/modelProfile';
import { sumMessageChars } from '../../core/contextBudget';
import { logSink } from '../../core/logSink';

export async function handleExit(_ctx: CommandCtx, _arg: string): Promise<void> {
  logSink.log(chalk.yellow('Exiting... Goodbye!'));
  process.exit(0);
}

export async function handleInfo(ctx: CommandCtx, _arg: string): Promise<void> {
  const charName = ctx.configManager.getActiveCharacter();
  const char = ctx.loadCharacter(charName);
  const currentModel = ctx.provider.getCurrentModel();
  const recEffort = getRecommendedEffort(currentModel);
  const maxTokens = ctx.configManager.getMaxHistoryTokens();
  const runtimeCtx = ctx.configManager.getRuntimeContextTokens();
  const ctxSource = runtimeCtx ? chalk.green('(live server)') : chalk.gray('(config default)');

  logSink.log(chalk.bold('\nSession Information:'));
  logSink.log(`- Active Provider: ${chalk.green(ctx.configManager.getActiveProviderName().toUpperCase())}`);
  logSink.log(`- Server Endpoint: ${chalk.cyan(ctx.provider.getBaseUrl())}`);
  logSink.log(`- Active Model:    ${chalk.green(currentModel)}`);
  logSink.log(`- Context Window:  ${chalk.cyan(maxTokens.toLocaleString() + ' tok')} ${ctxSource}`);
  if (recEffort) {
    logSink.log(`- Recommended Effort: ${chalk.magenta(recEffort.toUpperCase())} ${chalk.gray('(from benchmark, use /effort ' + recEffort + ')')}`);
  }
  if (char) {
    logSink.log(`- Character:       ${chalk.green(char.displayName)} (${chalk.yellow(char.aiName)})`);
    logSink.log(`  └─ Linked Role:   ${char.role}`);
    logSink.log(`  └─ Linked Trait:  ${char.trait}`);
  } else {
    logSink.log(`- Agent Role:      ${chalk.green(ctx.loadRole(ctx.configManager.getActiveRole()).displayName)}`);
    logSink.log(`- Trait:           ${chalk.green(ctx.loadTrait(ctx.configManager.getActiveTrait()).displayName)}`);
  }
  logSink.log('');
}

export async function handleContext(ctx: CommandCtx, _arg: string): Promise<void> {
  const agent = ctx.agent.current;
  const msgs = agent.getMessages();
  const maxTokens = ctx.configManager.getMaxHistoryTokens();

  const total = agent.estimateMessagesTokens(msgs);

  const runtimeCtx = ctx.configManager.getRuntimeContextTokens();
  const sourceLabel = runtimeCtx ? chalk.green('(live server)') : chalk.gray('(config default)');

  logSink.log(chalk.bold('\n📊 CONTEXT STATUS'));
  CLITheme.contextBar(total, maxTokens, 'Context:', sourceLabel);
  logSink.log('');

  const counts: Record<string, number> = {};
  let roleTokens: Record<string, number> = {};
  for (const m of msgs) {
    counts[m.role] = (counts[m.role] || 0) + 1;
    roleTokens[m.role] = (roleTokens[m.role] || 0) + Math.ceil(sumMessageChars([m]) / agent.getCharsPerTokenRatio());
  }

  logSink.log(chalk.bold('  Messages by role:'));
  for (const role of ['system', 'user', 'assistant', 'tool']) {
    if (counts[role]) {
      const tok = roleTokens[role] || 0;
      const tokStr = tok >= 1000 ? `${(tok / 1000).toFixed(1)}k` : `${tok}`;
      logSink.log(`    ${chalk.cyan(role.padEnd(12))} ${chalk.yellow(String(counts[role]).padStart(3))} msg  ${chalk.gray(`(~${tokStr} tok)`)}`);
    }
  }
  logSink.log('');

  const tracker = ContextTracker.getInstance();
  const recent = tracker.getRecent(10);
  if (recent.length > 0) {
    logSink.log(chalk.bold('  Recent activities:'));
    for (const e of recent) {
      const time = e.timestamp.slice(11, 19);
      const tok = e.tokenCount >= 1000 ? `${(e.tokenCount / 1000).toFixed(1)}k` : `${e.tokenCount}`;
      const ctx = e.promptTokens >= 1000 ? `${(e.promptTokens / 1000).toFixed(1)}k` : `${e.promptTokens}`;
      logSink.log(`    ${chalk.gray(time)}  ${chalk.cyan(e.agentName.padEnd(14))} ${chalk.yellow(tok.padStart(6))} out  ${chalk.gray(`${ctx.padStart(6)} ctx`)}  ${chalk.gray(e.action)}`);
    }
    logSink.log('');
  }

  const lastMsgs = msgs.slice(-6);
  if (lastMsgs.length > 1) {
    logSink.log(chalk.bold('  Recent messages:'));
    for (const m of lastMsgs) {
      const preview = typeof m.content === 'string' ? m.content.replace(/\s+/g, ' ').slice(0, 100) : '(tool)';
      const label = m.role === 'assistant' ? chalk.green('assistant') : m.role === 'user' ? chalk.cyan('user') : chalk.gray(m.role);
      logSink.log(`    ${label} ${chalk.gray(preview)}`);
    }
    logSink.log('');
  }
}

export async function handleReset(ctx: CommandCtx, _arg: string): Promise<void> {
  ctx.agent.current = ctx.recreateAgent();
  ctx.permissionManager.resetSession();
  ContextTracker.getInstance().clear();
  CLITheme.success('Session reset successfully (history and permissions cleared).');
}
