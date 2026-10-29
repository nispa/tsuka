import * as path from 'path';
import type { Readable } from 'stream';
import { ConfigManager } from '../../core/config';
import { SANDBOX_DEFAULTS } from '../../core/constants';
import { getShellConfig } from '../../core/platform';
import { ExecutionSandbox, SandboxExit, SandboxLaunchRequest, SandboxProcess, SandboxStatus } from './types';

/**
 * Microsoft eXecution Containers backend (T25.2): the platform shell runs inside an OS
 * container whose policy denies by default — the workspace is the only readable and
 * writable tree, outbound network is denied unless `sandbox.network` allows it, and the
 * environment is exactly the credential-free one the tool passes. If the host cannot
 * apply the policy, MXC refuses to start rather than run weaker.
 *
 * The SDK is an optional, ESM-only dependency. It is loaded with `require()` only when this
 * backend is selected (Node >= 22.12 loads synchronous ESM that way; MXC needs a newer Node
 * anyway), and only through the narrow structural types below, so TSUKA compiles and runs
 * without the package and no SDK type leaks past this file.
 */

/** Container backend per OS. Only the stable default of each platform; never experimental ones. */
const CONTAINMENT_BY_PLATFORM: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'processcontainer',
  linux: 'bubblewrap',
  darwin: 'seatbelt',
};

/** Variables MXC's Windows backend rejects an explicit environment without (`policy_validation`, T25.0). */
const WINDOWS_REQUIRED_ENV = ['SYSTEMROOT', 'LOCALAPPDATA'];

const SDK_MODULE = '@microsoft/mxc-sdk/v1';

/** The subset of `ContainerRequest` TSUKA builds. */
export interface MxcContainerRequest {
  command: string;
  workingDirectory: string;
  filesystem: { readwritePaths: string[]; readonlyPaths: string[] };
  network: { egress: { default: 'deny' | 'allow' } };
  ui: { disable: boolean };
  environment: Record<string, string>;
  containment: { type: string };
}

/** The subset of `MxcProcess` TSUKA uses. */
export interface MxcProcessLike {
  readonly standardOutput: Readable | null;
  readonly standardError: Readable | null;
  wait(): Promise<{ exitCode: number; timedOut: boolean }>;
  kill(): void;
  dispose(): void;
}

/** The subset of `@microsoft/mxc-sdk/v1` TSUKA uses; tests inject a fake with this shape. */
export interface MxcSdkLike {
  getPlatformSupport(): { isSupported: boolean; reason?: string; availableMethods: string[] };
  spawn(request: MxcContainerRequest): Promise<MxcProcessLike>;
}

export interface MxcSandboxDeps {
  loadSdk: () => MxcSdkLike;
  nodeVersion: string;
  platform: NodeJS.Platform;
  network: () => 'deny' | 'allow';
}

const defaultDeps: MxcSandboxDeps = {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  loadSdk: () => require(SDK_MODULE) as MxcSdkLike,
  nodeVersion: process.versions.node,
  platform: process.platform,
  network: () => new ConfigManager().getSandboxNetwork(),
};

/** Why this Node cannot drive MXC streaming, or null when it can. */
export function mxcNodeProblem(version: string): string | null {
  const [major, minor] = version.split('.').map((part) => Number.parseInt(part, 10));
  const minimums = SANDBOX_DEFAULTS.mxcNodeMinimums;
  const line = minimums.find((entry) => entry.major === major);
  const newest = Math.max(...minimums.map((entry) => entry.major));
  if (line ? minor >= line.minor : major > newest) return null;
  const wanted = minimums.map((entry) => `>= ${entry.major}.${entry.minor}`).join(' or ');
  return `MXC needs Node ${wanted} (this is ${version}); install a newer Node and restart TSUKA`;
}

/** Windows command-line quoting, the same rule libuv applies when Node spawns a process. */
function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    out += ch === '"' ? '\\'.repeat(backslashes * 2 + 1) + '"' : '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  return out + '\\'.repeat(backslashes * 2) + '"';
}

function quotePosixArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The same shell invocation `host` spawns, flattened into the single command line MXC takes,
 * so a command means the same thing under both backends.
 */
export function buildMxcCommandLine(command: string, platform: NodeJS.Platform): string {
  const shell = getShellConfig();
  const quote = platform === 'win32' ? quoteWindowsArg : quotePosixArg;
  return [shell.shell, ...shell.buildArgs(command)].map(quote).join(' ');
}

