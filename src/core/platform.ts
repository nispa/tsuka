import { ChildProcess, spawn } from 'child_process';

/**
 * System shell abstraction for command execution.
 * Windows remains the primary platform (PowerShell), but the harness also
 * works on Linux and macOS via /bin/sh.
 */

export interface ShellConfig {
  /** Shell executable name/path */
  shell: string;
  /** Constructs arguments to execute a command string */
  buildArgs: (command: string) => string[];
  /** Extra spawn options (e.g. detached for process group kill on POSIX) */
  spawnOptions: { detached?: boolean; windowsHide?: boolean };
  /** Terminates the shell and its descendants, escalating after the grace period. */
  terminateTree: (child: ChildProcess, gracePeriodMs: number) => Promise<void>;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(hasExited(child)), timeoutMs);
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolve(exited);
    };
    child.once('close', onClose);
  });
}

function runTaskkill(pid: number, force: boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    const killer = spawn('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      try { killer.kill(); } catch {}
      finish();
    }, timeoutMs);
    killer.once('close', finish);
    killer.once('error', finish);
  });
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function getPlatformName(): string {
  switch (process.platform) {
    case 'win32': return 'Windows';
    case 'darwin': return 'macOS';
    case 'linux': return 'Linux';
    default: return process.platform;
  }
}

export function getShellConfig(): ShellConfig {
  if (isWindows()) {
    return {
      shell: 'powershell.exe',
      buildArgs: (command: string) => [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command
      ],
      spawnOptions: { windowsHide: true },
      terminateTree: async (child, gracePeriodMs) => {
        if (!child.pid || hasExited(child)) return;
        await runTaskkill(child.pid, false, gracePeriodMs);
        if (await waitForExit(child, gracePeriodMs)) return;
        await runTaskkill(child.pid, true, gracePeriodMs);
        await waitForExit(child, gracePeriodMs);
      }
    };
  }

  // Linux / macOS: /bin/sh is standard across POSIX environments
  return {
    shell: '/bin/sh',
    buildArgs: (command: string) => ['-c', command],
    // detached creates a new process group: allows killing entire subtree
    spawnOptions: { detached: true },
    terminateTree: async (child, gracePeriodMs) => {
      if (!child.pid || hasExited(child)) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
      if (await waitForExit(child, gracePeriodMs)) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
      await waitForExit(child, gracePeriodMs);
    }
  };
}

/**
 * Copies text to the OS system clipboard cross-platform.
 */
export function copyToClipboard(text: string): boolean {
  try {
    const cp = require('child_process');
    if (isWindows()) {
      const proc = cp.spawn('clip.exe', [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      proc.stdin.write(text);
      proc.stdin.end();
      return true;
    } else if (process.platform === 'darwin') {
      const proc = cp.spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.stdin.write(text);
      proc.stdin.end();
      return true;
    } else {
      const proc = cp.spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.stdin.write(text);
      proc.stdin.end();
      return true;
    }
  } catch {
    return false;
  }
}
