import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import chalk from 'chalk';
import { ContextTracker } from '../../core/contextTracker';
import { getRecommendedEffort } from '../../core/modelProfile';
import { sumMessageChars } from '../../core/contextBudget';
import { logSink } from '../../core/logSink';

export async function handleExit(_ctx: CommandCtx, _arg: string): Promise<void> {
  logSink.log(chalk.yellow('Uscita in corso... Arrivederci!'));
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

  logSink.log(chalk.bold('\nInformazioni di Sessione:'));
  logSink.log(`- Provider Attivo: ${chalk.green(ctx.configManager.getActiveProviderName().toUpperCase())}`);
  logSink.log(`- Endpoint Server: ${chalk.cyan(ctx.provider.getBaseUrl())}`);
  logSink.log(`- Modello Attivo:  ${chalk.green(currentModel)}`);
  logSink.log(`- Finestra Contesto: ${chalk.cyan(maxTokens.toLocaleString() + ' tok')} ${ctxSource}`);
  if (recEffort) {
    logSink.log(`- Sforzo Consigliato: ${chalk.magenta(recEffort.toUpperCase())} ${chalk.gray('(da benchmark, usa /effort ' + recEffort + ')')}`);
  }
  if (char) {
    logSink.log(`- Personaggio:     ${chalk.green(char.displayName)} (${chalk.yellow(char.aiName)})`);
    logSink.log(`  └─ Ruolo collegato:  ${char.role}`);
    logSink.log(`  └─ Tratto collegato: ${char.trait}`);
  } else {
    logSink.log(`- Ruolo Agente:    ${chalk.green(ctx.loadRole(ctx.configManager.getActiveRole()).displayName)}`);
    logSink.log(`- Attitudine:      ${chalk.green(ctx.loadTrait(ctx.configManager.getActiveTrait()).displayName)}`);
  }
  logSink.log('');
}

export async function handleContext(ctx: CommandCtx, _arg: string): Promise<void> {
  const agent = ctx.agent.current;
  const msgs = agent.getMessages();
  const maxTokens = ctx.configManager.getMaxHistoryTokens();

  // Stima token totali con il rapporto caratteri/token calibrato di QUESTO agente
  // (più preciso della costante fissa usata da /goal, che attraversa più agenti
  // effimeri e non ha "il" rapporto di uno solo da applicare — vedi contextBudget.ts).
  const total = agent.estimateMessagesTokens(msgs);

  const runtimeCtx = ctx.configManager.getRuntimeContextTokens();
  const sourceLabel = runtimeCtx ? chalk.green('(live server)') : chalk.gray('(config default)');

  logSink.log(chalk.bold('\n📊 STATO CONTESTO'));
  CLITheme.contextBar(total, maxTokens, 'Contesto:', sourceLabel);
  logSink.log('');

  // Conteggio per ruolo
  const counts: Record<string, number> = {};
  let roleTokens: Record<string, number> = {};
  for (const m of msgs) {
    counts[m.role] = (counts[m.role] || 0) + 1;
    roleTokens[m.role] = (roleTokens[m.role] || 0) + Math.ceil(sumMessageChars([m]) / agent.getCharsPerTokenRatio());
  }

  logSink.log(chalk.bold('  Messaggi per ruolo:'));
  for (const role of ['system', 'user', 'assistant', 'tool']) {
    if (counts[role]) {
      const tok = roleTokens[role] || 0;
      const tokStr = tok >= 1000 ? `${(tok / 1000).toFixed(1)}k` : `${tok}`;
      logSink.log(`    ${chalk.cyan(role.padEnd(12))} ${chalk.yellow(String(counts[role]).padStart(3))} msg  ${chalk.gray(`(~${tokStr} tok)`)}`);
    }
  }
  logSink.log('');

  // Attività recenti dal tracker
  const tracker = ContextTracker.getInstance();
  const recent = tracker.getRecent(10);
  if (recent.length > 0) {
    logSink.log(chalk.bold('  Ultime attività:'));
    for (const e of recent) {
      const time = e.timestamp.slice(11, 19);
      const tok = e.tokenCount >= 1000 ? `${(e.tokenCount / 1000).toFixed(1)}k` : `${e.tokenCount}`;
      const ctx = e.promptTokens >= 1000 ? `${(e.promptTokens / 1000).toFixed(1)}k` : `${e.promptTokens}`;
      logSink.log(`    ${chalk.gray(time)}  ${chalk.cyan(e.agentName.padEnd(14))} ${chalk.yellow(tok.padStart(6))} out  ${chalk.gray(`${ctx.padStart(6)} ctx`)}  ${chalk.gray(e.action)}`);
    }
    logSink.log('');
  }

  // Ultimi messaggi della cronologia
  const lastMsgs = msgs.slice(-6);
  if (lastMsgs.length > 1) {
    logSink.log(chalk.bold('  Ultimi messaggi:'));
    for (const m of lastMsgs) {
      const preview = typeof m.content === 'string' ? m.content.replace(/\s+/g, ' ').slice(0, 100) : '(strumento)';
      const label = m.role === 'assistant' ? chalk.green('assistente') : m.role === 'user' ? chalk.cyan('utente') : chalk.gray(m.role);
      logSink.log(`    ${label} ${chalk.gray(preview)}`);
    }
    logSink.log('');
  }
}

export async function handleReset(ctx: CommandCtx, _arg: string): Promise<void> {
  ctx.agent.current = ctx.recreateAgent();
  ctx.permissionManager.resetSession();
  ContextTracker.getInstance().clear();
  CLITheme.success('Sessione resettata con successo (cronologia e autorizzazioni azzerate).');
}
