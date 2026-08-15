import prompts from 'prompts';
import chalk from 'chalk';
import { InteractiveMenu } from '../cli/ui';

export type RiskLevel = 'SAFE' | 'RESTRICTED' | 'DANGEROUS';

export class PermissionManager {
  private allowAllWrite: boolean = false;
  // Promise-chain interna (T3.1, PLANNING-QUALITA.md): le richieste che generano
  // un prompt interattivo (RESTRICTED/DANGEROUS) si accodano qui invece di
  // chiamare InteractiveMenu.select/prompts in parallelo. Senza questa coda, due
  // agenti eseguiti in parallelo (blocco PARALLELO di /goal, Promise.all in
  // goal.ts) condividendo lo stesso PermissionManager sovrapponevano due prompt
  // sullo stesso stdin, producendo un'interfaccia rotta e risposte imprevedibili.
  private promptQueue: Promise<void> = Promise.resolve();

  constructor() {}

  /**
   * Resetta lo stato delle autorizzazioni per una nuova sessione.
   */
  resetSession(): void {
    this.allowAllWrite = false;
  }

  /**
   * Accoda `task` dopo l'eventuale prompt già in corso: un solo prompt alla volta,
   * nell'ordine di arrivo delle richieste. La coda avanza sempre e comunque, anche
   * se `task` rifiuta, altrimenti una richiesta fallita bloccherebbe tutte quelle
   * successive.
   */
  private enqueuePrompt<T>(task: () => Promise<T>): Promise<T> {
    const result = this.promptQueue.then(task, task);
    this.promptQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Controlla se l'agente ha il permesso di eseguire un determinato tool.
   * @param toolName Nome del tool richiesto
   * @param details Dettagli dell'operazione (es. il file da scrivere o il comando da lanciare)
   * @param riskLevel Livello di rischio del tool
   * @param requesterLabel Nome/etichetta dell'agente richiedente, mostrato nel prompt
   *   quando più agenti sono attivi in parallelo (es. blocco PARALLELO di /goal)
   * @returns Un booleano che indica se l'azione è autorizzata
   */
  async checkPermission(toolName: string, details: string, riskLevel: RiskLevel, requesterLabel?: string): Promise<boolean> {
    if (riskLevel === 'SAFE') {
      return true;
    }
    // RESTRICTED e DANGEROUS mostrano un prompt interattivo: si accodano.
    return this.enqueuePrompt(() => this.promptForDecision(toolName, details, riskLevel, requesterLabel));
  }

  private async promptForDecision(toolName: string, details: string, riskLevel: RiskLevel, requesterLabel?: string): Promise<boolean> {
    const who = requesterLabel ? ` (${requesterLabel})` : '';

    if (riskLevel === 'RESTRICTED') {
      if (this.allowAllWrite) {
        return true;
      }

      console.log(chalk.yellow(`\n🛡️  [Richiesta Autorizzazione]${who} L'agente richiede il tool di modifica:`));
      console.log(`   Tool: ${chalk.cyan(toolName)}`);
      console.log(`   Azione: ${chalk.white(details)}`);

      const decision = await InteractiveMenu.select<string>(
        'Scegli come procedere:',
        [
          { title: 'Approva questa volta (y)', value: 'yes' },
          { title: 'Nega questa volta (n)', value: 'no' },
          { title: 'Approva sempre per questa sessione (a)', value: 'always' }
        ],
        'yes'
      );

      if (decision === 'yes') {
        return true;
      } else if (decision === 'always') {
        this.allowAllWrite = true;
        console.log(chalk.green('✔ Permesso di scrittura concesso per tutta la sessione.'));
        return true;
      } else {
        console.log(chalk.red('✘ Operazione rifiutata dall\'utente.'));
        return false;
      }
    }

    if (riskLevel === 'DANGEROUS') {
      console.log(chalk.red.bold(`\n⚠️  [AUTORIZZAZIONE CRITICA RICHIESTA]${who} L'agente vuole eseguire un comando di sistema:`));
      console.log(`   Comando: ${chalk.yellow(details)}`);

      const response = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: chalk.red('Vuoi consentire l\'esecuzione?'),
        initial: false
      });

      if (response.confirm) {
        console.log(chalk.green('✔ Comando autorizzato.'));
        return true;
      } else {
        console.log(chalk.red('✘ Comando rifiutato.'));
        return false;
      }
    }

    return false;
  }
}