/** Pure policy construction, exported so the contract test can pin every field. */
export function buildMxcRequest(
  request: SandboxLaunchRequest,
  containment: string,
  network: 'deny' | 'allow',
  platform: NodeJS.Platform
): MxcContainerRequest {
  const workspaceRoot = path.resolve(request.workspaceRoot);
  const cwd = path.resolve(request.cwd);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.env)) {
    if (typeof value === 'string') environment[key] = value;
  }
  if (platform === 'win32') {
    // Windows names are case-insensitive but the validator may not be: keep one uppercase entry.
    for (const name of WINDOWS_REQUIRED_ENV) {
      const variants = Object.keys(environment).filter((key) => key.toUpperCase() === name);
      const value = variants.length > 0 ? environment[variants[0]] : process.env[name];
      variants.forEach((key) => delete environment[key]);
      if (value) environment[name] = value;
    }
  }
  return {
    command: buildMxcCommandLine(request.command, platform),
    workingDirectory: cwd,
    filesystem: {
      readwritePaths: [workspaceRoot],
      // A PARALLEL branch starts in the real workspace but may only write its staging folder:
      // the real tree stays readable, and a write there fails loudly instead of bypassing the merge.
      readonlyPaths: cwd === workspaceRoot ? [] : [cwd],
    },
    network: { egress: { default: network } },
    // T25.0: with UI disabled every executable that loads user32.dll (PowerShell, node, git)
    // dies with STATUS_DLL_INIT_FAILED. Clipboard and input injection stay denied separately.
    ui: { disable: false },
    environment,
    containment: { type: containment },
  };
}

/** Resolves when a stream has nothing more to deliver, whichever way it ended. */
function drained(stream: Readable | null): Promise<void> {
  if (!stream) return Promise.resolve();
  return new Promise((resolve) => {
    stream.once('end', () => resolve());
    stream.once('close', () => resolve());
    stream.once('error', () => resolve());
  });
}

export function createMxcSandbox(deps: MxcSandboxDeps = defaultDeps): ExecutionSandbox {
  const unavailable = (reason: string): SandboxStatus => ({ name: 'mxc', available: false, reason });

  /** Loads the SDK and checks the host, returning the SDK and containment or the refusal. */
  const resolveHost = (): { sdk: MxcSdkLike; containment: string } | SandboxStatus => {
    const nodeProblem = mxcNodeProblem(deps.nodeVersion);
    if (nodeProblem) return unavailable(nodeProblem);
    const containment = CONTAINMENT_BY_PLATFORM[deps.platform];
    if (!containment) return unavailable(`MXC has no backend for platform '${deps.platform}'`);
    let sdk: MxcSdkLike;
    try {
      sdk = deps.loadSdk();
    } catch (err: any) {
      return unavailable(
        `the optional package @microsoft/mxc-sdk could not be loaded (${err?.message ?? err}); ` +
        `reinstall TSUKA with optional dependencies (npm install --include=optional)`
      );
    }
    try {
      const support = sdk.getPlatformSupport();
      if (!support.isSupported) return unavailable(`MXC is not supported on this host: ${support.reason || 'no reason given'}`);
      if (!support.availableMethods.includes(containment)) {
        return unavailable(`MXC backend '${containment}' is not available here (available: ${support.availableMethods.join(', ') || 'none'})`);
      }
    } catch (err: any) {
      return unavailable(`MXC platform probe failed: ${err?.message ?? err}`);
    }
    return { sdk, containment };
  };

  return {
    name: 'mxc',

    describe(): SandboxStatus {
      const host = resolveHost();
      if ('available' in host) return host;
      return { name: 'mxc', available: true, detail: `${host.containment}, workspace only, network ${deps.network()}` };
    },

    launch(request: SandboxLaunchRequest): SandboxProcess {
      const host = resolveHost();
      if ('available' in host) throw new Error(`execution sandbox 'mxc' is not available: ${host.reason}`);

      const stdoutListeners: Array<(text: string) => void> = [];
      const stderrListeners: Array<(text: string) => void> = [];
      let proc: MxcProcessLike | null = null;
      let killRequested = false;

      // MXC spawns asynchronously while the contract hands back a handle at once: listeners
      // registered now are attached when the container exists, and a terminate() that
      // arrives first kills it the moment it starts.
      const exited = (async (): Promise<SandboxExit> => {
        let started: MxcProcessLike | null = null;
        try {
          started = await host.sdk.spawn(buildMxcRequest(request, host.containment, deps.network(), deps.platform));
          proc = started;
          // Streams must be taken before wait(), which otherwise drains and discards them.
          const stdout = started.standardOutput;
          const stderr = started.standardError;
          stdout?.setEncoding('utf8');
          stderr?.setEncoding('utf8');
          stdout?.on('data', (text: string) => stdoutListeners.forEach((listener) => listener(text)));
          stderr?.on('data', (text: string) => stderrListeners.forEach((listener) => listener(text)));
          if (killRequested) started.kill();
          const [result] = await Promise.all([started.wait(), drained(stdout), drained(stderr)]);
          return { exitCode: killRequested ? null : result.exitCode };
        } catch (err: any) {
          const code = err?.code ? ` [${err.code}]` : '';
          throw new Error(`MXC${code}: ${err?.message ?? err}`);
        } finally {
          started?.dispose();
        }
      })();

      return {
        onStdout: (listener) => { stdoutListeners.push(listener); },
        onStderr: (listener) => { stderrListeners.push(listener); },
        exited,
        // MXC kills the whole container at once (T25.0: shell and grandchild gone in ~120 ms),
        // so there is no cooperative phase to give a grace period to; only the wait is bounded.
        terminate: async () => {
          killRequested = true;
          try { proc?.kill(); } catch {}
          await Promise.race([
            exited.then(() => undefined, () => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, SANDBOX_DEFAULTS.mxcKillSettleMs).unref()),
          ]);
        },
      };
    },
  };
}

export const mxcSandbox = createMxcSandbox();
