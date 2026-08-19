/**
 * T14.14: `CLITheme.createSpinner` regression coverage.
 *
 * `ora` writes raw ANSI cursor-control sequences straight to `process.stdout` — fine on a bare
 * CLI, but the TUI owns that same stdout for its own double-buffered screen (`TuiScreen`), so an
 * `ora` spinner running underneath it corrupts the display (`/benchmark`, looping `.text = ...`
 * many times a second, was the most visible case — see workflowCommands.ts). Outside the TUI,
 * `createSpinner` must keep returning a real animated `ora` instance untouched; under it
 * (`TSUKA_TUI=1`, the same flag `InteractiveMenu.select` already keys off), it must return a
 * shim that never touches stdout directly and reports only `succeed`/`fail` through `logSink` —
 * exactly how every other `CLITheme` message already reaches the TUI (see `core/logSink.ts` and
 * `TuiApp.start`'s `setLogSink`).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { CLITheme } from '../src/cli/ui';
import { setLogSink, resetLogSink } from '../src/core/logSink';
import { setProgressSink } from '../src/core/progressSink';

describe('CLITheme.createSpinner (TUI vs. bare CLI)', () => {
  let messages: Array<{ level: 'log' | 'warn' | 'error'; text: string }>;
  let progressUpdates: string[];
  let prevTuiFlag: string | undefined;

  beforeEach(() => {
    messages = [];
    progressUpdates = [];
    setLogSink({
      log: (text) => messages.push({ level: 'log', text }),
      warn: (text) => messages.push({ level: 'warn', text }),
      error: (text) => messages.push({ level: 'error', text }),
    });
    setProgressSink((text) => progressUpdates.push(text));
    prevTuiFlag = process.env.TSUKA_TUI;
  });

  afterEach(() => {
    if (prevTuiFlag === undefined) delete process.env.TSUKA_TUI;
    else process.env.TSUKA_TUI = prevTuiFlag;
    resetLogSink();
    setProgressSink(null);
  });

  it('under TSUKA_TUI, never writes intermediate frames and reports succeed/fail via logSink', () => {
    process.env.TSUKA_TUI = '1';

    const ok = CLITheme.createSpinner('Benchmarking model...');
    ok.start();
    ok.text = 'Benchmarking model... step 2 of 8'; // an ora spinner would repaint on every one of these
    ok.text = 'Benchmarking model... step 3 of 8';
    assert.deepStrictEqual(messages, [], 'No line should be emitted before the spinner settles');
    ok.succeed('Benchmark completed for model');

    const fail = CLITheme.createSpinner('Checking connection...');
    fail.start();
    fail.fail('Connection refused');

    assert.deepStrictEqual(messages, [
      { level: 'log', text: '✔ Benchmark completed for model' },
      { level: 'warn', text: '✘ Connection refused' },
    ], 'Only the two terminal events should reach the chat, each exactly once');
  });

  it('under TSUKA_TUI, forwards every step through progressSink so the header stays live', () => {
    process.env.TSUKA_TUI = '1';

    const spinner = CLITheme.createSpinner('Benchmarking model...');
    spinner.start();
    spinner.text = 'Benchmarking model... step 2 of 8';
    spinner.text = 'Benchmarking model... step 3 of 8';
    spinner.succeed('Done');

    assert.deepStrictEqual(progressUpdates, [
      'Benchmarking model...',
      'Benchmarking model...', // start() re-reports the current text
      'Benchmarking model... step 2 of 8',
      'Benchmarking model... step 3 of 8',
    ], 'Every step the caller sets should reach the sink, in order, so a stalled run keeps repainting');
  });

  it('falls back to its own text when succeed()/fail() are called with no argument', () => {
    process.env.TSUKA_TUI = '1';
    const spinner = CLITheme.createSpinner('Retrieving models list...');
    spinner.start();
    spinner.succeed();
    assert.deepStrictEqual(messages, [{ level: 'log', text: '✔ Retrieving models list...' }]);
  });

  it('outside the TUI, returns a real ora spinner that never touches logSink or progressSink', () => {
    delete process.env.TSUKA_TUI;

    const spinner = CLITheme.createSpinner('Working...');
    spinner.start();
    spinner.stop();
    spinner.succeed('Done');

    assert.deepStrictEqual(messages, [], 'A bare-CLI spinner talks to the real terminal, never to logSink');
    assert.deepStrictEqual(progressUpdates, [], 'and never to progressSink — there is no TUI header to feed');
  });
});
