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
    CLITheme.warning('No characters found in characters/ directory.');
    return;
  }

  let selectedNames: string[] = [];
  let topic = (directTopic || '').trim();

  if (arg) {
    const quotedMatch = arg.match(/["'](.*?)["']/);
    if (quotedMatch) {
      topic = quotedMatch[1].trim();
      const agentsPart = arg.replace(quotedMatch[0], '').trim();
      selectedNames = agentsPart
        .split(/[\s,e\+]+/i)
        .map((n: string) => n.trim().replace(/^@/, '').toLowerCase())
        .filter((n: string) => n.length > 0);
    } else {
      const parts = arg.split(/\s+/);
      const agentParts = parts.filter(p => p.startsWith('@'));
      const textParts = parts.filter(p => !p.startsWith('@'));
      if (agentParts.length >= 2) {
        selectedNames = agentParts.map(a => a.replace(/^@/, '').toLowerCase());
        if (textParts.length > 0) {
          topic = textParts.join(' ');
        }
      } else {
        selectedNames = arg
          .split(/[\s,e\+]+/i)
          .map((n: string) => n.trim().replace(/^@/, '').toLowerCase())
          .filter((n: string) => n.length > 0);
      }
    }
  }

  if (!arg) {
    if (process.env.TSUKA_TUI || (ctx as any).isTui) {
      CLITheme.warning('Usage: /call @agent1 @agent2 "Topic to discuss"');
      return;
    }
    logSink.log('');
    const response = await prompts({
      type: 'multiselect',
      name: 'chars',
      message: 'Select characters for the conference call (SPACE to select, ENTER to confirm):',
      choices: availableChars.map((c) => ({
        title: `${c.displayName} (@${c.name}) - ${c.description}`,
        value: c.name,
        selected: false
      })),
      hint: '- arrow keys to move, space to select, enter to confirm'
    });
    selectedNames = response.chars || [];
  }

  if (selectedNames.length < 2) {
    CLITheme.error('You must invite at least 2 characters to start a call.');
    return;
  }

  const participants: any[] = [];
  for (const name of selectedNames) {
    const found = availableChars.find(c =>
      c.name.toLowerCase() === name ||
      c.aiName.toLowerCase() === name
    );
    if (found) {
      participants.push(found);
    } else {
      CLITheme.warning(`Character '@${name}' not found. Skipped.`);
    }
  }

  if (participants.length < 2) {
    CLITheme.error("Cannot start call: at least 2 valid participants required.");
    return;
  }

  if (!topic) {
    if (process.env.TSUKA_TUI || (ctx as any).isTui) {
      CLITheme.warning('Please specify a topic in quotes. Example: /call @spock @bones "Debate warp drive"');
      return;
    }
    logSink.log('');
    const topicResp = await prompts({
      type: 'text',
      name: 'topic',
      message: chalk.cyan.bold('Conference topic / subject? ❯'),
    });
    topic = topicResp.topic?.trim() || '';
  }

  if (!topic) {
    CLITheme.warning('Call canceled: no topic provided.');
    return;
  }

  return WorkflowScope.withScope('call', async () => {
    logSink.log(chalk.bold('\n📞 [MULTI-AGENT CONFERENCE CALL LAUNCHED]'));
    logSink.log(`Participants: ${participants.map((p: any) => chalk.green(`${p.displayName} (${p.aiName})`)).join(', ')}`);
    logSink.log(`Topic:        "${chalk.yellow(topic)}"\n`);

    const callMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: '' },
      { role: 'user', content: `Group discussion on topic: "${topic}"` }
    ];

    const rounds = 2;
    const fullTranscript: string[] = [];

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

        // No registry on purpose: a call turn is passed an empty `tools` array, so listing the
        // role's tools here would advertise capabilities the participant cannot actually use.
        let sysPrompt = loadSystemPrompt(roleObj, traitObj, ctx.provider.getCurrentModel(), undefined, p, topic, reasoningEffort);
        sysPrompt += '\n\n[CONTEXT]: You are participating in a group call with colleagues. Reply to prior points, addressing colleagues directly when appropriate. Keep your turn brief (max 4 sentences) and stay in character.';

        callMessages[0] = { role: 'system', content: sysPrompt };

        const renderer = new StreamRenderer({ headerName: p.aiName, headerColor: chalk.green });
        interrupt.rearm();
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
            CLITheme.warning('Call interrupted (Esc).');
            break conf;
          }
          logSink.log(chalk.red(`\n[Error during response from ${p.aiName}: ${err.message}]`));
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
    logSink.log(chalk.bold('📞 [CONFERENCE CALL CONCLUDED]\n'));

    const transcriptText = `I observed a multi-agent conference call between (${participants.map((p: any) => p.aiName).join(', ')}) on "${topic}". Complete transcript:\n\n` +
      fullTranscript.map((line: string) => `- ${line}`).join('\n') +
      '\n\nYou can now ask questions about the discussion or proceed with conclusions.';

    ctx.agent.current.getMessages().push({ role: 'user', content: `Group discussion topic: "${topic}"` });
    ctx.agent.current.getMessages().push({ role: 'assistant', content: transcriptText });
  });
}
