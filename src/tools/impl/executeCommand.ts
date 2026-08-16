import { spawn } from 'child_process';
import chalk from 'chalk';
import { Tool } from '../registry';
import { getShellConfig } from '../../core/platform';
import { capForContext } from '../../core/contextBudget';
import { logSink } from '../../core/logSink';
import { ConfigManager } from '../../core/config';

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
        ? Math.min(600_000, Math.floor(args.timeout_ms))
        : defaultTimeout;

      logSink.log(chalk.gray(`\n[Executing: ${args.command} (timeout: ${requestedTimeout / 1000}s)]`));

      const child = spawn(
        shellConfig.shell,
        shellConfig.buildArgs(args.command),
        shellConfig.spawnOptions
      );

      let combinedOutput = '';
      let settled = false;

      const watchdog = setTimeout(() => {
        if (settled) return;
        settled = true;
        shellConfig.kill(child);
        logSink.log(chalk.red(`\n[Command interrupted: exceeded timeout of ${requestedTimeout / 1000}s]`));
        resolve(
          capForContext(
            `${combinedOutput}\n[ERROR: command timed out after ${requestedTimeout / 1000} seconds. ` +
            `For long-running tasks, specify a higher timeout_ms; do not launch background servers in foreground.]`,
            undefined,
            { label: `command output for '${args.command}' (timed out)` }
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
        logSink.log(chalk.gray(`[Command completed with code: ${code}]`));

        let resultOutput = combinedOutput;
        if (resultOutput.length > MAX_OUTPUT_BYTES) {
          const tail = resultOutput.slice(-MAX_OUTPUT_BYTES);
          const parts = tail.split(/\r?\n/);
          parts.shift();
          resultOutput =
            `[Output truncated: ${Buffer.byteLength(combinedOutput, 'utf-8')} bytes total, ` +
            `showing last ~${MAX_OUTPUT_BYTES / 1024}KB]\n` + parts.join('\n');
        }

        const capOptions = {
          label: `command output for '${args.command}'`,
          recoveryHint: `Rerun execute_command with targeted filtering (grep/findstr) or read resulting logs with read_file.`
        };

        if (code === 0) {
          resolve(capForContext(resultOutput, undefined, capOptions) || '[Command executed successfully, no output produced]');
        } else {
          resolve(capForContext(`${resultOutput}\n[Process exited with code: ${code}]`, undefined, capOptions));
        }
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolve(`Error launching command: ${err.message}`);
      });
    });
  }
};
