/**
 * Execution sandbox contract (T25.1).
 *
 * `execute_command` owns the policy of a command run — timeout, cancellation, output cap,
 * messages — while a sandbox backend owns the mechanism: how the shell process is started,
 * what it can reach, and how its whole tree is stopped. Consumers depend on this contract
 * only; no `child_process` or backend SDK type crosses it, so a confining backend (MXC,
 * T25.2) plugs in beside `host` without touching the tool.
 */

/** What to run and where. `env` is already credential-free (`buildChildEnv`, T24.1). */
export interface SandboxLaunchRequest {
  /** Command line handed verbatim to the backend's shell. */
  command: string;
  /** Working directory of the shell. */
  cwd: string;
  /**
   * The one directory the command may modify: the effective workspace root, i.e. a PARALLEL
   * branch's staging folder when one is active. Confining backends grant exactly this;
   * `host` cannot enforce it and ignores it.
   */
  workspaceRoot: string;
  /** Complete environment of the shell; backends must not merge the host's on top. */
  env: NodeJS.ProcessEnv;
}

/** Terminal state of a sandboxed process; `null` when it ended by a signal. */
export interface SandboxExit {
  exitCode: number | null;
}

/** A running command, as seen by the tool. */
export interface SandboxProcess {
  /** Subscribes to decoded stdout chunks, delivered as they arrive. */
  onStdout(listener: (text: string) => void): void;
  /** Subscribes to decoded stderr chunks, delivered as they arrive. */
  onStderr(listener: (text: string) => void): void;
  /** Settles after the output streams close; rejects when the process could not start. */
  readonly exited: Promise<SandboxExit>;
  /** Stops the process and all its descendants, escalating to a forced kill after the grace period. */
  terminate(gracePeriodMs: number): Promise<void>;
}

/** Availability report shown to the user, so a missing backend is a visible refusal. */
export interface SandboxStatus {
  name: string;
  available: boolean;
  /** Why the backend cannot run here, and how to fix it; set only when unavailable. */
  reason?: string;
  /** What the backend confines (or does not), for banners and status lines. */
  detail?: string;
}

export interface ExecutionSandbox {
  /** Registry key, matched against `sandbox.backend` in tsuka.config.json. */
  readonly name: string;
  describe(): SandboxStatus;
  /**
   * Starts the command. May throw synchronously when the launch is refused outright;
   * asynchronous start failures surface as a rejection of `exited`.
   */
  launch(request: SandboxLaunchRequest): SandboxProcess;
}
