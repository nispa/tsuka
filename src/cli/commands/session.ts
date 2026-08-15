import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import chalk from 'chalk';
import { ContextTracker } from '../../core/contextTracker';

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

export async function handleContext(ctx: CommandCtx, _arg: string): Promise<void> {
  const agent = ctx.agent.current;
  const msgs = agent.getMessages();
  const maxTokens = ctx.configManager.getMaxHistoryTokens();

  // Stima token totali
  let totalChars = 0;
  for (const m of msgs) {
    if (typeof m.content === 'string') totalChars += m.content.length;
    if (m.tool_calls) {
      try { totalChars += JSON.stringify(m.tool_calls).length; } catch {}
    }
  }
  const total = Math.ceil(totalChars / 3.5);
  const pct = maxTokens > 0 ? Math.min(100, Math.round((total / maxTokens) * 100)) : 0;
  const barW = 24;
  const filled = Math.round((pct / 100) * barW);
  const empty = barW - filled;
  const barColor = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
  const bar = barColor('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));

  console.log(chalk.bold('\n📊 STATO CONTESTO'));
  console.log(`  ${bar} ${barColor(`${pct}%`)} ${chalk.gray(`(~${total.toLocaleString()} / ${maxTokens.toLocaleString()} tok)`)}\n`);

  // Conteggio per ruolo
  const counts: Record<string, number> = {};
  let roleTokens: Record<string, number> = {};
  for (const m of msgs) {
    counts[m.role] = (counts[m.role] || 0) + 1;
    let chars = typeof m.content === 'string' ? m.content.length : 0;
    if (m.tool_calls) {
      try { chars += JSON.stringify(m.tool_calls).length; } catch {}
    }
    roleTokens[m.role] = (roleTokens[m.role] || 0) + Math.ceil(chars / 3.5);
  }

  console.log(chalk.bold('  Messaggi per ruolo:'));
  for (const role of ['system', 'user', 'assistant', 'tool']) {
    if (counts[role]) {
      const tok = roleTokens[role] || 0;
      const tokStr = tok >= 1000 ? `${(tok / 1000).toFixed(1)}k` : `${tok}`;
      console.log(`    ${chalk.cyan(role.padEnd(12))} ${chalk.yellow(String(counts[role]).padStart(3))} msg  ${chalk.gray(`(~${tokStr} tok)`)}`);
    }
  }
  console.log();

  // Attività recenti dal tracker
  const tracker = ContextTracker.getInstance();
  const recent = tracker.getRecent(10);
  if (recent.length > 0) {
    console.log(chalk.bold('  Ultime attività:'));
    for (const e of recent) {
      const time = e.timestamp.slice(11, 19);
      const tok = e.tokenCount >= 1000 ? `${(e.tokenCount / 1000).toFixed(1)}k` : `${e.tokenCount}`;
      const ctx = e.promptTokens >= 1000 ? `${(e.promptTokens / 1000).toFixed(1)}k` : `${e.promptTokens}`;
      console.log(`    ${chalk.gray(time)}  ${chalk.cyan(e.agentName.padEnd(14))} ${chalk.yellow(tok.padStart(6))} out  ${chalk.gray(`${ctx.padStart(6)} ctx`)}  ${chalk.gray(e.action)}`);
    }
    console.log();
  }

  // Ultimi messaggi della cronologia
  const lastMsgs = msgs.slice(-6);
  if (lastMsgs.length > 1) {
    console.log(chalk.bold('  Ultimi messaggi:'));
    for (const m of lastMsgs) {
      const preview = typeof m.content === 'string' ? m.content.replace(/\s+/g, ' ').slice(0, 100) : '(strumento)';
      const label = m.role === 'assistant' ? chalk.green('assistente') : m.role === 'user' ? chalk.cyan('utente') : chalk.gray(m.role);
      console.log(`    ${label} ${chalk.gray(preview)}`);
    }
    console.log();
  }
}

export async function handleReset(ctx: CommandCtx, _arg: string): Promise<void> {
  ctx.agent.current = ctx.recreateAgent();
  ctx.permissionManager.resetSession();
  ContextTracker.getInstance().clear();
  CLITheme.success('Sessione resettata con successo (cronologia e autorizzazioni azzerate).');
}
