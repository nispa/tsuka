import { spawn } from 'child_process';
import chalk from 'chalk';
import { Tool } from '../registry';
import { getShellConfig } from '../../core/platform';
import { capForContext } from '../../core/contextBudget';
import { logSink } from '../../core/logSink';
import { ConfigManager } from '../../core/config';

// Limite dimensione dell'output restituito al modello (lo streaming su console resta illimitato)
const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB

export const executeCommandTool: Tool = {
  name: 'execute_command',
  riskLevel: 'DANGEROUS',
  execute: async (args: { command: string; timeout_ms?: number }) => {
    return new Promise<string>((resolve) => {
      const shellConfig = getShellConfig();
      const configManager = new ConfigManager();
      const defaultTimeout = configManager.getCommandTimeoutMs();
      const requestedTimeout = typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms) && args.timeout_ms >= 1000
        ? Math.min(600_000, Math.floor(args.timeout_ms)) // cap superiore a 10 minuti
        : defaultTimeout;

      logSink.log(chalk.gray(`\n[Esecuzione di: ${args.command} (timeout: ${requestedTimeout / 1000}s)]`));

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
        logSink.log(chalk.red(`\n[Comando interrotto: superato il timeout di ${requestedTimeout / 1000}s]`));
        resolve(
          capForContext(
            `${combinedOutput}\n[ERRORE: il comando è stato interrotto dopo ${requestedTimeout / 1000} secondi di attesa. ` +
            `Se il comando richiede più tempo (es. build, installazioni, test lunghi), specifica un 'timeout_ms' maggiore; se è un server/demone in ascolto continuo, non avviarlo in foreground.]`,
            undefined,
            { label: `l'output del comando '${args.command}' (interrotto per timeout)` }
          )
        );
      }, requestedTimeout);

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
        logSink.log(chalk.gray(`[Comando terminato con codice: ${code}]`));

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

        // T8.8: il limite in byte sopra resta la guardia superiore; qui si applica in più
        // il tetto in token (più stretto) condiviso da tutti i tool, perché anche 50KB
        // possono da soli saturare la finestra di un modello locale.
        const capOptions = {
          label: `l'output del comando '${args.command}'`,
          recoveryHint: `Rilancia execute_command con un comando più mirato (es. filtrando con findstr/grep, ` +
            `oppure leggendo solo il file di log risultante con read_file e offset/limit).`
        };

        if (code === 0) {
          resolve(capForContext(resultOutput, undefined, capOptions) || '[Comando eseguito con successo, nessun output prodotto]');
        } else {
          resolve(capForContext(`${resultOutput}\n[Il processo è terminato con codice di errore: ${code}]`, undefined, capOptions));
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
