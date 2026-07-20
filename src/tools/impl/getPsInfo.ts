import { spawn } from 'child_process';
import { Tool } from '../registry';
import { getShellConfig, isWindows } from '../../core/platform';

// Regex per escludere variabili d'ambiente potenzialmente sensibili (API key, token, password)
const SENSITIVE_ENV_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH/i;

function buildCommand(category: 'processes' | 'services' | 'disk' | 'env'): string {
  if (isWindows()) {
    switch (category) {
      case 'processes':
        return 'Get-Process | Sort-Object -Property WorkingSet -Descending | Select-Object -First 15 -Property Name, Id, CPU, WorkingSet | ConvertTo-Json';
      case 'services':
        return 'Get-Service | Where-Object {$_.Status -eq "Running"} | Select-Object -Property Name, DisplayName, Status | ConvertTo-Json';
      case 'disk':
        return 'Get-Volume | Select-Object -Property DriveLetter, FriendlyName, Size, SizeRemaining | ConvertTo-Json';
      case 'env':
        // Filtro lato PowerShell (case-insensitive di default)
        return 'Get-ChildItem Env: | Where-Object { $_.Name -notmatch \'KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH\' } | Select-Object -Property Name, Value | ConvertTo-Json';
    }
  }

  // Linux / macOS (POSIX sh)
  const isMac = process.platform === 'darwin';
  switch (category) {
    case 'processes':
      return isMac
        ? 'ps aux -r | head -n 16'
        : 'ps aux --sort=-%mem | head -n 16';
    case 'services':
      return isMac
        ? 'launchctl list | head -n 30'
        : 'systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -n 30 || service --status-all 2>/dev/null | head -n 30';
    case 'disk':
      return 'df -h';
    case 'env':
      return 'printenv';
  }
}

export const getPsInfoTool: Tool = {
  name: 'get_ps_info',
  riskLevel: 'SAFE',
  execute: async (args: { category: 'processes' | 'services' | 'disk' | 'env' }) => {
    const command = buildCommand(args.category);
    const shellConfig = getShellConfig();

    return new Promise<string>((resolve) => {
      const child = spawn(shellConfig.shell, shellConfig.buildArgs(command), shellConfig.spawnOptions);

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });
      child.stderr.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        // Su POSIX il dump env viene filtrato lato JS (su Windows è filtrato dal comando stesso)
        if (args.category === 'env' && !isWindows()) {
          output = output
            .split(/\r?\n/)
            .filter((line) => !SENSITIVE_ENV_PATTERN.test(line.split('=')[0]))
            .join('\n');
        }

        if (code !== 0) {
          resolve(`Errore durante l'esecuzione del comando di sistema (Codice uscita: ${code}).\nOutput: ${output}`);
        } else {
          resolve(output || 'Nessun elemento trovato.');
        }
      });

      child.on('error', (err) => {
        resolve(`Impossibile avviare la shell di sistema: ${err.message}`);
      });
    });
  }
};
