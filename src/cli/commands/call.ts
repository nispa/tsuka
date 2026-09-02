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
import { resolveCharacter } from '../shared';
import { Agent } from '../../core/agent';
import { CALL_DEFAULTS } from '../../core/constants';

/** `/call` may investigate, but never changes the workspace or external state. */
const CONSULTATION_TOOLS = ['list_dir', 'read_file', 'grep_search', 'web_search', 'browse_url'];

export function parseCallInvocation(arg: string, directTopic = ''): { selectedNames: string[]; topic: string } {
  let topic = directTopic.trim();
  let selectedNames: string[] = [];
  const quotedMatch = arg.match(/["'](.*?)["']/);
  if (quotedMatch) {
    topic = quotedMatch[1].trim();
    selectedNames = arg.replace(quotedMatch[0], '').trim()
      .split(/[\s,+]+/)
      .map((name) => name.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean);
    return { selectedNames, topic };
  }

  const parts = arg.split(/\s+/).filter(Boolean);
  const agentParts = parts.filter((part) => part.startsWith('@'));
  const textParts = parts.filter((part) => !part.startsWith('@'));
  if (agentParts.length >= 2) {
    selectedNames = agentParts.map((agent) => agent.replace(/^@/, '').toLowerCase());
    if (textParts.length > 0) topic = textParts.join(' ');
  } else {
    selectedNames = arg.split(/[\s,+]+/)
      .map((name) => name.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean);
  }
  return { selectedNames, topic };
}

export async function handleCall(ctx: CommandCtx, arg: string, directTopic?: string): Promise<void> {
  const availableChars = ctx.listAvailableCharacters();

  if (availableChars.length === 0) {
    CLITheme.warning('No characters found in characters/ directory.');
    return;
  }

  let { selectedNames, topic } = parseCallInvocation(arg, directTopic);

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
    const found = resolveCharacter(name);
    if (found && !participants.some((participant) => participant.name === found.name)) {
      participants.push(found);
    } else if (found) {
      CLITheme.warning(`Character '@${name}' was already invited. Skipped duplicate.`);
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

    const rounds = CALL_DEFAULTS.rounds;
    const fullTranscript: string[] = [];

    const interrupt = ctx.interrupt ?? new GenerationInterrupt();
    interrupt.arm();

    conf:
    for (let r = 1; r <= rounds; r++) {
      logSink.log(chalk.gray(`--- Round ${r}/${rounds} ---`));
      for (const p of participants) {
        const roleObj = ctx.loadRole(p.role);
        const traitObj = ctx.loadTrait(p.trait);

        const cascadedEffort = resolveReasoningEffort(undefined, p, roleObj, ctx.configManager.getDefaultReasoningEffort());
        const reasoningEffort = withEffortPin(cascadedEffort);

        let sysPrompt = loadSystemPrompt(roleObj, traitObj, ctx.provider.getCurrentModel(), undefined, p, topic, reasoningEffort);
        sysPrompt += '\n\n[CONSULTATION CONTEXT]: You are participating in a group call with colleagues. You may inspect the workspace with read-only file tools and consult public web sources when that helps answer the topic. Do not modify files, run commands, download content, or use any tool outside the consultation set. Reply to prior points, addressing colleagues directly when appropriate. Once you have enough evidence, keep your final turn brief (max 4 sentences) and stay in character.';

        // A consultation turn uses the normal ReAct loop so tool schemas, permissions,
        // workspace jail, and tool-result handling stay identical to ordinary agent work.
        const participantAgent = new Agent(
          ctx.provider,
          ctx.registry,
          ctx.permissionManager,
          sysPrompt,
          CONSULTATION_TOOLS,
          undefined,
          undefined,
          p.aiName,
          reasoningEffort
        );
        participantAgent.getMessages().push(...callMessages.slice(1));

        // `/call` is shared by the CLI and the TUI. The CLI owns terminal painting,
        // whereas the TUI must receive each participant's chunks through its workflow
        // event sink; a CLI StreamRenderer intentionally emits nothing in TUI mode.
        const renderer = ctx.workflowEvents
          ? undefined
          : new StreamRenderer({ headerName: p.aiName, headerColor: chalk.green });
        let receivedContentChunk = false;
        const onChunk = (chunk: string, channel?: 'content' | 'reasoning') => {
          if (channel !== 'reasoning' && chunk.length > 0) receivedContentChunk = true;
          if (ctx.workflowEvents) {
            ctx.workflowEvents.onChunk(chunk, channel ?? 'content', p.aiName);
          } else {
            renderer?.onDelta(chunk, channel ?? 'content');
          }
        };
        let responseText = '';
        interrupt.rearm();
        renderer?.begin();
        try {
          responseText = await participantAgent.run(
            `It is your consultation turn (round ${r}/${rounds}). Investigate the topic if needed, then contribute your evidence-based view to the group.`,
            onChunk,
            (stats) => {
              if (ctx.workflowEvents) {
                ctx.workflowEvents.onStats(stats, p.aiName);
              } else {
                renderer?.setStats(stats);
              }
            },
            (event) => {
              if (ctx.workflowEvents) {
                ctx.workflowEvents.onEvent(event);
              } else {
                renderer?.onAgentEvent(event);
              }
              interrupt.rearm();
            },
            interrupt.signal,
          );
          // Some OpenAI-compatible backends ignore `stream: true`; Agent.run returns
          // their final text, so route it explicitly when no content chunk arrived.
          if (!receivedContentChunk && responseText) onChunk(responseText, 'content');
          responseText = responseText.trim();
          renderer?.finish();
        } catch (err: any) {
          renderer?.abort();
          if (interrupt.aborted) {
            CLITheme.warning('Call interrupted (Esc).');
            break conf;
          }
          logSink.log(chalk.red(`\n[Error during response from ${p.aiName}: ${err.message}]`));
          continue;
        }

        // The provider response is the authoritative transcript. This also preserves
        // content returned by a non-streaming compatible backend.
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
