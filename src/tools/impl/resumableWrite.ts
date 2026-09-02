import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { TOOLS_DEFAULTS } from '../../core/constants';
import { resolveSafePath } from './utils';

const STAGING_DIRECTORY = '.tsuka-write-staging';
const STAGING_PREFIX = 'write-';
const STAGING_SUFFIX = '.part';

interface ResumableWriteSession {
  targetPath: string;
  stagePath: string;
  nextOffset: number;
  updatedAt: number;
}

export interface ResumableWriteStoreOptions {
  now?: () => number;
  staleMs?: number;
  cleanupMaxEntries?: number;
  maxActiveSessions?: number;
  stageNameAttempts?: number;
  stageNameRandomBytes?: number;
}

/** Narrow transactional storage boundary for resumable write_file calls. */
export interface IResumableWriteStore {
  start(targetPath: string): number;
  append(targetPath: string, offset: number, content: string): number;
  commit(targetPath: string): number;
  cleanup(targetPath: string): number;
}

/**
 * Default disk-backed transaction store. Staging stays beside its destination so it
 * inherits the already-validated workspace path, while the in-memory index prevents
 * duplicate or out-of-order chunks during this harness process.
 */
export class FileResumableWriteStore implements IResumableWriteStore {
  private readonly sessions = new Map<string, ResumableWriteSession>();
  private readonly now: () => number;
  private readonly staleMs: number;
  private readonly cleanupMaxEntries: number;
  private readonly maxActiveSessions: number;
  private readonly stageNameAttempts: number;
  private readonly stageNameRandomBytes: number;

  constructor(options: ResumableWriteStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.staleMs = options.staleMs ?? TOOLS_DEFAULTS.resumableWriteStaleMs;
    this.cleanupMaxEntries = options.cleanupMaxEntries ?? TOOLS_DEFAULTS.resumableWriteCleanupMaxEntries;
    this.maxActiveSessions = options.maxActiveSessions ?? TOOLS_DEFAULTS.resumableWriteMaxActiveSessions;
    this.stageNameAttempts = options.stageNameAttempts ?? TOOLS_DEFAULTS.resumableWriteStageNameAttempts;
    this.stageNameRandomBytes = options.stageNameRandomBytes ?? TOOLS_DEFAULTS.resumableWriteStageNameRandomBytes;
  }

  start(targetPath: string): number {
    this.cleanup(targetPath);
    if (this.sessions.has(targetPath)) {
      throw new Error(`A resumable write is already active for '${targetPath}'. Continue it at the reported offset or wait for cleanup.`);
    }
    if (this.sessions.size >= this.maxActiveSessions) {
      throw new Error('Too many active resumable writes. Finish an existing write or wait for stale sessions to be cleaned up.');
    }

    const stageDirectory = this.safeStageDirectory(targetPath);
    if (!stageDirectory) throw new Error('Could not access the resumable write staging directory.');
    let stagePath: string | undefined;
    for (let attempt = 0; attempt < this.stageNameAttempts; attempt++) {
      const name = `${STAGING_PREFIX}${crypto.randomBytes(this.stageNameRandomBytes).toString('hex')}${STAGING_SUFFIX}`;
      const candidate = path.join(stageDirectory, name);
      try {
        fs.closeSync(fs.openSync(candidate, 'wx'));
        stagePath = candidate;
        break;
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    if (!stagePath) throw new Error('Could not allocate a staging file for the resumable write.');

    const allocatedStagePath = stagePath;
    const session: ResumableWriteSession = { targetPath, stagePath: allocatedStagePath, nextOffset: 0, updatedAt: this.now() };
    this.sessions.set(targetPath, session);
    return session.nextOffset;
  }

  append(targetPath: string, offset: number, content: string): number {
    const session = this.sessions.get(targetPath);
    if (!session) {
      if (offset === 0) this.start(targetPath);
      else throw new Error(`No active resumable write exists for '${targetPath}'. Start with offset 0.`);
    }
    const active = this.sessions.get(targetPath)!;
    if (offset !== active.nextOffset) {
      throw new Error(`Unexpected offset for '${targetPath}': received ${offset}, expected ${active.nextOffset}. Chunks must be sent exactly once and in order.`);
    }
    const actualSize = fs.statSync(active.stagePath).size;
    if (actualSize !== active.nextOffset) {
      throw new Error(`Staging file for '${targetPath}' changed unexpectedly; transaction was not committed.`);
    }

    fs.appendFileSync(active.stagePath, content, 'utf8');
    active.nextOffset += Buffer.byteLength(content, 'utf8');
    active.updatedAt = this.now();
    return active.nextOffset;
  }

  commit(targetPath: string): number {
    const session = this.sessions.get(targetPath);
    if (!session) throw new Error(`No active resumable write exists for '${targetPath}'.`);
    if (fs.statSync(session.stagePath).size !== session.nextOffset) {
      throw new Error(`Staging file for '${targetPath}' changed unexpectedly; transaction was not committed.`);
    }

    // rename replaces the destination as one filesystem operation because staging is adjacent.
    fs.renameSync(session.stagePath, session.targetPath);
    this.sessions.delete(targetPath);
    this.removeEmptyStagingDirectory(path.dirname(targetPath));
    return session.nextOffset;
  }

  cleanup(targetPath: string): number {
    const parent = path.dirname(targetPath);
    const staleBefore = this.now() - this.staleMs;
    let removed = 0;

    for (const [key, session] of Array.from(this.sessions.entries()).slice(0, this.cleanupMaxEntries)) {
      if (session.updatedAt < staleBefore) {
        try { fs.unlinkSync(session.stagePath); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
        this.sessions.delete(key);
        removed++;
      }
    }

    const stageDirectory = this.safeStageDirectory(targetPath, false);
    if (!stageDirectory) return removed;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(stageDirectory, { withFileTypes: true }).slice(0, this.cleanupMaxEntries);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return removed;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(STAGING_PREFIX) || !entry.name.endsWith(STAGING_SUFFIX)) continue;
      const stagedPath = path.join(stageDirectory, entry.name);
      if (fs.statSync(stagedPath).mtimeMs >= staleBefore) continue;
      fs.unlinkSync(stagedPath);
      for (const [key, session] of this.sessions) {
        if (session.stagePath === stagedPath) this.sessions.delete(key);
      }
      removed++;
    }
    this.removeEmptyStagingDirectory(parent);
    return removed;
  }

  private removeEmptyStagingDirectory(parent: string): void {
    const stageDirectory = this.safeStageDirectory(path.join(parent, 'placeholder'), false);
    if (!stageDirectory) return;
    try { fs.rmdirSync(stageDirectory); } catch (error: any) { if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error; }
  }

  /** Re-resolve the staging directory so a workspace symlink cannot redirect chunks outside the jail. */
  private safeStageDirectory(targetPath: string, create = true): string | undefined {
    const stageDirectory = path.join(path.dirname(targetPath), STAGING_DIRECTORY);
    if (create) fs.mkdirSync(stageDirectory, { recursive: true });
    try {
      return resolveSafePath(stageDirectory);
    } catch (error: any) {
      if (!create && error?.code === 'ENOENT') return undefined;
      throw error;
    }
  }
}

export function createDefaultResumableWriteStore(): IResumableWriteStore {
  return new FileResumableWriteStore();
}
