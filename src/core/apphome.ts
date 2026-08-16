import * as path from 'path';
import * as fs from 'fs';

/**
 * Application Home vs Workspace — key distinction for the global CLI command.
 *
 * - **App home**: The TSUKA installation directory, housing app assets
 *   (tools_schemas/, roles/, traits/, characters/, teams/), configuration
 *   (tsuka.config.json, .env), persistent shared memory (memory/), model profiles
 *   (models_profile.json), and prompt history.
 * - **Workspace**: The directory from which the command is executed (process.cwd()),
 *   where file tools operate (read/write/edit/list/grep with relative paths).
 *
 * Hierarchical homePath resolution:
 * 1. If a local `.tsuka/` folder exists in the current workspace, resources are resolved there first.
 * 2. Otherwise, fall back to the App Home (`TSUKA_HOME` env var or package root).
 */
export function getAppHome(): string {
  const env = process.env.TSUKA_HOME;
  if (env && env.trim().length > 0) {
    return path.resolve(env.trim());
  }
  return path.resolve(__dirname, '..', '..');
}

/** Resolves a path inside the app home or local .tsuka/ directory. */
export function homePath(...segments: string[]): string {
  try {
    const wsRoot = process.cwd();
    if (wsRoot) {
      const localTsukaPath = path.join(wsRoot, '.tsuka', ...segments);
      if (fs.existsSync(localTsukaPath)) {
        return localTsukaPath;
      }
    }
  } catch {}
  return path.join(getAppHome(), ...segments);
}
