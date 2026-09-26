/**
 * Environment handed to processes started on the model's behalf (T24.1).
 *
 * TSUKA's own environment carries the provider API keys. A shell command or an MCP
 * server started with it could read and print them, and the output would travel back
 * into the context sent to the provider. Children therefore get TSUKA's environment
 * minus every variable whose name looks like a credential; anything a command really
 * needs must be passed explicitly (`commandEnvPassthrough`, or an MCP server's `env`).
 *
 * This cleans the environment, not the disk: a command can still read a `.env` file
 * from the workspace (T24.2).
 */

/** Names that carry credentials — the single pattern for the whole harness. */
export const SENSITIVE_ENV_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;

/**
 * Names matching the pattern that hold a path, not a secret, and that everyday
 * commands rely on: git over SSH needs the agent socket, GUI tools the X cookie path.
 */
const NON_SECRET_NAMES = new Set(['SSH_AUTH_SOCK', 'XAUTHORITY']);

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_NAME.test(name) && !NON_SECRET_NAMES.has(name.toUpperCase());
}

/**
 * TSUKA's environment without credentials, plus the named `passthrough` variables and
 * the explicit `extra` values. Names compare case-insensitively, as on Windows.
 */
export function buildChildEnv(passthrough: string[] = [], extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allowed = new Set(passthrough.map((name) => name.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (isSensitiveEnvName(name) && !allowed.has(name.toUpperCase())) continue;
    env[name] = value;
  }
  return { ...env, ...extra };
}
