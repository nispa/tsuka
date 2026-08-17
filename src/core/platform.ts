import { ChildProcess } from 'child_process';

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
  /** Terminates the process (and its process group on POSIX) reliably */
  kill: (child: ChildProcess) => void;
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
      kill: (child) => {
        try { child.kill(); } catch {}
      }
    };
  }

  // Linux / macOS: /bin/sh is standard across POSIX environments
  return {
    shell: '/bin/sh',
    buildArgs: (command: string) => ['-c', command],
    // detached creates a new process group: allows killing entire subtree
    spawnOptions: { detached: true },
    kill: (child) => {
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGKILL');
          return;
        }
      } catch {}
      try { child.kill('SIGKILL'); } catch {}
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
