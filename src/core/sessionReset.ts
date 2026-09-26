import type { PermissionManager } from '../safety/permissions';
import { ContextTracker } from './contextTracker';

/**
 * What a session reset clears in every interface: session permissions (/sudo, "always"
 * grants) and the context tracker behind /context and the scheduler metrics. One function
 * because the CLI and the TUI had drifted — the TUI's /reset left the tracker full, so
 * /context still reported the previous session.
 */
export function resetSessionState(permissionManager: PermissionManager): void {
  permissionManager.resetSession();
  ContextTracker.getInstance().clear();
}
