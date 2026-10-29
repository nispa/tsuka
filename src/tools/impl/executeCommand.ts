import chalk from 'chalk';
import { Tool, ToolExecutionContext } from '../registry';
import { capForContext } from '../../core/contextBudget';
import { logSink } from '../../core/logSink';
import { ConfigManager } from '../../core/config';
import { classifyCommandRisk } from '../../safety/commandRisk';
import { TOOLS_DEFAULTS } from '../../core/constants';
import { buildChildEnv } from '../../core/credentials';
import { getEffectiveRoot } from './utils';
import { ExecutionSandbox, getExecutionSandbox, SandboxProcess } from '../../safety/sandbox';


export const executeCommandTool: Tool = {
  name: 'execute_command',
  riskLevel: 'DANGEROUS',
  // T18.1: the capability stays DANGEROUS; the individual call is graded by what it actually
  // runs, so a read-only inspection does not cost the same confirmation as an arbitrary script.
  classifyRisk: (args: { command?: string }) => classifyCommandRisk(args?.command),
  execute: async (args: { command: string; timeout_ms?: number }, context?: ToolExecutionContext) => {
    if (context?.signal?.aborted) {
      return '[ERROR: command cancelled before launch.]';
    }

    return new Promise<string>((resolve) => {
      const configManager = new ConfigManager();
      // T25.1: the tool owns the policy (timeout, abort, output cap); the configured sandbox
      // owns the mechanism. An unknown or unavailable backend refuses here, before anything
      // runs — falling back to the unconfined host shell would defeat having asked for one.
      let sandbox: ExecutionSandbox;
      try {
        sandbox = getExecutionSandbox(configManager.getSandboxBackend());
      } catch (err: any) {
        resolve(`[ERROR: ${err.message}]`);
        return;
      }
      const status = sandbox.describe();
      if (!status.available) {
        resolve(`[ERROR: execution sandbox '${status.name}' is not available: ${status.reason ?? 'no reason given'}. Nothing was executed.]`);
        return;
      }
      const defaultTimeout = configManager.getCommandTimeoutMs();
      const requestedTimeout = typeof args.timeout_ms === 'number' && Number.isFinite(args.timeout_ms) && args.timeout_ms >= TOOLS_DEFAULTS.commandMinTimeoutMs
        ? Math.min(TOOLS_DEFAULTS.commandMaxTimeoutMs, Math.floor(args.timeout_ms))
        : defaultTimeout;

      logSink.log(chalk.gray(`\n[Executing: ${args.command} (timeout: ${requestedTimeout / 1000}s)]`));

      // T18.1: run inside the workspace root rather than inheriting the harness process's cwd.
      // The file tools have always been confined by `resolveSafePath`, but the shell was not, so
      // a relative path in a command resolved against wherever TSUKA happened to be started.
      // This is containment, not a jail: `cd ..` still leaves, which is precisely why the
      // classifier above escalates anything it does not positively recognize.
      let child: SandboxProcess;
      try {
        child = sandbox.launch({
          command: args.command,
          cwd: configManager.getWorkspaceRoot(),
          workspaceRoot: getEffectiveRoot(),
          // T24.1: the shell never sees TSUKA's credentials unless the user named them.
          env: buildChildEnv(configManager.getCommandEnvPassthrough()),
        });
      } catch (err: any) {
        resolve(`Error launching command: ${err.message}`);
        return;
      }

      let combinedOutput = '';
      let terminalClaimed = false;
      let watchdog: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (watchdog) clearTimeout(watchdog);
        context?.signal?.removeEventListener('abort', onAbort);
      };

      const claimTerminal = (): boolean => {
        if (terminalClaimed) return false;
        terminalClaimed = true;
        cleanup();
        return true;
      };

      const terminateAndResolve = async (message: string, label: string) => {
        if (!claimTerminal()) return;
        await child.terminate(TOOLS_DEFAULTS.commandTerminationGraceMs);
        resolve(capForContext(`${combinedOutput}\n${message}`, undefined, { label }));
      };

      const onAbort = () => {
        logSink.log(chalk.red('\n[Command cancelled by user]'));
        void terminateAndResolve(
          '[ERROR: command cancelled by user.]',
          `command output for '${args.command}' (cancelled)`
        );
      };

      watchdog = setTimeout(() => {
        logSink.log(chalk.red(`\n[Command interrupted: exceeded timeout of ${requestedTimeout / 1000}s]`));
        void terminateAndResolve(
          `[ERROR: command timed out after ${requestedTimeout / 1000} seconds. ` +
            `For long-running tasks, specify a higher timeout_ms; do not launch background servers in foreground.]`,
          `command output for '${args.command}' (timed out)`
        );
      }, requestedTimeout);

      context?.signal?.addEventListener('abort', onAbort, { once: true });
      if (context?.signal?.aborted) onAbort();

      child.onStdout((text) => {
        if (terminalClaimed) return;
        combinedOutput += text;
        logSink.write(chalk.white(text));
      });

      child.onStderr((text) => {
        if (terminalClaimed) return;
        combinedOutput += text;
        logSink.write(chalk.red(text));
      });

      child.exited.then(({ exitCode: code }) => {
        if (!claimTerminal()) return;
        logSink.log(chalk.gray(`[Command completed with code: ${code}]`));

        let resultOutput = combinedOutput;
        if (resultOutput.length > TOOLS_DEFAULTS.commandMaxOutputBytes) {
          const tail = resultOutput.slice(-TOOLS_DEFAULTS.commandMaxOutputBytes);
          const parts = tail.split(/\r?\n/);
          parts.shift();
          resultOutput =
            `[Output truncated: ${Buffer.byteLength(combinedOutput, 'utf-8')} bytes total, ` +
            `showing last ~${TOOLS_DEFAULTS.commandMaxOutputBytes / 1024}KB]\n` + parts.join('\n');
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
      }, (err) => {
        if (!claimTerminal()) return;
        resolve(`Error launching command: ${err.message}`);
      });
    });
  }
};
