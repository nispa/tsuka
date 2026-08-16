import prompts from 'prompts';
import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme } from '../ui';
import { StreamRenderer } from '../stream';
import { GenerationInterrupt } from '../interrupt';
import { loadSystemPrompt } from '../shared';
import { resolveReasoningEffort } from '../../core/agent';
import { withEffortPin } from '../../core/effortControl';
import { WorkflowScope } from '../../core/workflowScope';
import { logSink } from '../../core/logSink';

export async function handleCall(ctx: CommandCtx, arg: string, directTopic?: string): Promise<void> {
  const availableChars = ctx.listAvailableCharacters();

  if (availableChars.length === 0) {
    CLITheme.warning('Nessun personaggio configurato trovato nella cartella characters/.');
    return;
  }

  let selectedNames: string[] = [];

  if (!arg) {
    logSink.log('');
    const response = await prompts({
      type: 'multiselect',
      name: 'chars',
      message: 'Seleziona i personaggi da invitare alla conferenza (usa SPAZIO per selezionare, INVIO per confermare):',
      choices: availableChars.map((c) => ({
        title: `${c.displayName} (@${c.name}) - ${c.description}`,
        value: c.name,
        selected: false
      })),
      hint: '- frecce per muoverti, barra spaziatrice per selezionare, invio per confermare'
    });
    selectedNames = response.chars || [];
  } else {
    selectedNames = arg
      .split(/[\s,e\+]+/i)
      .map((n: string) => n.trim().replace(/^@/, '').toLowerCase())
      .filter((n: string) => n.length > 0);
  }

  if (selectedNames.length < 2) {
    CLITheme.error('Devi invitare almeno 2 personaggi per avviare una chiamata.');
    return;
  }

  const participants: any[] = [];
  for (const name of selectedNames) {
    // Risoluzione per nome file o aiName
    const found = availableChars.find(c =>
      c.name.toLowerCase() === name ||
      c.aiName.toLowerCase() === name
    );
    if (found) {
      participants.push(found);
    } else {
      CLITheme.warning(`Personaggio '@${name}' non trovato. Saltato.`);
    }
  }

  if (participants.length < 2) {
    CLITheme.error("Impossibile avviare la conferenza: servono almeno 2 partecipanti validi.");
    return;
  }

  let topic = (directTopic || '').trim();
  if (!topic) {
    logSink.log('');
    const topicResp = await prompts({
      type: 'text',
      name: 'topic',
      message: chalk.cyan.bold('Tema o argomento della conferenza? ❯'),
    });
    topic = topicResp.topic?.trim() || '';
  }

  if (!topic) {
    CLITheme.warning('Conferenza annullata: nessun tema inserito.');
    return;
  }

  return WorkflowScope.withScope('call', async () => {

  logSink.log(chalk.bold('\n📞 [AVVIO CONFERENZA MULTI-AGENTE]'));
  logSink.log(`Partecipanti: ${participants.map((p: any) => chalk.green(`${p.displayName} (${p.aiName})`)).join(', ')}`);
  logSink.log(`Argomento:    "${chalk.yellow(topic)}"\n`);

  // Preparazione cronologia temporanea
  const callMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: '' },
    { role: 'user', content: `Discussione di gruppo sul tema: "${topic}"` }
  ];

  const rounds = 2;
  const fullTranscript: string[] = [];

  // Esc interrompe l'intera conferenza
  const interrupt = new GenerationInterrupt();
  interrupt.arm();

  conf:
  for (let r = 1; r <= rounds; r++) {
    logSink.log(chalk.gray(`--- Round ${r}/${rounds} ---`));
    for (const p of participants) {
      const roleObj = ctx.loadRole(p.role);
      const traitObj = ctx.loadTrait(p.trait);

      const cascadedEffort = resolveReasoningEffort(undefined, p, roleObj, ctx.configManager.getDefaultReasoningEffort());
      const reasoningEffort = withEffortPin(cascadedEffort);

      let sysPrompt = loadSystemPrompt(roleObj, traitObj, ctx.provider.getCurrentModel(), ctx.registry, p, topic, reasoningEffort);
      sysPrompt += '\n\n[CONTESTO]: Stai partecipando ad una chiamata di gruppo con altri colleghi. Rispondi alle battute precedenti rivolgendoti direttamente agli altri partecipanti se necessario. Mantieni il tuo intervento breve (max 4 frasi) e rispetta fedelmente la tua identità e il tuo stile.';

      callMessages[0] = { role: 'system', content: sysPrompt };

      // Streaming con status "Thinking…" e pannello markdown finale per ogni intervento
      const renderer = new StreamRenderer({ headerName: p.aiName, headerColor: chalk.green });
      interrupt.rearm(); // il raw mode può essere stato disattivato da prompt intermedi
      renderer.begin();
      try {
        await ctx.provider.chatWithTools(
          callMessages,
          [],
          (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
          interrupt.signal,
          { reasoningEffort }
        );
        renderer.finish();
      } catch (err: any) {
        renderer.abort();
        if (interrupt.aborted) {
          CLITheme.warning('Conferenza interrotta (Esc).');
          break conf;
        }
        logSink.log(chalk.red(`\n[Errore durante la risposta di ${p.aiName}: ${err.message}]`));
        continue;
      }

      const responseText = renderer.getFullText().trim();
      if (responseText) {
        callMessages.push({ role: 'user', content: `${p.aiName}: "${responseText}"` });
        fullTranscript.push(`${p.aiName}: "${responseText}"`);
      }
      logSink.log('');
    }
  }

  interrupt.disarm();
  logSink.log(chalk.bold('📞 [FINE CONFERENZA MULTI-AGENTE]\n'));

  const transcriptText = `Ho assistito a una conferenza tra gli agenti (${participants.map((p: any) => p.aiName).join(', ')}) sul tema "${topic}". Ecco la trascrizione completa del dibattito:\n\n` +
    fullTranscript.map((line: string) => `- ${line}`).join('\n') +
    '\n\nOra puoi farmi domande a riguardo o chiedere pareri su quanto emerso.';

  ctx.agent.current.getMessages().push({ role: 'user', content: `Tema del dibattito di gruppo: "${topic}"` });
  ctx.agent.current.getMessages().push({ role: 'assistant', content: transcriptText });
  });
}
