import { ChildProcess } from 'child_process';

/**
 * Astrazione della shell di sistema per l'esecuzione di comandi.
 * Windows resta la piattaforma primaria (PowerShell), ma l'harness funziona
 * anche su Linux e macOS tramite /bin/sh.
 */

export interface ShellConfig {
  /** Eseguibile della shell */
  shell: string;
  /** Costruisce gli argomenti per eseguire un comando come stringa */
  buildArgs: (command: string) => string[];
  /** Opzioni extra per spawn (es. detached per il process group kill su POSIX) */
  spawnOptions: { detached?: boolean; windowsHide?: boolean };
  /** Termina il processo (e il suo gruppo su POSIX) in modo affidabile */
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

  // Linux / macOS: /bin/sh è garantito su qualsiasi sistema POSIX
  return {
    shell: '/bin/sh',
    buildArgs: (command: string) => ['-c', command],
    // detached crea un nuovo process group: permette di uccidere l'intero albero
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
