import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-branch console output buffer (T3.2): during a PARALLEL block, multiple agents
 * write with console.log concurrently — without buffering, output would interleave
 * unreadably. Each branch accumulates its lines into an isolated buffer (AsyncLocalStorage,
 * not a global counter: concurrent branches in the same process do not mix), which is
 * flushed in order only when the parallel block completes.
 */
const logBufferStorage = new AsyncLocalStorage<string[]>();

/**
 * Executes `fn`, capturing any lines logged via console.log into `buffer` during
 * its asynchronous closure instead of printing immediately. Requires `installLogBuffering()`.
 */
export function runWithLogBuffer<T>(buffer: string[], fn: () => Promise<T>): Promise<T> {
  return logBufferStorage.run(buffer, fn);
}

/**
 * Temporarily patches console.log: if called inside an active `runWithLogBuffer`,
 * appends the line into the current branch's buffer instead of printing;
 * otherwise behaves normally. Returns a restore function that should always be
 * called in a `finally` block.
 */
export function installLogBuffering(): () => void {
  const original = console.log;
  console.log = (...args: any[]) => {
    const buffer = logBufferStorage.getStore();
    if (buffer) {
      buffer.push(args.map((a) => String(a)).join(' '));
    } else {
      original(...args);
    }
  };
  return () => { console.log = original; };
}

/** Prints all buffered lines in order to the active console.log. */
export function flushLogBuffer(buffer: string[]): void {
  for (const line of buffer) {
    console.log(line);
  }
}
