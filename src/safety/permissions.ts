import prompts from 'prompts';
import chalk from 'chalk';
import { InteractiveMenu } from '../cli/ui';

export type RiskLevel = 'SAFE' | 'RESTRICTED' | 'DANGEROUS';

export class PermissionManager {
  private allowAllWrite: boolean = false;

  constructor() {}

  /**
   * Resetta lo stato delle autorizzazioni per una nuova sessione.
   */
  resetSession(): void {
    this.allowAllWrite = false;
  }

  /**
   * Controlla se l'agente ha il permesso di eseguire un determinato tool.
   * @param toolName Nome del tool richiesto
   * @param details Dettagli dell'operazione (es. il file da scrivere o il comando da lanciare)
   * @param riskLevel Livello di rischio del tool
   * @returns Un booleano che indica se l'azione è autorizzata
   */
  async checkPermission(toolName: string, details: string, riskLevel: RiskLevel): Promise<boolean> {
    if (riskLevel === 'SAFE') {
      return true;
    }

    if (riskLevel === 'RESTRICTED') {
      if (this.allowAllWrite) {
        return true;
      }

      console.log(chalk.yellow(`\n🛡️  [Richiesta Autorizzazione] L'agente richiede il tool di modifica:`));
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
      console.log(chalk.red.bold(`\n⚠️  [AUTORIZZAZIONE CRITICA RICHIESTA] L'agente vuole eseguire un comando di sistema:`));
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
