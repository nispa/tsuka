import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import { MemoryStore, MemoryFact } from '../../core/memory';
import prompts from 'prompts';

/**
 * `/memory` — interactive menu for shared persistent memory.
 */

const MENU_LIMIT = 30;

function plainList(store: MemoryStore): void {
  const facts = store.getRecent(20);
  console.log(chalk.bold(`\n🧠 Shared memory (${store.count()} total facts, last ${facts.length}):`));
  if (facts.length === 0) {
    console.log(chalk.gray('  (empty — agents can save facts using the save_memory tool)'));
  } else {
    for (const f of facts) {
      const date = f.timestamp.replace('T', ' ').slice(0, 16);
      const content = f.content.length > 90 ? f.content.slice(0, 90) + '…' : f.content;
      console.log(`  ${chalk.gray(f.id)}  ${chalk.cyan(date)}  ${chalk.yellow(`(${f.source})`)} ${content}`);
    }
  }
  console.log();
}

function showFact(fact: MemoryFact): void {
  const date = fact.timestamp.replace('T', ' ').slice(0, 16);
  const width = Math.min(process.stdout.columns || 80, 100) - 8;
  const lines = CLITheme.wrap(fact.content, width).map((l) => chalk.white(l));
  CLITheme.box(`Fact ${fact.id} — ${date} (${fact.source})`, lines, chalk.magenta);
}

export async function handleMemory(ctx: CommandCtx, arg: string): Promise<void> {
  const store = MemoryStore.getInstance();
  const trimmedArg = (arg || '').trim().toLowerCase();

  if (trimmedArg === 'clear' || trimmedArg === 'svuota' || trimmedArg === 'all') {
    const count = store.count();
    if (count === 0) {
      CLITheme.info('Shared memory is already empty.');
      return;
    }
    console.log();
    const confirm = await prompts({
      type: 'confirm',
      name: 'ok',
      message: chalk.red(`Delete ALL ${count} facts from shared memory?`),
      initial: false
    });
    if (confirm.ok) {
      store.clear();
      CLITheme.success('Shared memory cleared.');
    } else {
      CLITheme.info('Operation canceled.');
    }
    return;
  }

  if (trimmedArg) {
    if (store.remove(trimmedArg)) {
      CLITheme.success(`Fact '${trimmedArg}' deleted from shared memory.`);
    } else {
      CLITheme.error(`No fact found with id '${trimmedArg}'.`);
    }
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    plainList(store);
    return;
  }

  while (true) {
    const facts = store.getRecent(MENU_LIMIT);
    if (facts.length === 0) {
      CLITheme.info('Shared memory is empty — agents can save facts using save_memory.');
      return;
    }

    console.log();
    const items: Array<{ title: string; value: string; description?: string }> = facts.map((f) => {
      const date = f.timestamp.replace('T', ' ').slice(0, 16);
      const preview = f.content.length > 60 ? f.content.slice(0, 60) + '…' : f.content;
      return {
        title: `${chalk.cyan(date)} ${chalk.yellow(`(${f.source})`)} ${preview}`,
        value: f.id,
        description: f.content.length > 60 ? f.content.slice(0, 200) : undefined,
      };
    });
    items.push({ title: chalk.gray('── Close menu'), value: '__exit__' });

    const chosenId = await InteractiveMenu.select<string>(
      `🧠 Shared memory (${store.count()} facts, recent ${facts.length}) — select an item:`,
      items
    );
    if (!chosenId || chosenId === '__exit__') return;

    const fact = facts.find((f) => f.id === chosenId);
    if (!fact) continue;

    console.log();
    showFact(fact);

    const action = await InteractiveMenu.select<string>(
      'Action for this fact:',
      [
        {
          title: 'Inject into chat context',
          value: 'inject',
          description: 'The agent will reference this in upcoming turns during this session'
        },
        { title: 'Delete this fact', value: 'delete' },
        { title: 'Back to list', value: 'back' },
        { title: 'Close menu', value: 'exit' },
      ]
    );

    if (action === 'inject') {
      const date = fact.timestamp.replace('T', ' ').slice(0, 16);
      ctx.agent.current.getMessages().push({
        role: 'user',
        content:
          `[Fact recalled from shared memory — ${date}, source: ${fact.source}]\n` +
          `${fact.content}\n` +
          `(Keep this in mind for the remainder of the conversation; no need to comment now.)`
      });
      CLITheme.success('Fact injected into chat context.');
      return;
    }
    if (action === 'delete') {
      if (store.remove(fact.id)) {
        CLITheme.success(`Fact '${fact.id}' deleted.`);
      } else {
        CLITheme.error(`Failed to delete fact '${fact.id}'.`);
      }
      continue;
    }
    if (action === 'back') continue;
    return;
  }
}
