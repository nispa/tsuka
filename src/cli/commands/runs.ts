import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import { getLatestWorkflowLogs } from './workflowLog';
import { logSink } from '../../core/logSink';

/**
 * Comando `/runs`: mostra l'elenco e i dettagli degli ultimi workflow/goal eseguiti.
 */
export async function handleRuns(_ctx: CommandCtx, _arg: string): Promise<void> {
  const logs = getLatestWorkflowLogs(15);
  if (logs.length === 0) {
    CLITheme.warning('Nessun workflow salvato in workflow_logs/. Esegui un team (/team) o un goal (/goal) per visualizzare i report.');
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    logSink.log(chalk.bold(`\n📜 Storico Workflow (${logs.length} più recenti):\n`));
    for (const log of logs) {
      const data = log.data;
      const isGoal = data.type === 'goal';
      const statusStr = (data.success || data.completed) ? chalk.green('✔ COMPLETATO') : chalk.red('✘ FALLITO');
      const date = (data.timestamp || '').replace('T', ' ').slice(0, 16);
      const title = isGoal ? `Goal: ${data.goal}` : `Team: ${data.displayName || data.team}`;
      logSink.log(`  ${chalk.cyan(date)}  ${statusStr}  ${chalk.bold(title)}`);
    }
    logSink.log('');
    return;
  }

  const choices = logs.map((log) => {
    const data = log.data;
    const isGoal = data.type === 'goal';
    const isOk = data.success || data.completed;
    const statusIcon = isOk ? '✔' : '✘';
    const date = (data.timestamp || '').replace('T', ' ').slice(0, 16);
    const title = isGoal ? `[GOAL] ${data.goal}` : `[TEAM: ${data.displayName || data.team}] ${data.task}`;
    const truncatedTitle = title.length > 60 ? title.slice(0, 60) + '…' : title;
    return {
      title: `${statusIcon} ${chalk.cyan(date)} ${truncatedTitle}`,
      value: log.file,
      description: `File: ${log.file} · ${isOk ? 'Riuscito' : 'Fallito / Incompleto'}`
    };
  });

  choices.push({ title: chalk.gray('── Chiudi'), value: '__exit__', description: 'Chiude il menu storico workflow' });

  logSink.log('');
  const selectedFile = await InteractiveMenu.select<string>(
    `📜 Seleziona un workflow da ispezionare (${logs.length} esecuzioni recenti):`,
    choices
  );

  if (!selectedFile || selectedFile === '__exit__') return;

  const targetLog = logs.find((l) => l.file === selectedFile);
  if (!targetLog) return;

  const data = targetLog.data;
  const isGoal = data.type === 'goal';
  const isOk = data.success || data.completed;

  logSink.log(chalk.bold(`\n📋 Dettaglio Workflow: ${chalk.cyan(selectedFile)}`));
  logSink.log(`  • Tipo:       ${isGoal ? chalk.yellow('Goal Orchestrator') : chalk.blue(`Team (${data.mode || 'standard'})`)}`);
  logSink.log(`  • Obiettivo:  ${chalk.white(isGoal ? data.goal : data.task)}`);
  logSink.log(`  • Esito:      ${isOk ? chalk.green('COMPLETATO CON SUCCESSO') : chalk.red('NON COMPLETATO / FALLITO')}`);
  logSink.log(`  • Data:       ${chalk.gray(data.timestamp)}`);

  if (isGoal && data.agents) {
    logSink.log(`  • Agenti:     ${chalk.cyan(data.agents.join(', '))}`);
  } else if (data.members) {
    logSink.log(`  • Membri:     ${chalk.cyan(data.members.join(', '))}`);
  }

  if (data.stats && Array.isArray(data.stats)) {
    logSink.log(chalk.bold('\n  Statistiche Interventi:'));
    for (const s of data.stats) {
      const tokOut = s.stats?.outputTokens || s.stats?.outTok || 0;
      const dur = s.stats?.durationMs ? `${(s.stats.durationMs / 1000).toFixed(1)}s` : '';
      logSink.log(`    - ${chalk.bold(s.name)}: ${chalk.green(tokOut)} tok out ${dur ? `(${dur})` : ''}`);
    }
  }

  if (data.blackboard && data.blackboard.length > 0) {
    logSink.log(chalk.bold(`\n  Blackboard (${data.blackboard.length} note registrate):`));
    for (const note of data.blackboard) {
      const author = note.author ? chalk.yellow(`[${note.author}]`) : '';
      logSink.log(`    • ${chalk.cyan(note.key)} ${author}: ${chalk.white(note.value)}`);
    }
  }

  logSink.log('');
}
