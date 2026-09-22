import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import chalk from 'chalk';
import { ContextTracker } from '../../core/contextTracker';
import { getModelProfile, getRecommendedEffort } from '../../core/modelProfile';
import { sumMessageChars, getContextPressure } from '../../core/contextBudget';
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
  const profile = getModelProfile(currentModel);
  if (profile) {
    const tierColor = profile.tier === 'large' ? chalk.green : profile.tier === 'medium' ? chalk.yellow : chalk.red;
    logSink.log(`- Measured Profile: tier ${tierColor(profile.tier.toUpperCase())} (${profile.tokensPerSecond} tok/s, tested on ${profile.testedAt.slice(0, 10)})`);
  } else {
    logSink.log(chalk.gray('- Measured Profile: none (use /benchmark to measure model capabilities)'));
  }
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

  const total = agent.estimateTotalContextTokens();

  const runtimeCtx = ctx.configManager.getRuntimeContextTokens();
  const sourceLabel = runtimeCtx ? chalk.green('(live server)') : chalk.gray('(config default)');

  logSink.log(chalk.bold('\n📊 CONTEXT STATUS'));
  CLITheme.contextBar(total, maxTokens, 'Context:', sourceLabel);
  const pressure = getContextPressure(total, maxTokens);
  const pctStr = Math.round(pressure.ratio * 100);
  logSink.log(`  ${chalk.gray('Context:')} ${chalk.cyan(`${pctStr}%`)} ${chalk.gray(`(estimated)`)}`);
  logSink.log(`  ${chalk.gray('Used:')}    ${chalk.white(`${pressure.usedTokens.toLocaleString('en-US')} / ${pressure.limitTokens.toLocaleString('en-US')} tokens`)}`);
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
  const toolTokens = Math.max(0, total - agent.estimateMessagesTokens(msgs));
  if (toolTokens > 0) {
    const tokStr = toolTokens >= 1000 ? `${(toolTokens / 1000).toFixed(1)}k` : `${toolTokens}`;
    logSink.log(`    ${chalk.cyan('tools schema'.padEnd(12))} ${chalk.yellow('—'.padStart(3))} sch  ${chalk.gray(`(~${tokStr} tok)`)}`);
  }
  logSink.log('');

  const tracker = ContextTracker.getInstance();
  const scheduler = tracker.getSchedulerMetrics();
  if (agent.isContextSchedulerEnabled() || scheduler.prepareDecisions > 0 || scheduler.delegateDecisions > 0 || scheduler.delegationsAttempted > 0) {
    logSink.log(chalk.bold('  Context Scheduler Diagnostics:'));
    logSink.log(`    Peak Estimated Pressure: ${chalk.cyan(`${Math.round(scheduler.peakEstimatedPressure * 100)}%`)}`);
    if (scheduler.lastObservedPressure) {
      logSink.log(`    Last Observed Pressure:  ${chalk.cyan(`${Math.round(scheduler.lastObservedPressure.ratio * 100)}%`)} ${chalk.gray(`(${scheduler.lastObservedPressure.usedTokens}/${scheduler.lastObservedPressure.limitTokens} tok)`)}`);
    }
    logSink.log(`    Decisions:               ${chalk.yellow(String(scheduler.prepareDecisions))} prepare, ${chalk.yellow(String(scheduler.delegateDecisions))} delegate`);
    logSink.log(`    Delegations:             ${chalk.yellow(String(scheduler.delegationsAttempted))} attempted, ${chalk.green(String(scheduler.delegationsCompleted))} completed, ${chalk.red(String(scheduler.delegationsFailed))} failed`);
    if (scheduler.delegationsCompleted > 0) {
      const ampStr = scheduler.contextAmplification !== null ? `${scheduler.contextAmplification}x` : 'n/a';
      logSink.log(`    Token Economy (last):    ${chalk.gray(`${scheduler.lastChildTokens} child tok / ${scheduler.lastReturnedTokens} returned tok`)} (amplification: ${chalk.cyan(ampStr)})`);
      logSink.log(`    AgentResult (last):      ${chalk.gray(`${scheduler.lastAgentResultChars} chars`)}`);
    }
    logSink.log('');
  }

  const recent = tracker.getRecent(10);
  if (recent.length > 0) {
    logSink.log(chalk.bold('  Recent activities:'));
    for (const e of recent) {
      const time = e.timestamp.slice(11, 19);
      const tok = e.tokenCount >= 1000 ? `${(e.tokenCount / 1000).toFixed(1)}k` : `${e.tokenCount}`;
      const ctx = e.promptTokens >= 1000 ? `${(e.promptTokens / 1000).toFixed(1)}k` : `${e.promptTokens}`;
      const peakStr = e.peakPromptTokens && e.peakPromptTokens > e.promptTokens
        ? chalk.gray(` (peak ${e.peakPromptTokens >= 1000 ? `${(e.peakPromptTokens / 1000).toFixed(1)}k` : e.peakPromptTokens})`)
        : '';
      logSink.log(`    ${chalk.gray(time)}  ${chalk.cyan(e.agentName.padEnd(14))} ${chalk.yellow(tok.padStart(6))} out  ${chalk.gray(`${ctx.padStart(6)} ctx`)}${peakStr}  ${chalk.gray(e.action)}`);
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
