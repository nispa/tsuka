import { spawn } from 'child_process';
import { Tool } from '../registry';
import { getShellConfig, isWindows } from '../../core/platform';

// Pattern to exclude sensitive environment variables (API keys, secrets, passwords)
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
        return 'Get-ChildItem Env: | Where-Object { $_.Name -notmatch \'KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH\' } | Select-Object -Property Name, Value | ConvertTo-Json';
    }
  }

  const isMac = process.platform === 'darwin';
  switch (category) {
    case 'processes':
      return isMac
        ? 'ps aux | head -n 16'
        : 'ps aux --sort=-%mem 2>/dev/null || ps aux | head -n 16';
    case 'services':
      return isMac
        ? 'launchctl list 2>/dev/null | head -n 30 || ps -ef | head -n 30'
        : 'systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | head -n 30 || service --status-all 2>/dev/null | head -n 30 || ps -ef | head -n 30';
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
        if (args.category === 'env' && !isWindows()) {
          output = output
            .split(/\r?\n/)
            .filter((line) => !SENSITIVE_ENV_PATTERN.test(line.split('=')[0]))
            .join('\n');
        }

        if (code !== 0) {
          resolve(`Error executing system command (Exit code: ${code}).\nOutput: ${output}`);
        } else {
          resolve(output || 'No items found.');
        }
      });

      child.on('error', (err) => {
        resolve(`Failed to launch system shell: ${err.message}`);
      });
    });
  }
};
