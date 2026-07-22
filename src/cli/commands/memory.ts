import chalk from 'chalk';
import { CommandCtx } from './types';
import { CLITheme, InteractiveMenu } from '../ui';
import { MemoryStore, MemoryFact } from '../../core/memory';

/**
 * /memory — menu interattivo della memoria condivisa: seleziona un ricordo,
 * leggilo per intero, recuperalo nel contesto della chat o eliminalo.
 * Senza TTY (output in pipe) degrada all'elenco testuale semplice.
 */

const MENU_LIMIT = 30;

function plainList(store: MemoryStore): void {
  const facts = store.getRecent(20);
  console.log(chalk.bold(`\n🧠 Memoria condivisa (${store.count()} ricordi totali, ultimi ${facts.length}):`));
  if (facts.length === 0) {
    console.log(chalk.gray('  (vuota — gli agenti possono salvare fatti con il tool save_memory)'));
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
  CLITheme.box(`Ricordo ${fact.id} — ${date} (${fact.source})`, lines, chalk.magenta);
}

export async function handleMemory(ctx: CommandCtx, _arg: string): Promise<void> {
  const store = MemoryStore.getInstance();

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    plainList(store);
    return;
  }

  while (true) {
    const facts = store.getRecent(MENU_LIMIT);
    if (facts.length === 0) {
      CLITheme.info('La memoria condivisa è vuota — gli agenti possono salvare fatti con il tool save_memory.');
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
    items.push({ title: chalk.gray('── Chiudi il menu'), value: '__exit__' });

    const chosenId = await InteractiveMenu.select<string>(
      `🧠 Memoria condivisa (${store.count()} ricordi, ultimi ${facts.length}) — seleziona un ricordo:`,
      items
    );
    if (!chosenId || chosenId === '__exit__') return;

    const fact = facts.find((f) => f.id === chosenId);
    if (!fact) continue; // rimosso nel frattempo: ricarica l'elenco

    console.log();
    showFact(fact);

    const action = await InteractiveMenu.select<string>(
      'Cosa vuoi fare con questo ricordo?',
      [
        {
          title: 'Recupera nel contesto della chat',
          value: 'inject',
          description: 'L\'agente lo terrà presente nelle prossime risposte di questa sessione'
        },
        { title: 'Elimina questo ricordo', value: 'delete' },
        { title: 'Torna all\'elenco', value: 'back' },
        { title: 'Chiudi il menu', value: 'exit' },
      ]
    );

    if (action === 'inject') {
      const date = fact.timestamp.replace('T', ' ').slice(0, 16);
      ctx.agent.current.getMessages().push({
        role: 'user',
        content:
          `[Ricordo recuperato dalla memoria condivisa — ${date}, fonte: ${fact.source}]\n` +
          `${fact.content}\n` +
          `(Tienine conto nel resto della conversazione; non serve commentarlo ora.)`
      });
      CLITheme.success('Ricordo inserito nel contesto della chat: l\'agente lo terrà presente.');
      return;
    }
    if (action === 'delete') {
      if (store.remove(fact.id)) {
        CLITheme.success(`Ricordo '${fact.id}' eliminato.`);
      } else {
        CLITheme.error(`Impossibile eliminare il ricordo '${fact.id}'.`);
      }
      continue; // torna all'elenco aggiornato
    }
    if (action === 'back') continue;
    return; // 'exit' o menu annullato (Esc/Ctrl+C)
  }
}
