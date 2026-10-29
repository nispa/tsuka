import { spawn } from 'child_process';
import { getShellConfig } from '../../core/platform';
import { ExecutionSandbox, SandboxExit, SandboxLaunchRequest, SandboxProcess } from './types';

/**
 * Default backend: the platform shell started directly on the host, with the user's own
 * privileges. Starting in the workspace and without credentials is containment, not a
 * jail — the real boundary here is the command classifier plus the confirmation prompt.
 */
export const hostSandbox: ExecutionSandbox = {
  name: 'host',

  describe: () => ({ name: 'host', available: true, detail: 'unconfined shell with your privileges' }),

  launch(request: SandboxLaunchRequest): SandboxProcess {
    const shellConfig = getShellConfig();
    const child = spawn(
      shellConfig.shell,
      shellConfig.buildArgs(request.command),
      { ...shellConfig.spawnOptions, cwd: request.cwd, env: request.env }
    );

    // Subscribed now, before any event can fire: `error` is how a missing shell or a bad cwd
    // is reported, and `close` (not `exit`) waits for stdout/stderr to drain.
    const exited = new Promise<SandboxExit>((resolve, reject) => {
      child.once('close', (code) => resolve({ exitCode: code }));
      child.once('error', reject);
    });

    return {
      onStdout: (listener) => { child.stdout.on('data', (data) => listener(data.toString())); },
      onStderr: (listener) => { child.stderr.on('data', (data) => listener(data.toString())); },
      exited,
      terminate: (gracePeriodMs) => shellConfig.terminateTree(child, gracePeriodMs),
    };
  },
};
