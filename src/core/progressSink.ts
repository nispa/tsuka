/**
 * Injectable ephemeral-progress sink, sibling to `logSink.ts`.
 *
 * `logSink` carries messages meant to persist (they become chat bubbles) — wrong channel for a
 * spinner's rapid, throwaway "step 3 of 8" updates, which would spam the chat feed with one line
 * per tick. This carries exactly that kind of text instead: transient, replaced by the next
 * update, never itself worth remembering. The TUI (`TuiApp.start`) points it at the header's
 * generation-status badge; nothing needs it outside the TUI (default is a no-op, unlike
 * `logSink`, which still needs somewhere to print on a bare CLI).
 */

export type ProgressSink = (text: string) => void;

let activeSink: ProgressSink | null = null;

/** Replaces the active progress sink (e.g. to route it into the TUI header). */
export function setProgressSink(sink: ProgressSink | null): void {
  activeSink = sink;
}

/** Reports a transient progress update. A no-op wherever nothing is listening (e.g. bare CLI). */
export function reportProgress(text: string): void {
  activeSink?.(text);
}
