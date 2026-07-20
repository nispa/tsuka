import { spawn } from 'child_process';
import chalk from 'chalk';
import { Tool } from '../registry';
import { getShellConfig } from '../../core/platform';

// Timeout massimo di esecuzione per un comando (evita blocchi infiniti dell'agente)
const COMMAND_TIMEOUT_MS = 120_000;
// Limite dimensione dell'output restituito al modello (lo streaming su console resta illimitato)
const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB

export const executeCommandTool: Tool = {
  name: 'execute_command',
  riskLevel: 'DANGEROUS',
  execute: async (args: { command: string }) => {
    return new Promise<string>((resolve) => {
      const shellConfig = getShellConfig();
      console.log(chalk.gray(`\n[Esecuzione di: ${args.command}]`));

      const child = spawn(
        shellConfig.shell,
        shellConfig.buildArgs(args.command),
        shellConfig.spawnOptions
      );

      let combinedOutput = '';
      let settled = false;

      // Watchdog: se il comando supera il timeout, il processo viene terminato forzatamente
      const watchdog = setTimeout(() => {
        if (settled) return;
        settled = true;
        shellConfig.kill(child);
        console.log(chalk.red(`\n[Comando interrotto: superato il timeout di ${COMMAND_TIMEOUT_MS / 1000}s]`));
        resolve(
          `${combinedOutput}\n[ERRORE: il comando è stato interrotto dopo ${COMMAND_TIMEOUT_MS / 1000} secondi di attesa. ` +
          `Probabilmente era bloccato o in attesa di input.]`
        );
      }, COMMAND_TIMEOUT_MS);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        combinedOutput += text;
        process.stdout.write(chalk.white(text));
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        combinedOutput += text;
        process.stdout.write(chalk.red(text));
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        console.log(chalk.gray(`[Comando terminato con codice: ${code}]`));

        // Tronca l'output se eccessivo (lo streaming su console è già stato visualizzato interamente)
        let resultOutput = combinedOutput;
        if (resultOutput.length > MAX_OUTPUT_BYTES) {
          const tail = resultOutput.slice(-MAX_OUTPUT_BYTES);
          const parts = tail.split(/\r?\n/);
          parts.shift();
          resultOutput =
            `[Output troncato: ${Buffer.byteLength(combinedOutput, 'utf-8')} byte totali, ` +
            `mostrati solo gli ultimi ~${MAX_OUTPUT_BYTES / 1024}KB]\n` + parts.join('\n');
        }

        if (code === 0) {
          resolve(resultOutput || '[Comando eseguito con successo, nessun output prodotto]');
        } else {
          resolve(`${resultOutput}\n[Il processo è terminato con codice di errore: ${code}]`);
        }
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolve(`Errore durante l'avvio del comando: ${err.message}`);
      });
    });
  }
};
