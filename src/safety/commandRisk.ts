import { RiskLevel } from './permissions';

/**
 * Per-invocation risk classification for shell commands (T18.1).
 *
 * `execute_command` is declared DANGEROUS as a tool, which is the correct *static* answer: the
 * tool can run anything. But it makes every invocation equal, so `git status` and `curl … | sh`
 * both cost a full interactive confirmation. The practical effect is that no autonomous role can
 * be given execution at all — which is why `developer` does not have the tool in `allowedTools`
 * and cannot run the tests it just wrote.
 *
 * The unit of trust has to be the *command*, not the tool. This module answers "how dangerous is
 * this particular command", and the registry uses it to pick the permission tier for that one
 * call.
 *
 * Three rules make this safe rather than a bypass surface:
 *
 *  1. **Deny by default.** Anything unrecognized is DANGEROUS. The lists below grant, never deny.
 *  2. **Never match on a prefix.** `npm test; rm -rf /` starts with an allowed command; matching
 *     a prefix would clear it. Patterns are anchored to the whole command.
 *  3. **Never interpret shell operators.** A command containing `;`, `|`, `&&`, redirection,
 *     backticks or `$(…)` is escalated unconditionally instead of being split and analysed.
 *     Deciding whether a composed shell line is safe means reimplementing the shell, and every
 *     such attempt loses to quoting eventually.
 */

/** Shell syntax that composes, redirects or substitutes — never analysed, always escalated. */
const SHELL_OPERATORS = /[;|&><`\n\r]|\$\(|\$\{/;

/**
 * Read-only inspection: writes nothing outside its own stdout. Safe to run unattended, because
 * the worst outcome is noise in the transcript.
 */
const SAFE_COMMANDS: RegExp[] = [
  /^git\s+(status|diff|log|show|branch|remote|blame|describe|rev-parse|ls-files)\b(?!.*\s-(d|D|f)\b)/,
  /^(ls|dir|pwd|whoami|hostname|date)\s*$/,
  /^(cat|head|tail|wc|file|stat)\s+\S+/,
  /^(node|npm|npx|python|python3|pip|tsc|git|docker)\s+(--version|-v|--help)\s*$/,
  /^npx\s+tsc\s+--noEmit\b/,
  /^tsc\s+--noEmit\b/,
  /^echo\s+/,
];

/**
 * Effects confined to the project: the build, the test run, dependency and VCS bookkeeping.
 * These land on RESTRICTED rather than SAFE because they do write — but RESTRICTED already
 * supports "approve for the rest of the session", so an agent debugging its own code pays one
 * confirmation instead of one per iteration. That is the whole point of the tier split.
 */
const WORKSPACE_COMMANDS: RegExp[] = [
  /^npm\s+(test|run\s+[a-z0-9:_-]+|ci|install|i)\s*[a-z0-9@/._-]*\s*$/,
  /^(npx|yarn|pnpm)\s+[a-z0-9@/._-]+\s*[a-z0-9@/._:-]*\s*$/,
  /^git\s+(add|commit|checkout|switch|restore|stash|fetch|merge|rebase)\b/,
  /^(mkdir|touch|cp|mv)\s+\S+/,
  /^(node|python|python3)\s+[a-zA-Z0-9._/\-]+\s*$/,
  /^(tsc|jest|vitest|mocha|pytest|cargo|go|dotnet)\b/,
];

/**
 * Classifies a single shell command. Returns the tier the permission manager should apply to
 * this invocation, never lower than what the command actually warrants.
 */
export function classifyCommandRisk(rawCommand: unknown): RiskLevel {
  if (typeof rawCommand !== 'string') return 'DANGEROUS';
  const command = rawCommand.trim();
  if (command.length === 0) return 'DANGEROUS';

  // Rule 3: composition, redirection or substitution — do not try to reason about it.
  if (SHELL_OPERATORS.test(command)) return 'DANGEROUS';

  // Rule 2: anchored, whole-command matching (the patterns above all start with ^).
  if (SAFE_COMMANDS.some((re) => re.test(command))) return 'SAFE';
  if (WORKSPACE_COMMANDS.some((re) => re.test(command))) return 'RESTRICTED';

  // Rule 1: anything else.
  return 'DANGEROUS';
}
