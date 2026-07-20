import prompts from 'prompts';
import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import { StreamRenderer } from '../stream';
import { GenerationInterrupt } from '../interrupt';
import { loadSystemPrompt, resolveCharacter } from '../shared';
import { Agent } from '../../core/agent';

/**
 * Rileva il protocollo di stato nei messaggi generati in un turno:
 * un membro dichiara il compito risolto scrivendo "STATO: COMPLETATO".
 * Vengono considerati solo i messaggi assistant (ignorati tool e system).
 */
export function hasCompletionMarker(messages: any[]): boolean {
  return messages.some(
    (m) => m.role === 'assistant' && typeof m.content === 'string' && /STATO:\s*COMPLETATO/i.test(m.content)
  );
}

export async function handleTeam(ctx: CommandCtx, arg: string): Promise<void> {
  const availableTeams = ctx.listAvailableItems('teams', ctx.loadTeam);

  if (availableTeams.length === 0) {
    CLITheme.warning('Nessun team configurato trovato nella cartella teams/.');
    return;
  }

  let selectedTeamName = arg.toLowerCase();
  if (!selectedTeamName) {
    console.log();
    const selected = await InteractiveMenu.select<string>(
      'Seleziona il team collaborativo da attivare (usa le frecce):',
      availableTeams.map((t: any) => ({
        title: `${t.displayName} - ${t.description}`,
        value: t.name,
      })),
      availableTeams[0].name
    );
    if (!selected) return;
    selectedTeamName = selected;
  }

  const team = ctx.loadTeam(selectedTeamName);
  if (!team) {
    CLITheme.error(`Team '${selectedTeamName}' non trovato.`);
    return;
  }

  console.log();
  const taskResp = await prompts({
    type: 'text',
    name: 'task',
    message: chalk.cyan.bold('Descrivi il compito da assegnare al Team ❯'),
  });

  const task = taskResp.task?.trim();
  if (!task) {
    CLITheme.warning('Operazione annullata: nessun compito specificato.');
    return;
  }

  const maxRounds = ctx.configManager.getTeamMaxRounds();

  console.log(chalk.bold('\n🚀 [AVVIO WORKFLOW COLLABORATIVO DI TEAM]'));
  console.log(`Team:        ${chalk.green(team.displayName)}`);
  console.log(`Membri:      ${team.members.map((m: string) => chalk.cyan(m)).join(', ')}`);
  console.log(`Obiettivo:   "${chalk.yellow(task)}"`);
  console.log(`Round max:   ${chalk.cyan(maxRounds)} (stop anticipato a compito risolto)\n`);

  // Cronologia condivisa tra tutti i membri e tutti i round
  const teamMessages: any[] = [
    { role: 'system', content: '' },
    { role: 'user', content: `COMPITO DI GRUPPO DA RISOLVERE: "${task}"` }
  ];

  let completed = false;
  let roundsDone = 0;

  // Esc interrompe l'intero workflow
  const interrupt = new GenerationInterrupt();
  interrupt.arm();

  outer:
  for (let round = 1; round <= maxRounds; round++) {
    roundsDone = round;
    console.log(chalk.bold.yellow(`\n═══ ROUND ${round}/${maxRounds} ═══`));

    for (const memberName of team.members) {
      const memberChar = resolveCharacter(memberName);
      if (!memberChar) {
        CLITheme.warning(`Membro del team '${memberName}' non trovato. Saltato.`);
        continue;
      }

      const roleObj = ctx.loadRole(memberChar.role);
      const traitObj = ctx.loadTrait(memberChar.trait);

      console.log(chalk.bold.blue(`\n[TURNO DI LAVORO: ${memberChar.displayName}]`));
      console.log(chalk.gray(`Ruolo: ${roleObj.displayName} | Attitudine: ${traitObj.displayName}`));

      let sysPrompt = loadSystemPrompt(roleObj, traitObj, ctx.provider.getCurrentModel(), ctx.registry, memberChar);
      sysPrompt += `\n\n[CONTESTO COLLABORATIVO]: Stai lavorando in team per risolvere il compito: "${task}".
        Questo è il tuo turno di lavoro attivo (round ${round}/${maxRounds}). Analizza il compito e quanto fatto dai colleghi in precedenza (ispezionando i file del workspace e la cronologia se necessario).
        Esegui i tool a tua disposizione (es. lettura, scrittura o modifica file, ricerche, comandi) per avanzare nel lavoro o completarlo.
        Al termine delle esecuzioni, scrivi una sintesi testuale per spiegare cosa hai fatto e cosa deve fare il prossimo collega (se applicabile). Mantieni fedelmente la tua personalità.

PROTOCOLLO STATO LAVORI (obbligatorio): termina SEMPRE il tuo intervento con una riga finale esatta, in questo formato:
- "STATO: COMPLETATO" — solo se il compito di gruppo è stato risolto definitivamente e non servono altri turni di lavoro;
- "STATO: DA_CONTINUARE" — se serve ancora lavoro tuo o dei colleghi.
Non dichiarare COMPLETATO se non hai verificato concretamente (con i tool) che il lavoro è finito.`;

      const tempAgent = new Agent(
        ctx.provider,
        ctx.registry,
        ctx.permissionManager,
        sysPrompt,
        roleObj.allowedTools,
        ctx.configManager.getMaxHistoryMessages()
      );

      // Semina la cronologia condivisa (saltando il placeholder system)
      for (let i = 1; i < teamMessages.length; i++) {
        tempAgent.getMessages().push(teamMessages[i]);
      }
      // Riferimento all'ultimo messaggio seminato: robusto anche se pruneHistory()
      // rimuove messaggi durante il run (prima si usava slice(length) e si perdevano messaggi)
      const lastSeeded = tempAgent.getMessages()[tempAgent.getMessages().length - 1];

      // Streaming con status "Thinking…", tool call compatti e pannello markdown finale
      const renderer = new StreamRenderer({ headerName: memberChar.aiName });
      renderer.begin();
      try {
        const promptAttivazione = round === 1
          ? `Tocca a te, ${memberChar.aiName}. Lavora sul compito ed esegui i tuoi tool.`
          : `Il compito non è ancora completato (round ${round}). Riprendi da dove è arrivato il team e porta avanti il lavoro, ${memberChar.aiName}.`;
        await tempAgent.run(
          promptAttivazione,
          (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
          (stats) => renderer.setStats(stats),
          (ev) => renderer.onAgentEvent(ev),
          interrupt.signal
        );
        if (interrupt.aborted) {
          renderer.abort();
          CLITheme.warning('Workflow di team interrotto (Esc).');
          break outer;
        }
        renderer.finish();
        console.log();
      } catch (err: any) {
        renderer.abort();
        if (interrupt.aborted) {
          CLITheme.warning('Workflow di team interrotto (Esc).');
          break outer;
        }
        CLITheme.error(`Errore nel turno di ${memberChar.aiName}: ${err.message}`);
      }

      // Estrae i nuovi messaggi generati dal turno (dopo l'ultimo seminato)
      const msgs = tempAgent.getMessages();
      const seededIdx = msgs.indexOf(lastSeeded);
      const newMessages = seededIdx >= 0 ? msgs.slice(seededIdx + 1) : msgs.slice(teamMessages.length);
      teamMessages.push(...newMessages);
      CLITheme.printDivider();

      // Controllo deterministico del protocollo di stato
      if (hasCompletionMarker(newMessages)) {
        completed = true;
        console.log(chalk.green.bold(`\n✔ ${memberChar.aiName} ha dichiarato il compito COMPLETATO.`));
        break outer;
      }
    }
  }

  interrupt.disarm();
  console.log(chalk.bold('🚀 [FINE WORKFLOW COLLABORATIVO DI TEAM]\n'));

  const finalReport = completed
    ? `Il team collaborativo (${team.members.join(', ')}) ha COMPLETATO il compito: "${task}" in ${roundsDone} round.
    Puoi analizzare i file del workspace per verificare il risultato o chiedere dettagli sul processo svolto.`
    : `Il team collaborativo (${team.members.join(', ')}) ha lavorato ${maxRounds} round sul compito: "${task}" senza dichiararlo completato.
    Il lavoro sul workspace potrebbe essere parziale: ti consiglio di verificare i file e, se serve, rilanciare il team con istruzioni più specifiche.`;

  if (completed) {
    CLITheme.success(`Compito risolto dal team in ${roundsDone} round.`);
  } else {
    CLITheme.warning(`Limite di ${maxRounds} round raggiunto senza completamento dichiarato.`);
  }

  ctx.agent.current.getMessages().push({ role: 'user', content: `Lavoro di team completato per: "${task}"` });
  ctx.agent.current.getMessages().push({ role: 'assistant', content: finalReport });
}
