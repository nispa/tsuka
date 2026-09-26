import { TOOLS_DEFAULTS } from './constants';

/**
 * Credential policy of the harness (T24.1, T24.2) — the one place that decides which
 * names and values are secrets, and the two ways they are kept from the model:
 *
 * - `buildChildEnv`: processes started on the model's behalf (shell, MCP servers) get
 *   TSUKA's environment without credentials, so a command cannot print a key;
 * - `redactCredentials`: every tool result is scrubbed of known secret values before it
 *   enters the conversation, so reading a `.env` file or echoing a passthrough token
 *   does not ship the value to the provider.
 *
 * Only *known* secrets can be recognized: values present in TSUKA's environment or
 * declared to it. A password sitting in some unrelated file is just text.
 */

/** Names that carry credentials by convention. */
export const SENSITIVE_ENV_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;

/**
 * Names matching the pattern that hold a path, not a secret, and that everyday
 * commands rely on: git over SSH needs the agent socket, GUI tools the X cookie path.
 */
const NON_SECRET_NAMES = new Set(['SSH_AUTH_SOCK', 'XAUTHORITY']);

/**
 * Names declared as credentials whatever they are called — the provider catalog's
 * `apiKeyEnv` entries — so a key variable named e.g. `OPENROUTER` is still protected.
 */
const declaredNames = new Set<string>();

/** Secret values handed to TSUKA outside its environment (an MCP server's `env`). */
const declaredValues = new Map<string, string>();

export function declareCredentialEnvName(name: string): void {
  declaredNames.add(name.toUpperCase());
}

/** Registers the credential-named entries of an explicit env map (e.g. an MCP server's). */
export function declareCredentialValues(env: Record<string, string>): void {
  for (const [name, value] of Object.entries(env)) {
    if (isSensitiveEnvName(name) && typeof value === 'string') declaredValues.set(value, name);
  }
}

export function isSensitiveEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  if (declaredNames.has(upper)) return true;
  return SENSITIVE_ENV_NAME.test(name) && !NON_SECRET_NAMES.has(upper);
}

/**
 * TSUKA's environment without credentials, plus the named `passthrough` variables and
 * the explicit `extra` values. Names compare case-insensitively, as on Windows.
 * This cleans the environment, not the disk: output is covered by redactCredentials.
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

/** Known secret values, longest first so a key containing another is replaced whole. */
function knownSecrets(): Array<[string, string]> {
  const secrets = new Map<string, string>(declaredValues);
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && isSensitiveEnvName(name)) secrets.set(value, name);
  }
  // Short values ("1", "true", a port) would blank out ordinary text, not protect a key.
  return Array.from(secrets.entries())
    .filter(([value]) => value.length >= TOOLS_DEFAULTS.redactionMinSecretChars)
    .sort((a, b) => b[0].length - a[0].length);
}

/**
 * Replaces every known secret value in `text` with `[REDACTED:<NAME>]`. Recomputed on
 * each call: the environment is read live, so a key loaded later is covered too.
 */
export function redactCredentials(text: string): string {
  let result = text;
  for (const [value, name] of knownSecrets()) {
    if (result.includes(value)) result = result.split(value).join(`[REDACTED:${name}]`);
  }
  return result;
}
