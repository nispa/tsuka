/**
 * Commands delegating to the CLI multi-agent workflows (/goal, /team, /call,
 * /benchmark) and to the reports they leave behind (/runs, /blackboard).
 *
 * All four workflows share one shape — echo the prompt, mark the session as
 * generating, await the CLI handler, always return to idle — so that shape
 * lives once in `runCliWorkflow` and each command only supplies its data.
 */

import { PersonaModals } from '../modals';
import { TuiCommandContext, TuiCommandSpec } from './types';

interface CliWorkflow {
  /** Label shown in the header while the workflow runs. */
  agentLabel: string;
  /** Line echoed in the chat as if the user had typed it. */
  echo: string;
  /** Prefix of the error message posted when the workflow throws. */
  errorTitle: string;
  /** Toast shown when the workflow completes. */
  doneMessage: string;
  execute: () => Promise<unknown>;
}

async function runCliWorkflow(c: TuiCommandContext, wf: CliWorkflow): Promise<void> {
  const { store } = c;
  store.addMessage({ role: 'user', content: wf.echo });
  store.setState({ isGenerating: true, generationStatus: { phase: 'reasoning', agentName: wf.agentLabel } });

  try {
    await wf.execute();
    store.notify(wf.doneMessage, 'success');
  } catch (err: any) {
    store.addMessage({ role: 'system', content: `❌ **${wf.errorTitle}:** ${err.message}` });
  } finally {
    store.setState({ isGenerating: false, generationStatus: { phase: 'idle' } });
  }
}

/** Splits `<team> "<task>"` into its two parts, quotes optional. */
function parseTeamArg(arg: string): { teamName: string; task: string } {
  const trimmed = arg.trim();
  const teamName = trimmed.split(/\s+/)[0];
  const rest = trimmed.slice(teamName.length).trim();
  const quoted = rest.match(/^["'](.*)["']$/);
  return { teamName, task: quoted ? quoted[1] : rest };
}

export const WORKFLOW_COMMANDS: TuiCommandSpec[] = [
  {
    name: '/goal',
    description: 'Goal orchestrator with parallel branches',
    run: async (c) => {
      if (!c.arg) {
        c.store.addMessage({
          role: 'system',
          content: '🎯 **Usage:** `/goal <objective>`\nExample: `/goal "Implement user authentication with JWT"`',
        });
        return;
      }
      const { handleGoal } = require('../../cli/commands/goal');
      await runCliWorkflow(c, {
        agentLabel: 'Goal Orchestrator',
        echo: `/goal ${c.arg}`,
        errorTitle: 'Goal Orchestrator Error',
        doneMessage: `Goal workflow completed for: "${c.arg}"`,
        execute: () => handleGoal(c.cliContext(), c.arg),
      });
    },
  },

  {
    name: '/team',
    description: 'Launch an autonomous multi-agent team',
    run: async (c) => {
      if (!c.arg) {
        PersonaModals.openTeamModal(c.store);
        return;
      }

      const { teamName, task } = parseTeamArg(c.arg);
      if (!task) {
        c.store.setState({ activeTeam: teamName });
        c.store.notify(`Active team set to: ${teamName}`, 'success');
        return;
      }

      const { handleTeam } = require('../../cli/commands/team');
      await runCliWorkflow(c, {
        agentLabel: `Team: ${teamName}`,
        echo: `/team ${teamName} "${task}"`,
        errorTitle: 'Team Error',
        doneMessage: `Team workflow finished for: ${teamName}`,
        execute: () => handleTeam(c.cliContext(), teamName, task),
      });
    },
  },

  {
    name: '/call',
    description: 'Turn-based multi-agent round-table conference',
    run: async (c) => {
      if (!c.arg) {
        c.store.addMessage({
          role: 'system',
          content: '📞 **Usage:** `/call @agent1 @agent2 "Topic to discuss"`\nExample: `/call @spock @bones "Debate warp engine diagnostics"`',
        });
        return;
      }
      const { handleCall } = require('../../cli/commands/call');
      await runCliWorkflow(c, {
        agentLabel: 'Conference Call',
        echo: `/call ${c.arg}`,
        errorTitle: 'Call Error',
        doneMessage: 'Conference call finished',
        execute: () => handleCall(c.cliContext(), c.arg),
      });
    },
  },

  {
    name: '/benchmark',
    description: 'Empirical capability test for the active model',
    run: async (c) => {
      const { handleBenchmark } = require('../../cli/commands/benchmark');
      await runCliWorkflow(c, {
        agentLabel: 'Benchmark Suite',
        echo: `/benchmark ${c.arg || ''}`.trim(),
        errorTitle: 'Benchmark Error',
        doneMessage: 'Benchmark completed! Results saved to models_profile.json',
        execute: () => handleBenchmark(c.cliContext(), c.arg),
      });
    },
  },

  {
    name: '/runs',
    description: 'Execution history and workflow log reports',
    run: ({ store }) => {
      const { getLatestWorkflowLogs } = require('../../cli/commands/workflowLog');
      const logs = getLatestWorkflowLogs(10);
      if (logs.length === 0) {
        store.addMessage({
          role: 'system',
          content: '📜 No workflows saved in `workflow_logs/`. Run a team (`/team`) or goal (`/goal`) to generate reports.',
        });
        return;
      }

      const lines = logs.map(({ file, data }: any) => {
        const icon = data.success || data.completed ? '🟢' : '🔴';
        const title = data.type === 'goal'
          ? `Goal: ${data.goal}`
          : `Team: ${data.displayName || data.team} (${data.task || ''})`;
        const date = (data.timestamp || '').replace('T', ' ').slice(0, 16);
        return `• ${icon} **${date}** \`[${file}]\` ${title}`;
      });

      store.addMessage({
        role: 'system',
        content: `📜 **Recent Workflow Runs (${logs.length}):**\n\n${lines.join('\n')}`,
      });
    },
  },

  {
    name: '/blackboard',
    hidden: true,
    description: 'Blackboard notes left by the latest workflows',
    run: ({ store, arg }) => {
      const { getLatestWorkflowLogs } = require('../../cli/commands/workflowLog');
      const logs = getLatestWorkflowLogs(parseInt(arg, 10) || 3);
      if (logs.length === 0) {
        store.addMessage({ role: 'system', content: '📋 No workflow reports found in `workflow_logs/`.' });
        return;
      }

      const blocks = logs.map(({ file, data }: any) => {
        const title = data.type === 'goal'
          ? `🎯 GOAL: "${data.goal}"`
          : `👥 TEAM: ${data.displayName || data.team} — "${data.task}"`;
        const notes = Array.isArray(data.blackboard) ? data.blackboard : [];
        const notesStr = notes.length > 0
          ? notes.map((n: any) => `  • \`[${n.key}]\` (@${n.author}): ${n.value}`).join('\n')
          : '  _(No notes recorded)_';
        return `**${file}** — ${title}\n${notesStr}`;
      });

      store.addMessage({
        role: 'system',
        content: `📋 **Recent Blackboard Notes:**\n\n${blocks.join('\n\n')}`,
      });
    },
  },
];
