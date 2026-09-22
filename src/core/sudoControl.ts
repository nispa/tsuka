import { PermissionManager } from '../safety/permissions';

/** Shared user-command boundary; agents cannot enable this through a tool. */
export function controlSudo(permissions: PermissionManager, argument: string): string {
  const action = argument.trim().toLowerCase();
  if (action === 'on' || action === 'off') permissions.setSudo(action === 'on');
  else if (action !== '' && action !== 'status') return 'Usage: /sudo [on|off|status]';
  return permissions.isSudo()
    ? 'SUDO ON — shell commands and file write/edit operations are authorized for all agents in this session, regardless of role or model tier. OS privileges are unchanged. Use /sudo off to revoke.'
    : 'SUDO OFF — normal command and file modification approval rules apply. Use /sudo on to enable.';
}
