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

/** Resolves a path strictly inside the global App Home installation (tsuka.config.json, .env, models_profile.json, built-in assets). */
export function homePath(...segments: string[]): string {
  return path.join(getAppHome(), ...segments);
}

/** Resolves a path strictly inside the global App Home installation (alias of homePath). */
export function globalHomePath(...segments: string[]): string {
  return path.join(getAppHome(), ...segments);
}

/** Resolves a path inside the local .tsuka/ directory if present in current workspace. */
export function localWorkspacePath(...segments: string[]): string | null {
  try {
    const wsRoot = process.cwd();
    if (wsRoot) {
      const localTsukaDir = path.join(wsRoot, '.tsuka');
      if (fs.existsSync(localTsukaDir)) {
        return path.join(localTsukaDir, ...segments);
      }
    }
  } catch {}
  return null;
}

/**
 * Resolves an asset path: checks project-local .tsuka/ first (if file/folder exists),
 * otherwise falls back to global App Home.
 */
export function resolveAssetPath(...segments: string[]): string {
  const local = localWorkspacePath(...segments);
  if (local && fs.existsSync(local)) {
    return local;
  }
  return homePath(...segments);
}
